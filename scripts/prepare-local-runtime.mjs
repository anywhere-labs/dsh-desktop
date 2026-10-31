import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const upstreamRoot = join(root, 'deepseek-harness')
const outputRoot = join(upstreamRoot, 'dist', 'local-runtime')
const tarballDirectory = join(outputRoot, 'npm')
const manifestPath = join(outputRoot, 'manifest.json')
const upstreamDocument = readJson(join(root, 'upstream.json'))
const desktopManifest = readJson(join(root, 'package.json'))
const channels = ['stable', 'beta']

// Chrome DevTools names each of its chunks after its content, so a Desktop
// compatibility patch on one of those files can only ever match the official
// tarball: rebuilding the same source rehashes the name and the patch has no
// target. These packages therefore keep their pinned official payload during a
// local overlay, which means local edits to them are silently not shipped. Give
// such a patch a stable target file before adding an overlay-only source edit.
const overlayPinnedPackages = new Set(['@deepseek-ai/dsh-experimental-inspector'])

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function sha256(data) {
  return createHash('sha256').update(data).digest('hex')
}

function isDshPackageName(name) {
  return typeof name === 'string' && /^@deepseek-ai\/dsh(?:-[a-z0-9][a-z0-9._-]*)?$/u.test(name)
}

function isInside(parent, child) {
  const path = relative(parent, child)
  return path !== '' && path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path)
}

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    env: options.env ?? process.env,
    encoding: options.encoding ?? 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: options.stdio ?? 'pipe',
    shell: options.shell ?? false,
  })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    const detail = typeof result.stderr === 'string' ? result.stderr.trim() : ''
    throw new Error(`${command} ${args.join(' ')} failed (${String(result.status ?? result.signal)}): ${detail}`)
  }
  return result.stdout
}

function gitText(args) {
  return run('git', args, upstreamRoot).trim()
}

function runRootYarnScript(script, env = process.env) {
  const yarnExecutable = process.env.npm_execpath
  if (typeof yarnExecutable !== 'string') {
    throw new Error('local runtime preparation must run from a root Yarn script so its Corepack environment is available')
  }
  const yarnCli = isAbsolute(yarnExecutable) ? yarnExecutable : resolve(root, yarnExecutable)
  if (!existsSync(yarnCli)) {
    throw new Error(`root Yarn CLI from npm_execpath does not exist: ${yarnCli}`)
  }
  return run(yarnCli, [script], root, {
    env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  })
}

function sourceFingerprint(head, status, trackedDiff, untrackedFiles) {
  const hash = createHash('sha256')
  hash.update(head).update('\0').update(status).update('\0').update(trackedDiff)
  for (const file of untrackedFiles) {
    const path = resolve(upstreamRoot, file)
    if (!isInside(upstreamRoot, path)) throw new Error(`unsafe untracked path: ${file}`)
    const info = lstatSync(path)
    hash.update('\0').update(file).update('\0').update(String(info.mode & 0o7777)).update('\0')
    if (info.isSymbolicLink()) hash.update(readlinkSync(path))
    else if (info.isFile()) hash.update(readFileSync(path))
    else throw new Error(`unsupported untracked source entry: ${file}`)
  }
  return hash.digest('hex')
}

function readSourceState() {
  const head = gitText(['rev-parse', 'HEAD'])
  const status = gitText(['status', '--porcelain=v1', '--untracked-files=all'])
  const trackedDiff = run('git', ['diff', '--binary', 'HEAD'], upstreamRoot, { encoding: 'buffer' })
  const untrackedRaw = run('git', ['ls-files', '--others', '--exclude-standard', '-z'], upstreamRoot, { encoding: 'buffer' })
  const untrackedFiles = untrackedRaw.toString('utf8').split('\0').filter(Boolean)
  const pinned = new Set(channels.map(channel => upstreamDocument.channels?.[channel]?.commit).filter(Boolean))
  return {
    head,
    status,
    fingerprint: sourceFingerprint(head, status, trackedDiff, untrackedFiles),
    local: status.length > 0 || !pinned.has(head),
  }
}

function readArchivePaths(tarballPath) {
  const directory = dirname(tarballPath)
  const filename = basename(tarballPath)
  const output = run('tar', ['-tzf', filename], directory)
  const paths = output.split(/\r?\n/u).filter(Boolean)
  if (!paths.includes('package/package.json')) throw new Error(`${tarballPath} has no package/package.json`)
  for (const entry of paths) {
    const normalized = entry.replaceAll('\\', '/')
    if (!normalized.startsWith('package/') || normalized.startsWith('/') || normalized.split('/').includes('..')) {
      throw new Error(`unsafe archive member ${JSON.stringify(entry)} in ${tarballPath}`)
    }
    if (normalized.split('/').includes('node_modules')) {
      throw new Error(`unexpected nested node_modules in ${tarballPath}`)
    }
  }
  const detailed = run('tar', ['-tvzf', filename], directory)
  for (const line of detailed.split(/\r?\n/u).filter(Boolean)) {
    if (!['-', 'd'].includes(line[0])) throw new Error(`unsupported archive entry type in ${tarballPath}: ${line}`)
  }
  return paths
}

function readPackedManifest(tarballPath) {
  const raw = run('tar', ['-xOzf', basename(tarballPath), 'package/package.json'], dirname(tarballPath))
  const manifest = JSON.parse(raw)
  if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') {
    throw new Error(`${tarballPath} package manifest lacks name/version`)
  }
  return manifest
}

function desktopPatchesFor(name, version) {
  const selectors = new Set([`${name}@npm:${version}`, `${name}@npm:^${version}`])
  const patches = new Set()
  for (const [selector, resolution] of Object.entries(desktopManifest.resolutions ?? {})) {
    if (!selectors.has(selector) || typeof resolution !== 'string' || !resolution.startsWith('patch:')) continue
    const marker = resolution.lastIndexOf('#')
    if (marker < 0) throw new Error(`Desktop patch resolution for ${selector} has no patch path`)
    const reference = decodeURIComponent(resolution.slice(marker + 1))
    if (!reference.startsWith('./')) throw new Error(`unsafe Desktop patch path ${JSON.stringify(reference)}`)
    const patchPath = resolve(root, reference.slice(2))
    if (!isInside(root, patchPath) || !existsSync(patchPath)) {
      throw new Error(`Desktop compatibility patch is missing or outside the repository: ${patchPath}`)
    }
    patches.add(patchPath)
  }
  return [...patches]
}

function applyDesktopPatches(packageRoot, name, version) {
  for (const patchPath of desktopPatchesFor(name, version)) {
    const forward = spawnSync('git', ['-C', packageRoot, 'apply', '--check', patchPath], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    if (forward.error !== undefined) throw forward.error
    if (forward.status === 0) {
      run('git', ['-C', packageRoot, 'apply', patchPath], root)
      continue
    }
    const reverse = spawnSync('git', ['-C', packageRoot, 'apply', '--reverse', '--check', patchPath], {
      cwd: root,
      encoding: 'utf8',
      maxBuffer: 8 * 1024 * 1024,
    })
    if (reverse.error !== undefined) throw reverse.error
    if (reverse.status !== 0) {
      const detail = typeof forward.stderr === 'string' ? forward.stderr.trim() : ''
      throw new Error(`Desktop compatibility patch ${basename(patchPath)} no longer applies to local ${name}@${version}: ${detail}`)
    }
  }
}

function packageEntriesFromOutput() {
  const orderPath = join(tarballDirectory, 'publish-order.txt')
  if (!existsSync(orderPath)) throw new Error(`local runtime pack produced no ${orderPath}`)
  const filenames = readFileSync(orderPath, 'utf8').split(/\r?\n/u).filter(Boolean)
  if (filenames.length === 0) throw new Error('local runtime pack produced no DSH packages')
  const seen = new Set()
  return filenames.map(filename => {
    if (basename(filename) !== filename || !filename.endsWith('.tgz')) {
      throw new Error(`unsafe local runtime archive name ${JSON.stringify(filename)}`)
    }
    const path = join(tarballDirectory, filename)
    if (!existsSync(path)) throw new Error(`missing local runtime archive ${path}`)
    const packedManifest = readPackedManifest(path)
    if (!isDshPackageName(packedManifest.name)) {
      throw new Error(`unexpected package in DSH family: ${packedManifest.name}`)
    }
    if (seen.has(packedManifest.name)) throw new Error(`duplicate local package ${packedManifest.name}`)
    seen.add(packedManifest.name)
    const paths = readArchivePaths(path)
    return {
      name: packedManifest.name,
      version: packedManifest.version,
      filename,
      sha256: sha256(readFileSync(path)),
      files: paths,
    }
  })
}

function hasLocalArtifacts(manifest, fingerprint) {
  if (manifest?.formatVersion !== 1 || manifest.profile !== 'local-source-overlay'
    || manifest?.source?.fingerprint !== fingerprint || !Array.isArray(manifest.packages)
    || manifest.packages.length === 0) return false
  return manifest.packages.every(entry => {
    if (!isDshPackageName(entry?.name)
      || typeof entry.version !== 'string' || typeof entry.filename !== 'string'
      || basename(entry.filename) !== entry.filename || !entry.filename.endsWith('.tgz')
      || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(entry.sha256)
      || !Array.isArray(entry.files)) return false
    const path = resolve(tarballDirectory, entry.filename)
    return isInside(tarballDirectory, path) && existsSync(path) && sha256(readFileSync(path)) === entry.sha256
  })
}

function validateActiveChannels(activeChannels) {
  if (activeChannels === undefined || activeChannels === null) return {}
  if (typeof activeChannels !== 'object' || Array.isArray(activeChannels)) {
    throw new Error('invalid local runtime active channel manifest')
  }
  const validated = {}
  for (const [channel, names] of Object.entries(activeChannels)) {
    if (!channels.includes(channel) || !Array.isArray(names)
      || names.some(name => !isDshPackageName(name))) {
      throw new Error(`invalid local runtime channel record: ${channel}`)
    }
    validated[channel] = [...new Set(names)]
  }
  return validated
}

function ensureUpstreamDependencies() {
  if (existsSync(join(upstreamRoot, 'node_modules', 'tsx'))) return
  console.log('Local DSH runtime: installing the pinned upstream build dependencies once.')
  runRootYarnScript('upstream:install', { ...process.env, CI: 'true' })
}

function buildLocalArtifacts(source, previousManifest) {
  ensureUpstreamDependencies()
  console.log(`Local DSH runtime: building source ${source.head.slice(0, 12)} (${source.fingerprint.slice(0, 12)}).`)
  const env = {
    ...process.env,
    CI: 'true',
    DSH_BUILD_CLIENT_PROFILE: process.env.DSH_BUILD_CLIENT_PROFILE ?? 'official',
  }
  runRootYarnScript('upstream:build:official', env)
  runRootYarnScript('upstream:pack:dsh:local', env)
  return {
    formatVersion: 1,
    profile: 'local-source-overlay',
    source: {
      head: source.head,
      dirty: source.status.length > 0,
      fingerprint: source.fingerprint,
    },
    packages: packageEntriesFromOutput(),
    activeChannels: validateActiveChannels(previousManifest?.activeChannels),
  }
}

function findInstalledPackage(workspaceRoot, name) {
  // Some executable-only packages (for example @deepseek-ai/dsh) have no
  // importable root entry point, so locate their manifest directly.
  const packageRoot = resolve(workspaceRoot, 'node_modules', ...name.split('/'))
  const manifestPath = join(packageRoot, 'package.json')
  if (!existsSync(manifestPath)) return null
  const manifest = readJson(manifestPath)
  return manifest.name === name ? { root: packageRoot, manifest } : null
}

function requiredByWorkspace(workspaceManifest, name) {
  if (workspaceManifest.dependencies?.[name] !== undefined
    || workspaceManifest.devDependencies?.[name] !== undefined
    || workspaceManifest.optionalDependencies?.[name] !== undefined) return true
  return workspaceManifest.dsh?.client?.inject?.includes(name) === true
}

function parseVersion(value) {
  const match = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(value)
  if (match === null) return null
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4]?.split('.') ?? [],
  }
}

function compareVersions(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 || right.prerelease.length === 0) {
    if (left.prerelease.length === right.prerelease.length) return 0
    return left.prerelease.length === 0 ? 1 : -1
  }
  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index]
    const b = right.prerelease[index]
    if (a === undefined || b === undefined) return a === b ? 0 : a === undefined ? -1 : 1
    if (a === b) continue
    const aNumeric = /^\d+$/u.test(a)
    const bNumeric = /^\d+$/u.test(b)
    if (aNumeric && bNumeric) return Number(a) < Number(b) ? -1 : 1
    if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
    return a < b ? -1 : 1
  }
  return 0
}

function satisfiesRange(versionText, rangeText) {
  const version = parseVersion(versionText)
  if (version === null) return false
  const alternatives = rangeText.split('||').map(part => part.trim())
  return alternatives.some(alternative => {
    if (alternative === '*' || alternative.toLowerCase() === 'latest') return true
    if (alternative.startsWith('^') || alternative.startsWith('~')) {
      const operator = alternative[0]
      const base = parseVersion(alternative.slice(1))
      if (base === null || compareVersions(version, base) < 0) return false
      let upper
      if (operator === '~') upper = { major: base.major, minor: base.minor + 1, patch: 0, prerelease: [] }
      else if (base.major > 0) upper = { major: base.major + 1, minor: 0, patch: 0, prerelease: [] }
      else if (base.minor > 0) upper = { major: 0, minor: base.minor + 1, patch: 0, prerelease: [] }
      else upper = { major: 0, minor: 0, patch: base.patch + 1, prerelease: [] }
      return compareVersions(version, upper) < 0
    }
    const comparators = alternative.split(/\s+/u).filter(Boolean)
    if (comparators.length === 0) return false
    return comparators.every(comparator => {
      const match = /^(<=|>=|<|>|=)?(.+)$/u.exec(comparator)
      if (match === null) return false
      const expected = parseVersion(match[2])
      if (expected === null) return false
      const comparison = compareVersions(version, expected)
      switch (match[1] ?? '=') {
        case '>': return comparison > 0
        case '>=': return comparison >= 0
        case '<': return comparison < 0
        case '<=': return comparison <= 0
        default: return comparison === 0
      }
    })
  })
}

function resolvePackageManifest(requireFromPackage, name) {
  // Do not resolve the package entry point: packages with only exported subpaths
  // (such as @earendil-works/pi-ai) have no root export but are installed.
  const segments = name.split('/')
  for (const modulePath of requireFromPackage.resolve.paths(name) ?? []) {
    const path = resolve(modulePath, ...segments, 'package.json')
    if (!isInside(root, path) || !existsSync(path)) continue
    const manifest = readJson(path)
    if (manifest.name === name) return manifest
  }
  return null
}

function validateRuntimeDependencies(packageRoot, manifest) {
  const requireFromPackage = createRequire(join(packageRoot, 'package.json'))
  const check = (name, range, optional = false) => {
    const resolved = resolvePackageManifest(requireFromPackage, name)
    if (resolved === null) {
      if (optional) return
      throw new Error(`${manifest.name} needs ${name}@${String(range)}, but it is not installed in this Desktop workspace`)
    }
    if (!satisfiesRange(resolved.version, String(range))) {
      throw new Error(`${manifest.name} needs ${name}@${String(range)}, but Desktop resolves ${String(resolved.version)}`)
    }
  }
  for (const [name, range] of Object.entries(manifest.dependencies ?? {})) check(name, range)
  for (const [name, range] of Object.entries(manifest.optionalDependencies ?? {})) check(name, range, true)
  for (const [name, range] of Object.entries(manifest.peerDependencies ?? {})) {
    if (manifest.peerDependenciesMeta?.[name]?.optional === true) check(name, range, true)
    else check(name, range)
  }
}

function packagePlan(workspaceRoot, packages) {
  const workspaceManifest = readJson(join(workspaceRoot, 'package.json'))
  const plan = []
  for (const entry of packages) {
    if (overlayPinnedPackages.has(entry.name)) continue
    const installed = findInstalledPackage(workspaceRoot, entry.name)
    if (installed === null) {
      if (requiredByWorkspace(workspaceManifest, entry.name)) {
        throw new Error(`${entry.name} is required by ${workspaceManifest.name} but is not installed; run corepack yarn install --immutable before building`)
      }
      continue
    }
    const expectedRoot = resolve(workspaceRoot, 'node_modules', ...entry.name.split('/'))
    const actualRoot = resolve(installed.root)
    if (actualRoot !== expectedRoot || realpathSync(actualRoot) !== actualRoot || lstatSync(actualRoot).isSymbolicLink()) {
      throw new Error(`${entry.name} resolved outside its Desktop workspace node_modules: ${actualRoot}`)
    }
    if (installed.manifest.version !== entry.version) {
      throw new Error(`${entry.name} local source is ${entry.version}, Desktop installed ${String(installed.manifest.version)}; local overlays do not change package versions`)
    }
    validateRuntimeDependencies(actualRoot, readPackedManifest(join(tarballDirectory, entry.filename)))
    readArchivePaths(join(tarballDirectory, entry.filename))
    plan.push({ ...entry, target: actualRoot })
  }
  return plan
}

function assertNoSymlinks(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    const path = join(directory, entry.name)
    const info = lstatSync(path)
    if (info.isSymbolicLink()) throw new Error(`local package archive contains a symlink: ${path}`)
    if (info.isDirectory()) assertNoSymlinks(path)
  }
}

function payloadDigest(directory) {
  const hash = createHash('sha256')
  const visit = current => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (entry.name === 'node_modules') continue
      const path = join(current, entry.name)
      const relativePath = relative(directory, path).replaceAll(sep, '/')
      hash.update(relativePath).update('\0')
      if (entry.isDirectory()) visit(path)
      else if (entry.isFile()) hash.update(readFileSync(path))
      else throw new Error(`unsupported package payload entry: ${path}`)
    }
  }
  visit(directory)
  return hash.digest('hex')
}

function replacePackagePayload(target, packageRoot) {
  const stageRoot = mkdtempSync(join(dirname(target), '.dsh-local-runtime-stage-'))
  const stagedPackage = join(stageRoot, 'package')
  const backup = join(stageRoot, 'previous')
  mkdirSync(stagedPackage)
  try {
    for (const child of readdirSync(packageRoot)) {
      cpSync(join(packageRoot, child), join(stagedPackage, child), { recursive: true, force: true })
    }
    let originalMoved = false
    try {
      renameSync(target, backup)
      originalMoved = true
      renameSync(stagedPackage, target)
      const oldNodeModules = join(backup, 'node_modules')
      if (existsSync(oldNodeModules)) renameSync(oldNodeModules, join(target, 'node_modules'))
      if (payloadDigest(packageRoot) !== payloadDigest(target)) {
        throw new Error(`staged local runtime payload mismatch for ${target}`)
      }
      rmSync(backup, { recursive: true, force: true })
    } catch (error) {
      if (originalMoved && existsSync(backup)) {
        try {
          const oldNodeModules = join(backup, 'node_modules')
          const newNodeModules = join(target, 'node_modules')
          if (existsSync(target) && existsSync(newNodeModules) && !existsSync(oldNodeModules)) {
            renameSync(newNodeModules, oldNodeModules)
          }
          if (existsSync(target)) rmSync(target, { recursive: true, force: true })
          renameSync(backup, target)
        } catch (restoreError) {
          throw new Error(`package swap failed and rollback also failed; original package remains at ${backup}: ${String(restoreError)}; original error: ${String(error)}`)
        }
      }
      throw error
    }
  } finally {
    if (!existsSync(backup)) rmSync(stageRoot, { recursive: true, force: true })
  }
}

function applyTarball(target, tarballPath, expectedName, expectedVersion) {
  const targetManifestPath = join(target, 'package.json')
  if (!existsSync(targetManifestPath)) throw new Error(`refusing to replace a non-package directory: ${target}`)
  const targetManifest = readJson(targetManifestPath)
  if (targetManifest.name !== expectedName || targetManifest.version !== expectedVersion) {
    throw new Error(`refusing to replace ${target}: expected ${expectedName}@${expectedVersion}`)
  }
  if (!isInside(resolve(root), resolve(target))) throw new Error(`refusing to overlay outside Desktop workspaces: ${target}`)

  const archivePaths = readArchivePaths(tarballPath)
  const temporaryRoot = mkdtempSync(join(tmpdir(), 'dsh-local-runtime-'))
  try {
    run('tar', ['-xzf', basename(tarballPath), '-C', temporaryRoot], dirname(tarballPath))
    const packageRoot = join(temporaryRoot, 'package')
    if (!existsSync(join(packageRoot, 'package.json')) || !isInside(temporaryRoot, realpathSync(packageRoot))) {
      throw new Error(`invalid package root in ${tarballPath}`)
    }
    assertNoSymlinks(packageRoot)
    const packedManifest = readJson(join(packageRoot, 'package.json'))
    if (packedManifest.name !== expectedName || packedManifest.version !== expectedVersion) {
      throw new Error(`archive identity mismatch for ${tarballPath}`)
    }
    applyDesktopPatches(packageRoot, expectedName, expectedVersion)
    assertNoSymlinks(packageRoot)
    validateRuntimeDependencies(target, readJson(join(packageRoot, 'package.json')))
    replacePackagePayload(target, packageRoot)
    const actualManifest = readJson(targetManifestPath)
    if (actualManifest.name !== expectedName || actualManifest.version !== expectedVersion
      || payloadDigest(packageRoot) !== payloadDigest(target)) {
      throw new Error(`local runtime overlay verification failed for ${expectedName}`)
    }
    console.log(`Local DSH runtime: applied ${expectedName}@${expectedVersion} from ${basename(tarballPath)} (${String(archivePaths.length)} files).`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

function restorePinnedPackage(channel, name) {
  const channelInfo = upstreamDocument.channels[channel]
  if (channelInfo === undefined || !isDshPackageName(name)) throw new Error(`invalid pinned runtime lookup: ${channel}/${name}`)
  const vendorManifestPath = resolve(root, channelInfo.runtimeSource)
  const workspaceRoot = resolve(root, channelInfo.package)
  if (!isInside(root, vendorManifestPath) || !isInside(root, workspaceRoot)) {
    throw new Error(`unsafe pinned runtime path for ${channel}`)
  }
  const vendorManifest = readJson(vendorManifestPath)
  if (vendorManifest.commit !== channelInfo.commit || vendorManifest.version !== channelInfo.runtimePackageVersion
    || !Array.isArray(vendorManifest.packages)) {
    throw new Error(`cannot restore ${channel}: pinned vendor manifest no longer matches upstream.json`)
  }
  const entry = vendorManifest.packages.find(candidate => candidate.name === name)
  if (entry === undefined) throw new Error(`pinned runtime manifest has no ${name}`)
  if (typeof entry.filename !== 'string' || basename(entry.filename) !== entry.filename
    || !entry.filename.endsWith('.tgz') || typeof entry.sha256 !== 'string'
    || !/^[a-f0-9]{64}$/u.test(entry.sha256) || typeof entry.version !== 'string') {
    throw new Error(`invalid pinned runtime package record for ${name}`)
  }
  const vendorDirectory = resolve(root, dirname(channelInfo.runtimeSource))
  const tarballPath = join(vendorDirectory, entry.filename)
  if (!existsSync(tarballPath) || sha256(readFileSync(tarballPath)) !== entry.sha256) {
    throw new Error(`pinned runtime tarball failed integrity check: ${tarballPath}`)
  }
  const installed = findInstalledPackage(workspaceRoot, name)
  if (installed === null) return
  const target = resolve(workspaceRoot, 'node_modules', ...name.split('/'))
  if (installed.root !== target || realpathSync(target) !== target || lstatSync(target).isSymbolicLink()) {
    throw new Error(`cannot safely restore ${name} outside ${workspaceRoot}/node_modules`)
  }
  applyTarball(target, tarballPath, name, entry.version)
}

function restorePinnedOverlays(manifest) {
  const activeChannels = validateActiveChannels(manifest.activeChannels)
  for (const [channel, names] of Object.entries(activeChannels)) {
    for (const name of names) restorePinnedPackage(channel, name)
  }
  manifest.activeChannels = {}
  writeJson(manifestPath, manifest)
  console.log('Local DSH runtime: restored pinned vendor packages after upstream source became clean.')
}

function main() {
  const source = readSourceState()
  let previous
  if (existsSync(manifestPath)) previous = readJson(manifestPath)

  if (!source.local) {
    if (Object.keys(previous?.activeChannels ?? {}).length > 0) restorePinnedOverlays(previous)
    else console.log('Local DSH runtime: upstream is clean and pinned; using the normal vendored packages.')
    return
  }
  const ci = process.env.CI?.trim().toLowerCase()
  if (ci !== undefined && ci !== '' && ci !== 'false' && ci !== '0') {
    throw new Error('refusing a local upstream runtime overlay in CI; restore the pinned submodule before release builds')
  }

  const hasCurrentArtifacts = hasLocalArtifacts(previous, source.fingerprint)
  const manifest = hasCurrentArtifacts
    ? previous
    : buildLocalArtifacts(source, previous)
  // Keep a verified pack cache even if dependency preflight or a package swap
  // fails, so the next attempt does not rebuild the entire upstream runtime.
  if (!hasCurrentArtifacts) writeJson(manifestPath, manifest)
  const activeChannels = validateActiveChannels(manifest.activeChannels)
  for (const channel of channels) {
    const workspaceRoot = join(root, upstreamDocument.channels[channel].package)
    const plan = packagePlan(workspaceRoot, manifest.packages)
    if (plan.length === 0) throw new Error(`local runtime family has no installed packages in ${workspaceRoot}`)
    const plannedNames = plan.map(entry => entry.name)
    const oldNames = activeChannels[channel] ?? []
    const recoveryNames = [...new Set([...oldNames, ...plannedNames])]
    activeChannels[channel] = recoveryNames
    manifest.activeChannels = activeChannels
    writeJson(manifestPath, manifest)
    for (const name of oldNames) {
      if (!plannedNames.includes(name)) restorePinnedPackage(channel, name)
    }
    for (const entry of plan) {
      applyTarball(entry.target, join(tarballDirectory, entry.filename), entry.name, entry.version)
    }
    activeChannels[channel] = plannedNames
    manifest.activeChannels = activeChannels
    writeJson(manifestPath, manifest)
  }
  console.log(`Local DSH runtime ready from ${source.head.slice(0, 12)}; release vendor files, upstream.json and yarn.lock were not modified.`)
}

main()
