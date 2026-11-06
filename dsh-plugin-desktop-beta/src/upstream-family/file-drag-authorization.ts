/**
 * The shell half of the Host's file drag authorization, ported from upstream Desktop's `host-process.ts`: requests,
 * answers and cancellations over the Host's IPC channel. Requests have their own identities, apart from the Host's
 * other control requests.
 */
import type { LocalDragResource } from './file-drag-resource.ts'

/** Upstream's deadline for one authorization, above the Host's own 10-second read deadline. */
const AUTHORIZATION_DEADLINE_MS = 12_000

interface DragResourceAnswer {
  readonly type: 'file-drag-resource'
  readonly requestId: number
  readonly resource: LocalDragResource | null
  readonly error?: string
}

/** @param message - untrusted Host IPC message. @returns whether it is a well-formed authorization answer. */
function isDragResourceAnswer(message: unknown): message is DragResourceAnswer {
  if (typeof message !== 'object' || message === null || !('type' in message) || message.type !== 'file-drag-resource') return false
  const candidate = message as Record<string, unknown>
  const resource = candidate.resource
  return Number.isSafeInteger(candidate.requestId) && (candidate.error === undefined || typeof candidate.error === 'string')
    && (resource === null || (typeof resource === 'object' && 'path' in resource && typeof resource.path === 'string'
      && 'sha256' in resource && typeof resource.sha256 === 'string' && /^[a-f0-9]{64}$/u.test(resource.sha256)
      && 'size' in resource && typeof resource.size === 'number' && Number.isSafeInteger(resource.size) && resource.size >= 0))
}

/**
 * @param send - delivers one message to the running Host; rejects while no Host can receive it.
 * @returns `resolve`, which asks the Host to authorize a Session file; `receive`, which settles the request an answer
 * names and reports whether the message was an answer (a malformed one is not, so the caller treats it as invalid IPC);
 * and `fail`, which rejects every unanswered request once the Host has failed or exited.
 */
export function createFileDragAuthorization(send: (message: object) => Promise<void>): {
  resolve(address: string, signal: AbortSignal): Promise<LocalDragResource | null>
  receive(message: unknown): boolean
  fail(error: Error): void
} {
  let nextRequestId = 1
  const requests = new Map<number, { resolve: (resource: LocalDragResource | null) => void; reject: (error: Error) => void }>()
  return {
    resolve: async (address, signal) => {
      signal.throwIfAborted()
      const requestId = nextRequestId++
      let timer: ReturnType<typeof setTimeout> | undefined
      const abort = (): void => {
        void send({ type: 'file-drag-cancel', requestId }).catch((_error: unknown) => {
          // The request still rejects locally if the Host has disconnected.
        })
        const reason: unknown = signal.reason
        requests.get(requestId)?.reject(reason instanceof Error ? reason : new Error('File drag authorization timed out'))
      }
      try {
        return await new Promise<LocalDragResource | null>((resolve, reject) => {
          requests.set(requestId, { resolve, reject })
          timer = setTimeout(abort, AUTHORIZATION_DEADLINE_MS)
          signal.addEventListener('abort', abort, { once: true })
          send({ type: 'file-drag-resource', requestId, address }).catch(reject)
        })
      } finally {
        clearTimeout(timer)
        signal.removeEventListener('abort', abort)
        requests.delete(requestId)
      }
    },
    receive: (message) => {
      if (!isDragResourceAnswer(message)) return false
      const request = requests.get(message.requestId)
      if (message.error === undefined) request?.resolve(message.resource)
      else request?.reject(new Error(message.error))
      return true
    },
    fail: (error) => {
      for (const request of requests.values()) request.reject(error)
      requests.clear()
    },
  }
}
