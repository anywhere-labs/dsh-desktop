import { createHash } from 'node:crypto'
import { execFileSync, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AA_REPOSITORY, assertPreparedAaRelease, runtimePeerRanges as readRuntimePeerRanges } from './agents-anywhere-release-policy.mjs'
import { prepareInstalledAaRuntime } from './prepare-agents-anywhere-runtime.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sourceRepository = process.env.DSH_AA_SOURCE_REPOSITORY ?? AA_REPOSITORY
const sourceRef = process.env.DSH_AA_SOURCE_REF ?? 'main'
const vendorRoot = resolve(root, 'vendor/agents-anywhere')
const provenancePath = join(vendorRoot, 'provenance.json')
const currentProvenance = existsSync(provenancePath) ? JSON.parse(readFileSync(provenancePath, 'utf8')) : {}
let desktopVersion
let artifactName
const peerPackages = ['@deepseek-ai/dsh-typert-protocol', '@deepseek-ai/dsh-llm', '@deepseek-ai/dsh-session']

function invocation(name, args) {
  if (name === 'corepack') {
    const yarnEntry = process.env.COREPACK_ROOT
      ? join(process.env.COREPACK_ROOT, 'dist', 'yarn.js')
      : /\.[cm]?js$/u.test(process.env.npm_execpath ?? '') ? process.env.npm_execpath : undefined
    if (!yarnEntry || !existsSync(yarnEntry) || args[0] !== 'yarn') {
      throw new Error('Run this script through corepack yarn aa:prepare-release')
    }
    return [process.execPath, [yarnEntry, ...args.slice(1)]]
  }
  return [name, args]
}

function run(name, args, cwd) {
  const [binary, argv] = invocation(name, args)
  const result = spawnSync(binary, argv, { cwd, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...(name === 'corepack' && args[1] === 'install' ? { YARN_ENABLE_IMMUTABLE_INSTALLS: 'false' } : {}) }, stdio: 'inherit', timeout: 600_000 })
  if (result.error !== undefined) throw result.error
  if (result.status !== 0) throw new Error(`${name} exited with ${String(result.status)}`)
}

function capture(name, args, cwd) {
  return execFileSync(name, args, { cwd, encoding: 'utf8', timeout: 60_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }).trim()
}

export function versionForCommit(sourceVersion, commit, peerRanges = {}) {
  const match = /^(\d+\.\d+\.\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(sourceVersion)
  if (!match || !/^[0-9a-f]{40}$/u.test(commit)) throw new Error('Invalid AA source version or commit')
  return `${match[1]}-${match[2] ? `${match[2]}.` : ''}desktop.c${commit.slice(0, 12)}.r${createHash('sha256').update(JSON.stringify(peerRanges)).digest('hex').slice(0, 8)}`
}

function copySourceTree(source, destination) {
  const ignored = new Set(['.git', '.yarn', 'node_modules', 'lib', 'coverage', '.venv', '__pycache__', '.pytest_cache', '.ruff_cache'])
  cpSync(source, destination, {
    recursive: true,
    filter: current => {
      const parts = relative(source, current).split(sep)
      const name = basename(current)
      return !parts.some(part => ignored.has(part)) && !name.endsWith('.pyc') && !name.endsWith('.tsbuildinfo')
    },
  })
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function runtimePeerRanges() {
  return readRuntimePeerRanges(root)
}

function patchManifest(packagePath, peerRanges) {
  const manifest = readJson(join(packagePath, 'package.json'))
  const sourceVersion = manifest.version
  manifest.version = desktopVersion
  // Build/typecheck explicitly above packaging; prepack's integration suite
  // requires Server/Web/Python fixtures that are not part of a release build.
  if (manifest.scripts) { delete manifest.scripts.prepack; delete manifest.scripts.postpack }
  manifest.peerDependencies = { ...manifest.peerDependencies, ...peerRanges }
  writeFileSync(join(packagePath, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`)
  return { sourceVersion }
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function resolveCommit() {
  if (/^[0-9a-f]{40}$/iu.test(sourceRef)) return sourceRef.toLowerCase()
  const result = capture('git', ['ls-remote', '--exit-code', sourceRepository, `refs/heads/${sourceRef}`], root)
  const commit = result.split(/\s+/u)[0]
  if (!/^[0-9a-f]{40}$/u.test(commit)) throw new Error('AA branch did not resolve to one commit')
  return commit
}

function cloneSource(stagingRoot, commit) {
  const checkout = join(stagingRoot, 'source')
  mkdirSync(checkout)
  run('git', ['init', '--quiet'], checkout)
  run('git', ['remote', 'add', 'origin', sourceRepository], checkout)
  run('git', ['fetch', '--depth=1', '--no-tags', 'origin', commit], checkout)
  run('git', ['checkout', '--detach', 'FETCH_HEAD'], checkout)
  if (capture('git', ['rev-parse', 'HEAD'], checkout) !== commit) throw new Error('AA checkout changed during preparation')
  return checkout
}

function prepare() {
  if (sourceRef === 'pinned') {
    throw new Error('DSH_AA_SOURCE_REF=pinned is no longer supported; releases must check the latest AA main commit')
  }
  const verifyRelease = process.argv.includes('--verify-release')
  if (verifyRelease && (sourceRepository !== AA_REPOSITORY || sourceRef !== 'main')) {
    throw new Error('Release verification requires the official AA repository and main branch')
  }
  const commit = resolveCommit()
  console.log(`Selected AA ${sourceRef} at ${commit}`)
  if (verifyRelease || process.argv.includes('--check')) {
    assertPreparedAaRelease(root, commit)
    console.log(`AA release verified: both channels use ${commit}`)
    return
  }
  const packagePaths = ['dsh-plugin-desktop/package.json', 'dsh-plugin-desktop-beta/package.json']
  const peerRanges = runtimePeerRanges()
  if (currentProvenance.commit === commit && JSON.stringify(currentProvenance.runtimePeers) === JSON.stringify(peerRanges)
    && packagePaths.every(path => readJson(join(root, path)).dependencies?.['@agents-anywhere/dsh-bridge-next'] === `file:../vendor/agents-anywhere/${currentProvenance.artifact}`)
    && existsSync(join(vendorRoot, currentProvenance.artifact))
    && sha256(join(vendorRoot, currentProvenance.artifact)) === currentProvenance.sha256) {
    assertPreparedAaRelease(root, commit, { installed: false })
    prepareInstalledAaRuntime(root)
    try {
      assertPreparedAaRelease(root, commit)
    } catch {
      console.log('Refreshing installed AA dependencies from the verified artifact')
      run('corepack', ['yarn', 'install', '--mode=skip-build'], root)
      prepareInstalledAaRuntime(root)
      assertPreparedAaRelease(root, commit)
    }
    console.log(`Reusing verified AA artifact ${currentProvenance.artifact}`)
    return
  }
  const snapshotPaths = [...packagePaths, 'yarn.lock', 'vendor/agents-anywhere/provenance.json']
  const snapshots = new Map(snapshotPaths.map(path => [path, readFileSync(join(root, path))]))
  let targetArtifact
  let published = false
  mkdirSync(vendorRoot, { recursive: true })
  const stagingRoot = mkdtempSync(join(tmpdir(), 'dsh-agents-anywhere-release-'))
  try {
    const checkout = cloneSource(stagingRoot, commit)
    const buildRoot = join(stagingRoot, 'build')
    const packageRoot = join(buildRoot, 'dsh-bridge-next')
    const packRoot = join(stagingRoot, 'pack')
    mkdirSync(buildRoot)
    mkdirSync(packRoot)
    copySourceTree(join(checkout, 'dsh-bridge-next'), packageRoot)
    copySourceTree(join(checkout, 'connector'), join(buildRoot, 'connector'))

    desktopVersion = versionForCommit(readJson(join(packageRoot, 'package.json')).version, commit, peerRanges)
    artifactName = `agents-anywhere-dsh-bridge-next-${desktopVersion}.tgz`
    // Declare an independent Yarn project even when a parent temp directory has a manifest.
    if (!existsSync(join(packageRoot, 'yarn.lock'))) writeFileSync(join(packageRoot, 'yarn.lock'), '')
    const { sourceVersion } = patchManifest(packageRoot, peerRanges)
    run('corepack', ['yarn', 'install', '--mode=skip-build'], packageRoot)
    run('corepack', ['yarn', 'build'], packageRoot)
    run('corepack', ['yarn', 'typecheck'], packageRoot)
    run('corepack', ['yarn', 'check:build'], packageRoot)
    run('corepack', ['yarn', 'pack', '--out', join(packRoot, artifactName)], packageRoot)

    const packed = readdirSync(packRoot).filter(name => name.endsWith('.tgz'))
    if (packed.length !== 1) throw new Error(`Expected one AA package, found ${packed.length}`)
    const destination = join(vendorRoot, artifactName)
    if (existsSync(destination)) {
      if (sha256(destination) !== sha256(join(packRoot, packed[0]))) throw new Error(`Existing artifact differs: ${artifactName}; refusing to overwrite it`)
    } else {
      targetArtifact = destination
      cpSync(join(packRoot, packed[0]), destination)
    }
    const provenance = {
      repository: sourceRepository,
      branch: /^[0-9a-f]{40}$/iu.test(sourceRef) ? (process.env.DSH_AA_SOURCE_BRANCH ?? 'main') : sourceRef,
      commit,
      packageDirectory: 'dsh-bridge-next',
      sourceVersion,
      desktopVersion,
      artifact: artifactName,
      sha256: sha256(destination),
      runtimePeers: peerRanges,
      manifestChanges: [
        `version set to ${desktopVersion}`,
        'release staging removes prepack/postpack hooks; build, typecheck and check:build run explicitly',
        ...peerPackages.map(name => `${name} peer accepts ${peerRanges[name]}`),
      ],
      sourceChanges: [],
    }
    writeFileSync(provenancePath, `${JSON.stringify(provenance, null, 2)}\n`)
    for (const path of packagePaths) {
      const manifest = readJson(join(root, path))
      manifest.dependencies['@agents-anywhere/dsh-bridge-next'] = `file:../vendor/agents-anywhere/${artifactName}`
      writeFileSync(join(root, path), `${JSON.stringify(manifest, null, 2)}\n`)
    }
    run('corepack', ['yarn', 'install', '--mode=skip-build'], root)
    prepareInstalledAaRuntime(root)
    assertPreparedAaRelease(root, commit)
    published = true
    console.log(`Agents Anywhere release package prepared from ${commit} (${destination})`)
  } catch (error) {
    for (const [path, contents] of snapshots) writeFileSync(join(root, path), contents)
    if (targetArtifact && !published) rmSync(targetArtifact, { force: true })
    console.error('AA preparation failed; manifests and lockfile restored. Run yarn install --immutable before retrying if installation started.')
    throw error
  } finally {
    rmSync(stagingRoot, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    prepare()
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}

export { patchManifest, runtimePeerRanges }
