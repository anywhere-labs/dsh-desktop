/** Refresh the bundled market from npm latest without floating the committed lockfile. */
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const MARKET_WORKSPACES = ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-desktop-next', 'dsh-plugin-desktop-tintin']
export const marketResolution = version => `patch:dshmarket@npm%3A${version}#./.yarn/patches/dshmarket-desktop.patch`
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const registry = 'https://registry.npmjs.org/dshmarket/latest'

export async function latestMarket(fetcher = fetch) {
  const response = await fetcher(registry, { signal: AbortSignal.timeout(20_000), cache: 'no-store' })
  if (!response.ok) throw new Error(`dshmarket latest lookup failed: HTTP ${response.status}`)
  const manifest = await response.json()
  if (manifest.name !== 'dshmarket' || typeof manifest.version !== 'string'
    || !/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(manifest.version)) {
    throw new Error('npm latest returned an invalid dshmarket identity/version')
  }
  return manifest.version
}

function installedVersion(directory, workspace) {
  try {
    const require = createRequire(join(directory, workspace, 'package.json'))
    return JSON.parse(readFileSync(require.resolve('dshmarket/package.json'), 'utf8')).version
  } catch { return undefined }
}

function install(directory) {
  const yarn = process.env.COREPACK_ROOT
    ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js') : process.env.npm_execpath
  if (!yarn || !/\.[cm]?js$/.test(yarn) || !existsSync(yarn)) {
    throw new Error('Run corepack yarn market:prepare to use the repository Yarn release')
  }
  const result = spawnSync(process.execPath, [yarn, 'install'], {
    cwd: directory, stdio: 'inherit', timeout: 600_000,
    env: { ...process.env, YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`Market dependency install failed (${result.status})`)
}

export async function prepareMarket(directory, { check = false, pinned = false, fetcher = fetch, runInstall = install } = {}) {
  if (pinned) {
    // 本地全编锚定（2026-10-21 用户裁决）：沿用已安装/已锁定的 dshmarket，
    // 不访问 npm、不重写版本——与 AA 的本地锚定同一条"钉死"口径。
    const installed = MARKET_WORKSPACES.map(workspace => installedVersion(directory, workspace))
    const version = installed[0]
    if (version === undefined) throw new Error('dshmarket is not installed; run corepack yarn market:prepare once online to seed it')
    if (installed.some(entry => entry !== version)) throw new Error(`dshmarket versions diverge across workspaces: ${installed.join(', ')}`)
    if (!existsSync(resolve(directory, '.yarn', 'patches', 'dshmarket-desktop.patch'))) throw new Error('dshmarket desktop patch is missing')
    return version
  }
  // Resolve the tag before any writes. An offline check must not silently bless an old release.
  const version = await latestMarket(fetcher)
  const paths = ['package.json', ...MARKET_WORKSPACES.map(name => `${name}/package.json`), 'yarn.lock']
  const originals = new Map(paths.map(path => [path, readFileSync(join(directory, path))]))
  const manifests = new Map(paths.filter(path => path.endsWith('.json')).map(path =>
    [path, JSON.parse(originals.get(path).toString())]))
  const rootManifest = manifests.get('package.json')
  const overrides = Object.keys(rootManifest.resolutions ?? {}).filter(key => key === 'dshmarket' || key.startsWith('dshmarket@'))
  const resolutionKey = `dshmarket@npm:${version}`
  const patchCurrent = overrides.length === 1 && rootManifest.resolutions[resolutionKey] === marketResolution(version)
  const stale = MARKET_WORKSPACES.filter(workspace =>
    manifests.get(`${workspace}/package.json`).dependencies?.dshmarket !== version
    || installedVersion(directory, workspace) !== version)
  if (check) {
    if (stale.length || !patchCurrent) throw new Error(`dshmarket latest is ${version}; run corepack yarn market:prepare (${stale.join(', ') || 'stale resolution'})`)
    return version
  }
  if (!stale.length && patchCurrent) return version
  try {
    // Follow latest while retaining Desktop self-update and rollback fixes. Yarn rejects
    // incompatible patch contexts; never silently ship a new release without these safeguards.
    for (const key of overrides) delete rootManifest.resolutions[key]
    rootManifest.resolutions ??= {}
    rootManifest.resolutions[resolutionKey] = marketResolution(version)
    for (const workspace of MARKET_WORKSPACES) {
      const manifest = manifests.get(`${workspace}/package.json`)
      if (!manifest.dependencies?.dshmarket) throw new Error(`${workspace} must declare its bundled dshmarket`)
      manifest.dependencies.dshmarket = version
    }
    for (const [path, manifest] of manifests) writeFileSync(join(directory, path), `${JSON.stringify(manifest, null, 2)}\n`)
    runInstall(directory)
    for (const workspace of MARKET_WORKSPACES) {
      if (installedVersion(directory, workspace) !== version) throw new Error(`${workspace} did not install dshmarket ${version}`)
    }
  } catch (error) {
    for (const [path, bytes] of originals) writeFileSync(join(directory, path), bytes)
    throw new Error('Market preparation failed; manifests and lockfile restored. Rerun yarn install before continuing.', { cause: error })
  }
  return version
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--check' && arg !== '--pinned')) throw new Error('Usage: corepack yarn market:prepare [--check] [--pinned]')
  const pinned = args.includes('--pinned') || process.env.DSH_MARKET_PINNED === '1'
  const version = await prepareMarket(root, { check: args.includes('--check'), pinned })
  console.log(pinned
    ? `dshmarket pinned to the installed ${version} in Stable, Beta, Next and the TinTin channel (no npm access)`
    : `dshmarket latest verified: ${version} in Stable, Beta, Next and the TinTin channel`)
}
