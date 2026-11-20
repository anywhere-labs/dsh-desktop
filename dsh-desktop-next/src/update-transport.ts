/** Installer transport: Chromium `net.request` follows redirects one hop at a time. */
import { Readable } from 'node:stream'
import { net, session } from 'electron'
import {
  assertSecureDownloadUrl,
  type UpdateArtifactRequest,
  type UpdateArtifactResponse,
} from '../../dsh-plugin-desktop/src/update-download.ts'

/** Redirect hops accepted before the transport reports a loop. */
const MAX_REDIRECTS = 8

/**
 * Non-persistent partition for installer traffic. It starts with an empty
 * cookie jar, stores nothing, and therefore carries the `credentials: 'omit'`
 * guarantee the previous `net.fetch` request expressed directly.
 */
const UPDATE_PARTITION = 'dsh-next-update'

/** HTTP statuses whose Response must be constructed without a body stream. */
const NULL_BODY_STATUSES = new Set([204, 205, 304])

/** Silence allowed before response headers and between body chunks, as in the official Desktop. */
const DEFAULT_IDLE_TIMEOUT_MS = 60_000

/** Overrides the idle timeout in milliseconds; the official Desktop reads the same variable. */
const IDLE_TIMEOUT_VARIABLE = 'DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS'

/** Options of {@link createArtifactRequest}. */
export interface ArtifactRequestOptions {
  /**
   * Maximum silence before the response headers and between body chunks, not a total download deadline.
   * Defaults to {@link updateIdleTimeoutMs}.
   */
  readonly idleTimeoutMs?: number
}

/**
 * Resolve the installer transport's idle timeout.
 * @param environment - Desktop process environment.
 * @returns `DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS`, or 60000 when it is unset.
 * @throws When the variable is not an integer from 1000 through 2147483647.
 */
export function updateIdleTimeoutMs(environment: NodeJS.ProcessEnv = process.env): number {
  const value = environment[IDLE_TIMEOUT_VARIABLE]
  if (value === undefined || value === '') return DEFAULT_IDLE_TIMEOUT_MS
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1000 || parsed > 2_147_483_647) {
    throw new Error(`dsh-desktop-next: ${IDLE_TIMEOUT_VARIABLE} must be an integer from 1000 through 2147483647`)
  }
  return parsed
}

/**
 * Build the artifact transport for installer downloads.
 *
 * `net.fetch` cannot follow redirects manually: with `redirect: 'manual'` it
 * rejects with `Redirect was cancelled` instead of returning the 3xx response,
 * so a release service that redirects to storage can never be downloaded.
 * `net.request` emits a `redirect` event and waits for `followRedirect()` or
 * `abort()`, which supports the per-hop HTTPS check.
 *
 * Chromium bounds neither the wait for headers nor a stalled body, so a request
 * that goes silent for the idle timeout fails with `ETIMEDOUT` and is aborted:
 * before its headers it rejects, and afterwards its body stream errors.
 *
 * @param options - Idle timeout; an invalid environment override rejects each request.
 * @returns A request adapter that resolves with the settled response and URL.
 */
export function createArtifactRequest(options: ArtifactRequestOptions = {}): UpdateArtifactRequest {
  return (url, init) => requestArtifact(url, init, options)
}

/** The transport's failure when a request goes silent; the update copy reports it as a connection problem. */
function idleTimeout(idleTimeoutMs: number): Error {
  return Object.assign(new Error(`The update download received no data for ${String(idleTimeoutMs)} ms.`), { code: 'ETIMEDOUT' })
}

function requestArtifact(url: string, init: RequestInit, options: ArtifactRequestOptions): Promise<UpdateArtifactResponse> {
  return new Promise<UpdateArtifactResponse>((resolve, reject) => {
    const idleTimeoutMs = options.idleTimeoutMs ?? updateIdleTimeoutMs()
    const signal = init.signal ?? undefined
    let current: Electron.ClientRequest | undefined
    let headerTimer: ReturnType<typeof setTimeout> | undefined
    let hops = 0
    let settled = false

    const release = (): void => { clearTimeout(headerTimer); signal?.removeEventListener('abort', onAbort) }
    const finish = (value: UpdateArtifactResponse): void => {
      if (settled) return
      settled = true; release(); resolve(value)
    }
    const fail = (error: unknown): void => {
      if (settled) return
      settled = true; release()
      reject(error instanceof Error ? error : new Error(String(error)))
    }
    function onAbort(): void {
      const request = current; current = undefined
      // Settle first: aborting the request emits its own 'abort' event, which
      // must not replace the caller-visible cancellation error.
      fail(Object.assign(new Error('The update download was cancelled.'), { name: 'AbortError' }))
      try { request?.abort() } catch { /* the request may already be finished */ }
    }
    if (signal?.aborted === true) { onAbort(); return }
    signal?.addEventListener('abort', onAbort, { once: true })

    const open = (target: string): void => {
      if (settled) return
      let secure: URL
      try { secure = assertSecureDownloadUrl(target) } catch (error) { fail(error); return }
      if (hops >= MAX_REDIRECTS) { fail(new Error('Too many update redirects')); return }
      hops += 1
      // Only the first hop receives the release selectors; artifact storage
      // must not observe which release stream asked for the bytes.
      const headers = new Headers(hops === 1 ? init.headers : { Accept: 'application/octet-stream' })
      // Approximates the fetch `cache: 'no-store'` intent over the Chromium net stack.
      headers.set('cache-control', 'no-cache')

      const request = net.request({ url: secure.href, method: 'GET', redirect: 'manual',
        session: session.fromPartition(UPDATE_PARTITION) })
      current = request
      headers.forEach((value, key) => request.setHeader(key, value))
      let closing = false
      clearTimeout(headerTimer)
      headerTimer = setTimeout(() => {
        // Settle first, as for a cancellation: the abort below must not report itself.
        closing = true
        fail(idleTimeout(idleTimeoutMs))
        try { request.abort() } catch { /* the request may already be finished */ }
      }, idleTimeoutMs)

      request.on('redirect', (_status, _method, redirectUrl) => {
        // Do not call followRedirect(): the next hop is issued here so every
        // hop is validated and only the first carries the release selectors.
        closing = true
        try { request.abort() } catch { /* the redirect decision already released the request */ }
        let next: string
        try { next = new URL(redirectUrl, secure.href).href } catch { fail(new Error('Update redirect has no usable location')); return }
        open(next)
      })
      request.on('response', incoming => {
        clearTimeout(headerTimer)
        if (settled) return
        const status = incoming.statusCode
        if (status === undefined) { fail(new Error('The update download response carried no HTTP status.')); return }
        const responseHeaders = new Headers()
        for (const [key, value] of Object.entries(incoming.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) responseHeaders.append(key, item)
        }
        try {
          finish({
            // Electron's IncomingMessage is a Node Readable at runtime; its
            // declared type only guarantees NodeJS.ReadableStream.
            response: new Response(
              NULL_BODY_STATUSES.has(status)
                ? null
                : watchedBody(incoming as unknown as Readable, request, idleTimeoutMs),
              { status, headers: responseHeaders },
            ),
            finalUrl: secure.href,
          })
        } catch (error) { fail(error) }
      })
      request.on('abort', () => {
        if (!closing && !settled) fail(new Error('The update download request was aborted.'))
      })
      request.on('error', error => fail(error))
      // ClientRequest is a Writable: without end() the request is never sent.
      request.end()
    }

    open(url)
  })
}

/**
 * Convert a response body into a web stream that errors with the idle timeout when no chunk arrives in time.
 * @param incoming - Response body as a Node Readable.
 * @param request - The request that is aborted with the body.
 * @param idleTimeoutMs - Maximum silence between chunks.
 * @returns The body stream.
 */
function watchedBody(incoming: Readable, request: Electron.ClientRequest, idleTimeoutMs: number): ReadableStream<Uint8Array> {
  const body = Readable.toWeb(incoming) as unknown as ReadableStream<Uint8Array>
  let timer: ReturnType<typeof setTimeout> | undefined
  const stop = (): void => {
    clearTimeout(timer)
    incoming.off('data', refresh)
  }
  function refresh(): void {
    clearTimeout(timer)
    timer = setTimeout(() => {
      stop()
      incoming.destroy(idleTimeout(idleTimeoutMs))
      try { request.abort() } catch { /* the request may already be finished */ }
    }, idleTimeoutMs)
  }
  // Listening after the conversion leaves the stream's backpressure to it; every listener sees each chunk.
  incoming.on('data', refresh)
  incoming.once('end', stop)
  incoming.once('error', stop)
  incoming.once('close', stop)
  refresh()
  return body
}
