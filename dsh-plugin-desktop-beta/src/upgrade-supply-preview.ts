/**
 * What an offered release would stop supplying to the bundles already installed.
 *
 * The same reading as {@link checkProfileSupply}, with one substitution: instead
 * of asking this machine what is installed, it asks the inventory published for
 * the release being offered. Everything else — which names a bundle expects the
 * runtime to supply, and what their absence means — is unchanged, so the answer
 * before an upgrade and the answer after it are produced by one mechanism rather
 * than two that can disagree.
 *
 * The reading is only as current as the inventory it is given. When no inventory
 * for the offered release is available the preview is simply absent, and the
 * update flow proceeds exactly as it does today. That failure direction is
 * deliberate: a missing preview costs a warning that never appears, while a
 * wrong preview would talk someone out of an upgrade that was fine.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  checkProfileSupply,
  createProfileSupplyProbe,
  type ProfileSupplyReport,
  type SupplyPresence,
} from './plugin-supply-check.ts'

/** Largest published inventory this preview will parse. */
const MAX_INVENTORY_BYTES = 4 * 1024 * 1024

/** Package name shape shared with the rest of Desktop's Profile handling. */
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u

/**
 * What an offered release publishes about itself.
 *
 * An inventory is authoritative only for the name prefixes it claims. A runtime
 * manifest lists the runtime's own packages, so it can say nothing about a UI
 * framework a bundle expects from the host — and treating that silence as
 * absence is how a bundle gets condemned for depending on something the release
 * does supply. Names outside the claimed scopes are therefore left undecided.
 */
export interface RuntimeInventory {
  /** Every package name the offered release is known to supply. */
  readonly packages: ReadonlySet<string>
  /** Name prefixes this inventory can speak about; empty means it speaks about all. */
  readonly scopes: readonly string[]
}

/** Everything the preview needs about the machine and the offered release. */
export interface UpgradeSupplyInput {
  /** Bundle names the active Profile declares, in manifest order. */
  readonly bundleNames: readonly string[]
  /** Active Profile directory, used to read each installed bundle's manifest. */
  readonly profileDir: string
  /** What the offered release publishes about what it supplies. */
  readonly target: RuntimeInventory
}

/**
 * Package names published for one release.
 *
 * `alwaysPresent` carries the packages that keep their own version line, which a
 * runtime manifest leaves out precisely because they never move with the
 * runtime. Without them, every bundle depending on the framework base would be
 * reported as newly broken — the mistake that condemns working bundles in bulk.
 *
 * `scopes` bounds what the inventory is entitled to deny. A runtime manifest can
 * say a runtime package is gone; it cannot say anything about a package from
 * another publisher, and silence there is not absence.
 */
export function parseRuntimeInventory(
  value: unknown,
  alwaysPresent: readonly string[] = [],
  scopes: readonly string[] = [],
): RuntimeInventory {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('runtime inventory must hold a JSON object')
  }
  const packages = (value as { packages?: unknown }).packages
  if (!Array.isArray(packages)) throw new Error('runtime inventory must list packages')
  const names = new Set<string>(alwaysPresent)
  for (const entry of packages) {
    const name = typeof entry === 'string'
      ? entry
      : entry !== null && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as { name?: unknown }).name
        : undefined
    if (typeof name !== 'string' || !PACKAGE_NAME_PATTERN.test(name)) {
      throw new Error('runtime inventory holds an invalid package name')
    }
    names.add(name)
  }
  const declared = (value as { scopes?: unknown }).scopes
  const resolved = Array.isArray(declared)
    ? declared.filter((scope): scope is string => typeof scope === 'string')
    : scopes
  return { packages: names, scopes: resolved }
}

/** Read a published runtime inventory from disk. */
export function readRuntimeInventory(
  path: string,
  alwaysPresent: readonly string[] = [],
  scopes: readonly string[] = [],
): RuntimeInventory {
  const bytes = readFileSync(path)
  if (bytes.byteLength > MAX_INVENTORY_BYTES) {
    throw new Error('runtime inventory is too large to read')
  }
  return parseRuntimeInventory(
    JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as unknown,
    alwaysPresent,
    scopes,
  )
}

/**
 * Environment override naming a directory of published runtime inventories.
 *
 * This is the seam where a release channel's own inventory arrives. Until one is
 * published, the directory is how an inventory can be supplied out of band, and
 * its absence simply means no preview is offered.
 */
export const RUNTIME_INVENTORY_DIRECTORY_ENV = 'DSH_DESKTOP_RUNTIME_INVENTORY_DIR'

/** Inventory published for one offered release, or nothing when none is available. */
export function offeredRuntimeInventory(
  version: string,
  directory: string | undefined = process.env[RUNTIME_INVENTORY_DIRECTORY_ENV],
): RuntimeInventory | undefined {
  if (directory === undefined || directory.length === 0) return undefined
  if (!/^[0-9A-Za-z._+-]+$/u.test(version)) return undefined
  try {
    return readRuntimeInventory(join(directory, `${version}.json`))
  } catch {
    return undefined
  }
}

/** Base URL of the repository serving the channel table and runtime manifests. */
export const RUNTIME_INVENTORY_URL_ENV = 'DSH_DESKTOP_RUNTIME_INVENTORY_URL'

/** Name prefix the vendored runtime manifests are authoritative about. */
export const RUNTIME_INVENTORY_SCOPE = '@deepseek-ai/dsh'

/** How long the two inventory requests may take before the preview is skipped. */
const INVENTORY_FETCH_TIMEOUT_MS = 10_000

/** Largest inventory response accepted from the network. */
const MAX_INVENTORY_RESPONSE_BYTES = 4 * 1024 * 1024

/**
 * Fetch the inventory a channel publishes about itself.
 *
 * Two documents: the channel table names the runtime version that channel
 * bundles, and that version's manifest lists the packages. Neither has to be
 * installed first, which is what makes the reading possible before an upgrade
 * rather than after it.
 */
export async function fetchRuntimeInventory(
  baseUrl: string,
  channel: string,
  branch: string,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<RuntimeInventory> {
  const read = async (path: string): Promise<unknown> => {
    const init: RequestInit = { redirect: 'follow', ...(signal === undefined ? {} : { signal }) }
    const response = await fetchImpl(`${baseUrl}/${branch}/${path}`, init)
    if (!response.ok) throw new Error(`${path} responded ${response.status}`)
    const text = await response.text()
    if (text.length > MAX_INVENTORY_RESPONSE_BYTES) throw new Error(`${path} is too large to read`)
    return JSON.parse(text) as unknown
  }

  const table = await read('upstream.json')
  if (table === null || typeof table !== 'object' || Array.isArray(table)) {
    throw new Error('channel table must hold a JSON object')
  }
  const channels = (table as { channels?: unknown }).channels
  if (channels === null || typeof channels !== 'object' || Array.isArray(channels)) {
    throw new Error('channel table must list channels')
  }
  const entry = (channels as Record<string, unknown>)[channel]
  const version = entry !== null && typeof entry === 'object' && !Array.isArray(entry)
    ? (entry as { sourceVersion?: unknown }).sourceVersion
    : undefined
  if (typeof version !== 'string' || !/^[0-9A-Za-z._+-]+$/u.test(version)) {
    throw new Error(`channel ${channel} declares no usable runtime version`)
  }
  return parseRuntimeInventory(
    await read(`vendor/dsh-runtime/${version}/manifest.json`),
    [],
    [RUNTIME_INVENTORY_SCOPE],
  )
}

/** Inventory fetched for the offered release, or nothing when it cannot be had. */
export async function offeredRuntimeInventoryOverNetwork(
  channel: string,
  branch: string,
  baseUrl: string | undefined = process.env[RUNTIME_INVENTORY_URL_ENV],
  report: (message: string) => void = () => {},
): Promise<RuntimeInventory | undefined> {
  if (baseUrl === undefined || baseUrl.length === 0) return undefined
  const started = Date.now()
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, INVENTORY_FETCH_TIMEOUT_MS)
  try {
    const inventory = await fetchRuntimeInventory(baseUrl, channel, branch, fetch, controller.signal)
    report(`runtime inventory fetched in ${Date.now() - started}ms, ${inventory.packages.size} packages`)
    return inventory
  } catch (cause) {
    report(`runtime inventory unavailable after ${Date.now() - started}ms: ${cause instanceof Error ? cause.message : String(cause)}`)
    return undefined
  } finally {
    clearTimeout(timer)
  }
}

/** Bundle names the Profile manifest declares, or an empty list when it declares none. */
export function readProfileBundleNames(profileDir: string): readonly string[] {
  let parsed: unknown
  try {
    parsed = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8')) as unknown
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return []
  const dsh = (parsed as { dsh?: unknown }).dsh
  if (dsh === null || typeof dsh !== 'object' || Array.isArray(dsh)) return []
  const profile = (dsh as { profile?: unknown }).profile
  if (profile === null || typeof profile !== 'object' || Array.isArray(profile)) return []
  const bundles = (profile as { bundles?: unknown }).bundles
  if (!Array.isArray(bundles)) return []
  return bundles.filter((name): name is string => typeof name === 'string' && PACKAGE_NAME_PATTERN.test(name))
}

/**
 * Reading of what the offered release would stop supplying.
 *
 * A name the inventory lists is present. A name it does not list is absent only
 * when the inventory claims to speak about that name; otherwise the reading for
 * that bundle is left undecided, and undecided bundles are never reported.
 */
export function previewUpgradeSupply(input: UpgradeSupplyInput): ProfileSupplyReport {
  const installed = createProfileSupplyProbe([input.profileDir])
  const { packages, scopes } = input.target
  const speaksAbout = (packageName: string): boolean =>
    scopes.length === 0 || scopes.some(scope => packageName.startsWith(scope))
  const presence = (packageName: string): SupplyPresence =>
    packages.has(packageName) ? 'present' : speaksAbout(packageName) ? 'absent' : 'undecidable'
  return checkProfileSupply(input.bundleNames, {
    readBundleManifest: installed.readBundleManifest,
    presence,
  })
}
