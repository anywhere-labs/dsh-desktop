/** A real, freshly published fixture served only on loopback for the Host smoke. */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { promisify } from 'node:util'

export async function startRecentRegistry(home, executable, pnpmEntry) {
  const name = '@dsh-next-fixture/recent-dependency'
  const version = '1.0.0'
  const directory = join(home, 'recent-dependency')
  mkdirSync(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }))
  await promisify(execFile)(executable, ['--expose-internals', pnpmEntry, 'pack', '--pack-destination', directory], {
    cwd: directory, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 30_000,
  })
  const tarball = readFileSync(join(directory, `dsh-next-fixture-recent-dependency-${version}.tgz`))
  const published = new Date().toISOString()
  let origin
  const server = createServer((request, response) => {
    if (request.url === '/fixture.tgz') {
      response.setHeader('content-type', 'application/octet-stream')
      response.end(tarball)
    } else if (decodeURIComponent(request.url) === `/${name}`) {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({ name, 'dist-tags': { latest: version }, time: { [version]: published },
        versions: { [version]: { name, version, dist: { tarball: `${origin}/fixture.tgz`,
          integrity: `sha512-${createHash('sha512').update(tarball).digest('base64')}` } } },
      }))
    } else {
      response.writeHead(404).end()
    }
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${server.address().port}`
  return { name, version, origin, stop: () => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeIdleConnections()
  }) }
}
