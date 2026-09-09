import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import { handleWorkspaceLaunch } from '../src/workspace-launch-route.ts'
import { WorkspaceLaunchQueue } from '../src/workspace-launch.ts'

async function serve(run: (url: string, queue: WorkspaceLaunchQueue) => Promise<void>) {
  const queue = new WorkspaceLaunchQueue(async () => true, vi.fn(), vi.fn())
  const server = createServer((req, res) => { void handleWorkspaceLaunch(req, res, 'http://desktop.test', queue, req.url === '/complete') })
  await new Promise<void>(resolve => { server.listen(0, '127.0.0.1', resolve) })
  const address = server.address(); if (address === null || typeof address === 'string') throw new Error('no port')
  try { await run(`http://127.0.0.1:${address.port}`, queue) }
  finally { queue.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())) }
}
describe('private workspace delivery route', () => {
  it('rejects cross-origin requests and wrong methods before consuming anything', async () => {
    await serve(async url => {
      expect((await fetch(url, { method: 'POST', headers: { origin: 'https://untrusted.test' } })).status).toBe(403)
      expect((await fetch(url, { headers: { origin: 'http://desktop.test' } })).status).toBe(405)
    })
  })
  it('delivers only validated native requests and acknowledges matching IDs', async () => {
    await serve(async (url, queue) => {
      queue.submit([process.cwd()], process.cwd())
      const response = await fetch(url, { method: 'POST', headers: { origin: 'http://desktop.test' } })
      const item = await response.json() as { id: string; path: string }
      expect(item.path).toBeTruthy()
      expect(response.headers.get('cache-control')).toBe('no-store')
      const complete = (body: string) => fetch(`${url}/complete`, { method: 'POST', headers: { origin: 'http://desktop.test' }, body })
      expect((await complete(JSON.stringify({ id: 'wrong' }))).status).toBe(409)
      expect((await complete(JSON.stringify({ id: item.id }))).status).toBe(200)
      expect((await complete(JSON.stringify({ id: item.id }))).status).toBe(409)
      expect((await complete('invalid')).status).toBe(400)
    })
  })
})
