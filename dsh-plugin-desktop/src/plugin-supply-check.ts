/**
 * Reading of whether the installed runtime still supplies every package the
 * active Profile's bundles expect it to supply.
 *
 * A bundle names packages in two different ways, and the difference decides what
 * absence means. A regular dependency is fetched by the package manager, so a
 * bundle keeps loading when the runtime stops shipping that package: it simply
 * carries its own copy. A peer dependency, and a browser-side inject entry, are
 * the opposite. Nothing fetches those on the bundle's behalf, so when the
 * installed runtime no longer ships one, resolution fails while the Loader is
 * still bringing the bundle up, before any of the bundle's own code runs. No
 * defensive coding inside the bundle survives that, and no version range it
 * declares predicts it, because a range describes what its author expected and
 * is satisfied by a release that no longer ships the package at all.
 *
 * This is why the reading is worth taking before boot: the same fact is already
 * on disk, at no cost, that the Loader is about to discover the expensive way.
 *
 * The reading rules out exactly one way of failing, so its clean result is
 * narrower than compatibility. A package that is installed but no longer exports
 * the binding being imported, and a bundle that resolves yet refuses to
 * activate, are both outside what it can see.
 */

import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'

/** Largest bundle manifest this reading will parse. */
const MAX_BUNDLE_MANIFEST_BYTES = 1024 * 1024

/** Largest number of expected names accepted from a single bundle manifest. */
const MAX_EXPECTED_NAMES = 1024

/** Package name shape shared with the rest of Desktop's Profile handling. */
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

/** How a bundle asked the runtime to supply one package name. */
export type SupplyExpectation = 'peer' | 'client-inject'

/** Whether one expected name is installed for the active Profile. */
export type SupplyPresence = 'present' | 'absent' | 'undecidable'

/** Whether a bundle's expectations are met, or could not be read at all. */
export type BundleSupplyVerdict = 'supplied' | 'unsupplied' | 'undecidable'

/** One package name a bundle expects the runtime to supply. */
export interface ExpectedSupply {
  /** Package name the bundle expects to resolve without installing it itself. */
  readonly packageName: string
  /** Every declaration site that named it, in manifest order without repeats. */
  readonly expectations: readonly SupplyExpectation[]
}

/** Reading for one bundle declared by the active Profile. */
export interface BundleSupplyReport {
  /** Bundle package name as declared by the Profile manifest. */
  readonly packageName: string
  /** Whether the installed runtime can bring this bundle up. */
  readonly verdict: BundleSupplyVerdict
  /** Expected names that are not installed; empty unless the verdict is `unsupplied`. */
  readonly missing: readonly string[]
  /** Why no reading was possible; present only when the verdict is `undecidable`. */
  readonly reason?: string
}

/** Reading across every bundle the caller asked about. */
export interface ProfileSupplyReport {
  /** Every bundle examined, in the order the caller supplied them. */
  readonly bundles: readonly BundleSupplyReport[]
  /** Bundles the installed runtime cannot supply, so they cannot come up. */
  readonly unsupplied: readonly BundleSupplyReport[]
  /** Bundles no reading could be taken for; never folded into either verdict. */
  readonly undecidable: readonly BundleSupplyReport[]
}

/** Disk access this reading needs, injected so the judgement stays testable. */
export interface ProfileSupplyProbe {
  /**
   * Parsed manifest of one installed bundle, or `undefined` when the Profile
   * declares the bundle but nothing is installed under that name. Throws when a
   * manifest exists yet cannot be read, so an unreadable bundle is never
   * mistaken for an absent one.
   */
  readonly readBundleManifest: (packageName: string) => unknown
  /** Whether one expected name is installed for the active Profile. */
  readonly presence: (packageName: string) => SupplyPresence
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Names the manifest expects the runtime to supply.
 *
 * Optional peer dependencies are excluded deliberately. Their absence is a
 * declared and supported state, so counting them would report a healthy bundle
 * as broken, which is the most damaging mistake this reading can make.
 */
export function collectExpectedSupply(manifest: unknown): readonly ExpectedSupply[] {
  if (!isPlainObject(manifest)) throw new Error('bundle manifest must hold a JSON object')
  const collected = new Map<string, SupplyExpectation[]>()
  const add = (packageName: string, expectation: SupplyExpectation): void => {
    if (!PACKAGE_NAME_PATTERN.test(packageName)) {
      throw new Error(`bundle manifest names an invalid package ${JSON.stringify(packageName)}`)
    }
    const existing = collected.get(packageName)
    if (existing === undefined) collected.set(packageName, [expectation])
    else if (!existing.includes(expectation)) existing.push(expectation)
  }

  const peers = manifest.peerDependencies
  if (peers !== undefined) {
    if (!isPlainObject(peers)) throw new Error('bundle manifest peerDependencies must be an object')
    const meta = manifest.peerDependenciesMeta
    if (meta !== undefined && !isPlainObject(meta)) {
      throw new Error('bundle manifest peerDependenciesMeta must be an object')
    }
    for (const packageName of Object.keys(peers)) {
      const entry = isPlainObject(meta) ? meta[packageName] : undefined
      if (isPlainObject(entry) && entry.optional === true) continue
      add(packageName, 'peer')
    }
  }

  const dsh = manifest.dsh
  if (dsh !== undefined) {
    if (!isPlainObject(dsh)) throw new Error('bundle manifest dsh field must be an object')
    const client = dsh.client
    if (client !== undefined) {
      if (!isPlainObject(client)) throw new Error('bundle manifest dsh.client field must be an object')
      const inject = client.inject
      if (inject !== undefined) {
        if (!Array.isArray(inject)) throw new Error('bundle manifest dsh.client.inject must be an array')
        for (const entry of inject) {
          if (typeof entry !== 'string') {
            throw new Error('bundle manifest dsh.client.inject must hold package names')
          }
          add(entry, 'client-inject')
        }
      }
    }
  }

  if (collected.size > MAX_EXPECTED_NAMES) {
    throw new Error('bundle manifest expects too many names from the runtime')
  }
  return [...collected].map(([packageName, expectations]) => ({ packageName, expectations }))
}

function undecidableBundle(packageName: string, reason: string): BundleSupplyReport {
  return { packageName, verdict: 'undecidable', missing: [], reason }
}

/**
 * Reading for one bundle.
 *
 * ⛔ The order of the two negative outcomes matters. One name known to be absent
 * is already sufficient for the bundle to fail, so it stands whether or not
 * other names could be measured; asking "was anything unmeasurable" first would
 * swallow a certain failure inside an uncertainty. Only when nothing is known to
 * be absent does an unmeasurable name decide the reading, and then it must yield
 * undecidable rather than supplied: a reading that quietly downgrades "not
 * measured" to "fine" is worse than no reading, because nothing distinguishes it
 * from a real pass.
 */
export function checkBundleSupply(
  packageName: string,
  probe: ProfileSupplyProbe,
): BundleSupplyReport {
  let expected: readonly ExpectedSupply[]
  try {
    const manifest = probe.readBundleManifest(packageName)
    if (manifest === undefined) return undecidableBundle(packageName, 'nothing is installed under this name')
    expected = collectExpectedSupply(manifest)
  } catch (cause) {
    return undecidableBundle(packageName, cause instanceof Error ? cause.message : String(cause))
  }

  const missing: string[] = []
  const unmeasured: string[] = []
  for (const entry of expected) {
    const presence = probe.presence(entry.packageName)
    if (presence === 'absent') missing.push(entry.packageName)
    else if (presence === 'undecidable') unmeasured.push(entry.packageName)
  }
  if (missing.length > 0) return { packageName, verdict: 'unsupplied', missing }
  if (unmeasured.length > 0) {
    return undecidableBundle(packageName, `cannot tell whether ${unmeasured.join(', ')} is installed`)
  }
  return { packageName, verdict: 'supplied', missing: [] }
}

/** Reading across every bundle the caller asked about, in the order given. */
export function checkProfileSupply(
  bundleNames: readonly string[],
  probe: ProfileSupplyProbe,
): ProfileSupplyReport {
  const bundles = bundleNames.map(packageName => checkBundleSupply(packageName, probe))
  return {
    bundles,
    unsupplied: bundles.filter(bundle => bundle.verdict === 'unsupplied'),
    undecidable: bundles.filter(bundle => bundle.verdict === 'undecidable'),
  }
}

/**
 * Every directory resolution would consult starting from `start`, nearest first.
 *
 * A Profile does not necessarily hold its own installed tree — Desktop lays the
 * modules out one level above, shared across Profiles — so a probe that only
 * looked inside the Profile would find nothing and report every bundle as
 * undecidable. Walking the chain is what makes the reading independent of which
 * layout is in use, and it is the same walk resolution itself performs.
 */
function resolutionChain(start: string): readonly string[] {
  const dirs: string[] = []
  let current = resolve(start)
  for (;;) {
    dirs.push(current)
    const parent = dirname(current)
    if (parent === current) return dirs
    current = parent
  }
}

/**
 * Probe backed by the Profile's own installed tree.
 *
 * Presence is asked in the same terms the Loader will ask it, so the reading and
 * the failure it predicts come from one mechanism rather than two that can drift
 * apart. Directories are consulted nearest first, starting with the Profile whose
 * bundles are being judged and continuing through the ancestors resolution
 * would search.
 */
export function createProfileSupplyProbe(searchDirs: readonly string[]): ProfileSupplyProbe {
  const [resolutionRoot] = searchDirs
  if (resolutionRoot === undefined) {
    throw new Error('a Profile supply probe needs at least one search directory')
  }
  const chain = [...new Set(searchDirs.flatMap(dir => resolutionChain(dir)))]
  const installedManifestPath = (packageName: string): string | undefined => {
    for (const dir of chain) {
      const candidate = join(dir, 'node_modules', ...packageName.split('/'), 'package.json')
      if (existsSync(candidate)) return candidate
    }
    return undefined
  }
  return {
    readBundleManifest: packageName => {
      const manifestPath = installedManifestPath(packageName)
      if (manifestPath === undefined) return undefined
      const bytes = readFileSync(manifestPath)
      if (bytes.byteLength > MAX_BUNDLE_MANIFEST_BYTES) {
        throw new Error(`installed manifest for ${packageName} is too large to read`)
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown
    },
    presence: packageName => {
      if (installedManifestPath(packageName) !== undefined) return 'present'
      // A package can be installed yet decline to expose a manifest subpath, so
      // an export-map refusal proves presence as firmly as a readable manifest.
      try {
        createRequire(join(resolutionRoot, 'package.json')).resolve(packageName)
        return 'present'
      } catch (cause) {
        const code = (cause as NodeJS.ErrnoException).code
        if (code === 'MODULE_NOT_FOUND') return 'absent'
        if (code === 'ERR_PACKAGE_PATH_NOT_EXPORTED') return 'present'
        if (code === 'ERR_UNSUPPORTED_DIR_IMPORT') return 'present'
        return 'undecidable'
      }
    },
  }
}
