import { createRequire } from 'node:module'

const FIRST_PARTY_PREFIX = '@deepseek-ai/'

/**
 * Verify that a published profile root directly supplies every required
 * first-party peer reached through its production dependency graph.
 * @param {object} manifest - deploy-root package manifest.
 * @param {(name: string, parentManifestPath: string) => Promise<{ manifest: object, path: string }>} loadPackage - package manifest loader.
 * @param {string} rootManifestPath - absolute deploy-root manifest path.
 * @returns {Promise<{ failures: string[], packageCount: number }>}
 */
export async function verifyRuntimeClosure(manifest, loadPackage, rootManifestPath) {
  const direct = manifest.dependencies ?? {}
  const rootName = manifest.name ?? rootManifestPath
  const parents = new Map()
  const paths = new Map()
  const optional = new Map()
  const loaded = new Set()
  const skippedOptional = new Set()
  const queue = []

  for (const dependency of Object.keys(direct).filter(isFirstParty).sort()) {
    parents.set(dependency, undefined)
    paths.set(dependency, rootManifestPath)
    optional.set(dependency, false)
    queue.push(dependency)
  }

  const failures = []
  for (let index = 0; index < queue.length; index += 1) {
    const packageName = queue[index]
    const parentManifestPath = paths.get(packageName)
    if (packageName === undefined || parentManifestPath === undefined) continue
    if (loaded.has(packageName)) continue
    let current
    try {
      current = await loadPackage(packageName, parentManifestPath)
    } catch (cause) {
      if (optional.get(packageName) === true && isMissingPackage(cause)) {
        skippedOptional.add(packageName)
        continue
      }
      throw cause
    }
    loaded.add(packageName)
    const currentManifest = current.manifest
    const peers = currentManifest.peerDependencies ?? {}
    const peerMeta = currentManifest.peerDependenciesMeta ?? {}

    for (const peer of Object.keys(peers).sort()) {
      const requiredAtRoot = parents.get(packageName) === undefined || isFirstParty(peer)
      if (!requiredAtRoot || peerMeta[peer]?.optional === true || direct[peer] !== undefined) continue
      failures.push(`${formatChain(rootName, packageName, parents)} -> ${peer}`)
    }

    for (const dependency of Object.keys(currentManifest.dependencies ?? {}).filter(isFirstParty).sort()) {
      enqueue(dependency, packageName, current.path, false)
    }
    for (const dependency of Object.keys(currentManifest.optionalDependencies ?? {}).filter(isFirstParty).sort()) {
      enqueue(dependency, packageName, current.path, true)
    }
  }

  return { failures, packageCount: parents.size }

  function enqueue(dependency, parent, parentManifestPath, isOptional) {
    if (!parents.has(dependency)) {
      parents.set(dependency, parent)
      paths.set(dependency, parentManifestPath)
      optional.set(dependency, isOptional)
      queue.push(dependency)
      return
    }
    if (optional.get(dependency) !== true || isOptional) return
    optional.set(dependency, false)
    parents.set(dependency, parent)
    paths.set(dependency, parentManifestPath)
    if (skippedOptional.delete(dependency)) queue.push(dependency)
  }
}

/**
 * Resolve one installed package manifest from its owning package.
 * @param {string} name - package name.
 * @param {string} parentManifestPath - manifest whose dependency edge owns the package.
 * @returns {Promise<{ manifest: object, path: string }>}
 */
export async function loadInstalledPackage(name, parentManifestPath) {
  const require = createRequire(parentManifestPath)
  const path = require.resolve(`${name}/package.json`)
  return { manifest: require(path), path }
}

function isFirstParty(name) {
  return name.startsWith(FIRST_PARTY_PREFIX)
}

function isMissingPackage(cause) {
  return cause instanceof Error && 'code' in cause && cause.code === 'MODULE_NOT_FOUND'
}

function formatChain(rootName, packageName, parents) {
  const chain = [packageName]
  let parent = parents.get(packageName)
  while (parent !== undefined) {
    chain.unshift(parent)
    parent = parents.get(parent)
  }
  return [rootName, ...chain].join(' -> ')
}
