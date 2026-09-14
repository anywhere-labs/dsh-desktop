import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WorkspaceLaunchDelivery } from './workspace-launch-contract.ts'

/** Same-origin, authenticated by the owning Host route before entry. */
export async function handleWorkspaceLaunch(
  req: IncomingMessage, res: ServerResponse, origin: string,
  queue: WorkspaceLaunchDelivery, complete: boolean,
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
    try { reply(200, await queue.next(abort.signal)) }
    catch { reply(503, { error: 'workspace launch unavailable' }) }
    finally { res.off('close', close) }
    return
  }
  let value: { id: string; error?: string }
  try {
    let body = ''
    for await (const chunk of req) {
      body += String(chunk)
      if (Buffer.byteLength(body) > 4096) { reply(413, { error: 'body too large' }); return }
    }
    const parsed: unknown = JSON.parse(body)
    if (typeof parsed !== 'object' || parsed === null || !('id' in parsed) || typeof parsed.id !== 'string'
      || ('error' in parsed && typeof parsed.error !== 'string')) {
      reply(400, { error: 'invalid completion' }); return
    }
    value = { id: parsed.id, ...('error' in parsed ? { error: parsed.error as string } : {}) }
  } catch { reply(400, { error: 'invalid completion' }); return }
  try { reply(await queue.complete(value.id, value.error) ? 200 : 409, {}) }
  catch { reply(503, { error: 'workspace launch unavailable' }) }
}
