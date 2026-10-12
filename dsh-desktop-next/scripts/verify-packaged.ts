/** Check the actual unpacked payload, including runtime-only dependencies, without a GUI. */
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

interface PackContext { appOutDir: string; electronPlatformName: string }
export function verifyNextPayload(root: string): void {
  // `host.cordis.patch.yml` and `scripts/node-bin` are read from the packaged application by the
  // Host: the overlay swaps the official webserver for Next's private loopback one, and the shims
  // put a `node` on the package manager's PATH. Both are invisible to a `yarn start` run, which
  // resolves them in the source tree, so only this check keeps them in the payload.
  for (const path of ['lib/main.js', 'lib/host.js', 'lib/client.js', 'lib/preload-app.cjs', 'lib/preload-shell.cjs',
    'lib/native-ui/index.html', 'cordis.patch.yml', 'host.cordis.patch.yml',
    'scripts/node-bin/node', 'scripts/node-bin/node.cmd',
    'assets/tray-iconTemplate.png', 'assets/tray-icon-blue.png']) {
    if (!existsSync(join(root, path))) throw new Error(`Missing Next payload: ${path}`)
  }
  const queued = [join(root, 'package.json')]; const visited = new Set<string>()
  while (queued.length) {
    const manifest = realpathSync(queued.pop()!)
    if (visited.has(manifest)) continue
    visited.add(manifest)
    const data = JSON.parse(readFileSync(manifest, 'utf8'))
    // Required peers are runtime edges too: a plugin whose peer is absent throws on import and the
    // Host reports it as an entry that did not activate, long after packaging reported success.
    // They are the packages most easily missed, because the workspace resolves them from the
    // repository root even when this application never declares them.
    const optionalPeers = data.peerDependenciesMeta ?? {}
    const required = [...Object.keys(data.dependencies ?? {}),
      ...Object.keys(data.peerDependencies ?? {}).filter(name => optionalPeers[name]?.optional !== true)]
    for (const name of required) {
      let parent = dirname(manifest)
      let found: string | undefined
      while (!relative(root, parent).startsWith('..')) {
        const candidate = join(parent, 'node_modules', name, 'package.json')
        if (existsSync(candidate)) { found = realpathSync(candidate); break }
        if (parent === root) break
        parent = dirname(parent)
      }
      if (!found) {
        if (Object.hasOwn(data.optionalDependencies ?? {}, name)) continue
        throw new Error(`Missing packaged dependency ${name} required by ${data.name}`)
      }
      if (relative(root, found).startsWith('..')) throw new Error(`Packaged dependency escapes the application: ${name}`)
      queued.push(found)
    }
  }
  const frontend = join(root, 'node_modules/@deepseek-ai/dsh-web-frontend/dist/index.html')
  if (!existsSync(frontend)) throw new Error('Official Web frontend was not packaged')
}
export default function afterPack(context: PackContext): void {
  const resources = context.electronPlatformName === 'darwin' ? join(context.appOutDir, 'DSH NEXT.app/Contents/Resources') : join(context.appOutDir, 'resources')
  if (existsSync(join(resources, 'app.asar'))) throw new Error('Next must use the same asar:false runtime layout as Stable/Beta')
  verifyNextPayload(join(resources, 'app'))
}
