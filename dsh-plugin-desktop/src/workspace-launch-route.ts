import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceLaunchQueue } from './workspace-launch.ts'

/** Same-origin, authenticated by the owning Host route before entry. */
export async function handleWorkspaceLaunch(
  req: IncomingMessage, res: ServerResponse, origin: string,
  queue: WorkspaceLaunchQueue, complete: boolean,
): Promise<void> {
  const reply = (status: number, body: unknown): void => {
    if (res.destroyed) return
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' })
    res.end(JSON.stringify(body))
  }
  if (req.method !== 'POST') { reply(405, { error: 'method not allowed' }); return }
  if (req.headers.origin !== origin) { reply(403, { error: 'forbidden' }); return }
  if (!complete) {
    const abort = new AbortController()
    const close = (): void => { abort.abort() }
    res.once('close', close)
    try { reply(200, await queue.next(abort.signal)) } finally { res.off('close', close) }
    return
  }
  try {
    let body = ''
    for await (const chunk of req) {
      body += String(chunk)
      if (Buffer.byteLength(body) > 4096) { reply(413, { error: 'body too large' }); return }
    }
    const value: unknown = JSON.parse(body)
    if (typeof value !== 'object' || value === null || !('id' in value) || typeof value.id !== 'string'
      || ('error' in value && typeof value.error !== 'string')) {
      reply(400, { error: 'invalid completion' }); return
    }
    reply(queue.complete(value.id, 'error' in value ? value.error as string : undefined) ? 200 : 409, {})
  } catch { reply(400, { error: 'invalid completion' }) }
}
