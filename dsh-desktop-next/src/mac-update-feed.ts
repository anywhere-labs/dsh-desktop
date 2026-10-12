/** Private loopback feed for handing an already verified archive to Squirrel.Mac. */
import { randomBytes } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { pipeline } from 'node:stream/promises'

export async function serveMacUpdate(archive: string, version: string): Promise<{ url: string; close(): Promise<void> }> {
  const size = (await stat(archive)).size
  const token = randomBytes(32).toString('hex')
  let origin = ''
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.method !== 'GET' || request.headers.host !== new URL(origin).host) { response.writeHead(404).end(); return }
    if (request.url === `/${token}/feed`) {
      response.setHeader('Content-Type', 'application/json')
      response.end(JSON.stringify({ url: `${origin}/${token}/update.zip`, name: version, notes: '', pub_date: new Date().toISOString() }))
    } else if (request.url === `/${token}/update.zip`) {
      response.setHeader('Content-Type', 'application/zip')
      response.setHeader('Content-Length', size)
      void pipeline(createReadStream(archive), response).catch(() => { response.destroy() })
    } else response.writeHead(404).end()
  })
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() }) })
  const address = server.address()
  if (!address || typeof address === 'string') { server.close(); throw new Error('Update feed has no local address') }
  origin = `http://127.0.0.1:${address.port}`
  return { url: `${origin}/${token}/feed`, close: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve()); server.closeAllConnections()
  }) }
}
