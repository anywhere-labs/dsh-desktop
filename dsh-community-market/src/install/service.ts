import { randomBytes } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'
import type { BundleInfo, ChangeResult, InstallBundleOptions, ManagementError, PluginInfo } from '@deepseek-ai/dsh-plugin-manager'
import { prerelease, valid } from 'semver'
import type {
  MarketCatalogMetadata,
  MarketInstallableResponse,
  MarketInstallationView,
  MarketOperationApplication,
  MarketSourceView,
} from '../api-types.js'
import type { CatalogHttpClient } from '../contracts/types.js'
import {
  normalizeGitHubInstallSource,
  type CatalogSnapshot,
  type NormalizedGitHubInstallSource,
} from '../contracts/index.js'
import {
  createGitHubPackageVerifier,
  githubPackageTarget,
  type GitHubPackageVerification,
} from './github.js'
import { manualInstallHints } from './manual.js'

const NPM_REGISTRY_ORIGIN = 'https://registry.npmjs.org'
const PACKAGE_NAME_PATTERN = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/u
const INSTALL_INTENT_TTL_MS = 5 * 60 * 1000
const CANDIDATE_TTL_MS = 30 * 60 * 1000
const MAX_INTENTS = 256
const MAX_CANDIDATES = 10_000
/** How long a saved selection may keep activating before its pending rows count as a failure. */
const ACTIVATION_GRACE_MS = 5000
const ACTIVATION_POLL_MS = 250
const BLOCKED_PRODUCT_PACKAGES = new Set([
  'dsh-plugin-desktop',
  'dsh-plugin-desktop-beta',
  'dsh-desktop-next',
  'dsh-community-market',
])
/** Bundles Desktop ships and manages on the official Plugins page; the Market lists none of them. */
const DESKTOP_BUILT_IN_BUNDLES = new Set([
  ...BLOCKED_PRODUCT_PACKAGES,
  'dshmarket',
  '@agents-anywhere/dsh-bridge-next',
])
/** DeepSeek's own packages are official plugins whatever the manager's catalog flags say. */
const OFFICIAL_SCOPE = '@deepseek-ai/'

export interface MarketDesktopProfile {
  readonly name: string
  readonly dir: string
}

/**
 * The official profile plugin manager operations the Market delegates every
 * package mutation to. The upstream `pluginManager` service satisfies this
 * interface structurally; tests supply an in-memory implementation.
 */
export interface MarketPluginManager {
  listBundles(): Promise<readonly BundleInfo[]>
  listPlugins(): Promise<readonly PluginInfo[]>
  installBundle(spec: string, options?: InstallBundleOptions): Promise<ChangeResult>
  setBundleEnabled(name: string, enabled: boolean): Promise<ChangeResult>
  removeBundle(name: string): Promise<ChangeResult>
}

export interface MarketInstallPreview {
  readonly intent: string
  readonly action: 'install'
  readonly profileName: string
  readonly packageName: string
  readonly version: string
  readonly displayName: string
  readonly expiresAt: string
}

export interface MarketUninstallPreview {
  readonly intent: string
  readonly action: 'uninstall'
  readonly profileName: string
  readonly packageName: string
  readonly version?: string
  readonly displayName: string
  readonly expiresAt: string
}

export interface MarketInstallResult {
  readonly packageName: string
  readonly version: string
  readonly application: MarketOperationApplication
}

export interface MarketUninstallResult {
  readonly packageName: string
  readonly application: MarketOperationApplication
}

export interface MarketToggleResult {
  readonly packageName: string
  readonly enabled: boolean
  readonly application: MarketOperationApplication
}

export type MarketOperationResult =
  | ({ readonly action: 'install' } & MarketInstallResult)
  | ({ readonly action: 'uninstall' } & MarketUninstallResult)

export type MarketInstallErrorCode =
  | 'invalid-request'
  | 'not-available'
  | 'conflict'
  | 'intent-expired'
  | 'verification-failed'
  | 'operation-failed'
  | 'persistence-failed'

/** Error whose message is safe to return through the loopback API. */
export class MarketInstallError extends Error {
  constructor(
    readonly code: MarketInstallErrorCode,
    message: string,
    readonly details?: string,
  ) {
    super(message)
    this.name = 'MarketInstallError'
  }
}

interface InstallCandidate {
  readonly key: string
  readonly sourceRecordId: string
  readonly providerId: string
  readonly itemId: string
  readonly displayName: string
  readonly packageName?: string
  readonly source?: NormalizedGitHubInstallSource
  readonly savedAt: number
}

interface InstallIntent {
  readonly kind: 'install'
  readonly candidate: InstallCandidate
  readonly verification: MarketPackageVerification
  readonly profile: MarketDesktopProfile
  readonly expiresAt: number
}

interface UninstallIntent {
  readonly kind: 'uninstall'
  readonly packageName: string
  readonly displayName: string
  readonly profile: MarketDesktopProfile
  readonly expiresAt: number
}

type MarketIntent = InstallIntent | UninstallIntent

export interface MarketNpmPackageVerifier {
  verify(
    candidate: Pick<InstallCandidate, 'packageName'>,
    signal: AbortSignal,
  ): Promise<MarketNpmPackageVerification>
}

export interface MarketNpmPackageVerification {
  readonly version: string
}

export interface MarketPackageVerification extends MarketNpmPackageVerification {
  readonly packageName?: string
  readonly source?: NormalizedGitHubInstallSource
}

export interface MarketInstallCandidateInput {
  readonly packageName?: string
  readonly source?: NormalizedGitHubInstallSource
}

export interface MarketPackageVerifier {
  verify(candidate: MarketInstallCandidateInput, signal: AbortSignal): Promise<MarketPackageVerification>
}

export interface MarketInstallServiceOptions {
  readonly now?: () => number
  readonly intentTtlMs?: number
  readonly candidateTtlMs?: number
  readonly maxIntents?: number
  readonly maxCandidates?: number
  /** How long a saved selection may keep activating before its pending rows count as a failure. */
  readonly activationGraceMs?: number
  /** How often the activation of a saved selection is re-read during the grace period. */
  readonly activationPollMs?: number
  /** Receives bounded package-manager failures for the Desktop persistent log. */
  readonly logFailure?: (message: string) => void
}

function stableExactVersion(value: unknown): value is string {
  return typeof value === 'string'
    && valid(value, { loose: false }) === value
    && prerelease(value, { loose: false }) === null
}

function safePackageName(value: unknown): value is string {
  return typeof value === 'string' && PACKAGE_NAME_PATTERN.test(value)
}

function marketManagedPackage(value: string): boolean {
  return !BLOCKED_PRODUCT_PACKAGES.has(value)
}

function candidateKey(sourceRecordId: string, itemId: string): string {
  return `${sourceRecordId}\0${itemId}`
}

function opaqueToken(): string {
  return randomBytes(32).toString('base64url')
}

function safeBundlePatch(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 512 || value.includes('\0')) return false
  const path = value.startsWith('./') ? value.slice(2) : value
  return path.length > 0
    && !path.startsWith('/')
    && !path.includes('\\')
    && path.split('/').every(segment => segment.length > 0 && segment !== '.' && segment !== '..' && !segment.includes(':'))
}

/** Resolve npm `latest` and confirm only the minimum DSH package shape. */
export function createNpmRegistryVerifier(http: CatalogHttpClient): MarketNpmPackageVerifier {
  return {
    async verify(candidate, signal) {
      if (
        !safePackageName(candidate.packageName)
        || !marketManagedPackage(candidate.packageName)
      ) {
        throw new MarketInstallError('verification-failed', 'The plugin package target is invalid.')
      }
      const url = `${NPM_REGISTRY_ORIGIN}/${encodeURIComponent(candidate.packageName)}/latest`
      let response
      try {
        response = await http.getJson(url, signal, { allowedOrigin: NPM_REGISTRY_ORIGIN })
      } catch {
        throw new MarketInstallError('verification-failed', 'The plugin package could not be verified with npm.')
      }
      let finalOrigin: string
      try { finalOrigin = new URL(response.finalUrl).origin }
      catch { throw new MarketInstallError('verification-failed', 'The npm verification response was invalid.') }
      const metadata = response.value
      if (
        finalOrigin !== NPM_REGISTRY_ORIGIN
        || metadata === null
        || typeof metadata !== 'object'
        || Array.isArray(metadata)
      ) {
        throw new MarketInstallError('verification-failed', 'The npm verification response was invalid.')
      }
      const manifest = metadata as Record<string, unknown>
      if (manifest.name !== candidate.packageName || !stableExactVersion(manifest.version)) {
        throw new MarketInstallError('verification-failed', 'The npm package identity did not match the catalog.')
      }
      const dsh = manifest.dsh
      const bundle = dsh !== null && typeof dsh === 'object' && !Array.isArray(dsh)
        ? (dsh as Record<string, unknown>).bundle
        : undefined
      const patch = bundle !== null && typeof bundle === 'object' && !Array.isArray(bundle)
        ? (bundle as Record<string, unknown>).patch
        : undefined
      if (!safeBundlePatch(patch)) {
        throw new MarketInstallError('verification-failed', 'The npm package does not declare a valid DSH bundle.')
      }
      return { version: manifest.version }
    },
  }
}

/** Combine the stable npm verifier and the pinned GitHub manifest verifier. */
export function createMarketPackageVerifier(
  http: CatalogHttpClient,
): MarketPackageVerifier {
  const npm = createNpmRegistryVerifier(http)
  return {
    async verify(candidate, signal) {
      if (candidate.source !== undefined) {
        try {
          const verification: GitHubPackageVerification = await createGitHubPackageVerifier(http)
            .verify(candidate.source, signal)
          return verification
        } catch (cause) {
          signal.throwIfAborted()
          throw new MarketInstallError(
            'verification-failed',
            cause instanceof Error ? cause.message : 'The GitHub package could not be verified.',
          )
        }
      }
      if (candidate.packageName === undefined) {
        throw new MarketInstallError('verification-failed', 'The plugin install source is incomplete.')
      }
      return await npm.verify({ packageName: candidate.packageName }, signal)
    },
  }
}

/** Whether the official manager already holds the package: declared, selected, or shipped by the installation. */
function bundleKnown(bundle: BundleInfo): boolean {
  return bundle.installed || bundle.enabled || bundle.availability === 'installation'
}

/**
 * Whether the Installed view lists a bundle: a community plugin the profile
 * declares or selects. Official bundles, bundles the installation ships,
 * DeepSeek's own scope, and Desktop's built-in bundles are managed on the
 * official Plugins page and stay out of the Market; absent on-demand catalog
 * entries and unselected shipped bundles are not part of the profile at all.
 */
function marketListedBundle(bundle: BundleInfo): boolean {
  return !bundle.official
    && bundle.availability !== 'installation'
    && !bundle.name.startsWith(OFFICIAL_SCOPE)
    && !DESKTOP_BUILT_IN_BUNDLES.has(bundle.name)
    && (bundle.installed || bundle.enabled)
}

/**
 * Project one official bundle onto the Installed view, or nothing for a bundle
 * the Market does not list. Actions follow the manager's flags: a bundle it
 * protects is read-only, and a bundle it cannot read can be switched off but not on.
 */
export function marketInstallationView(bundle: BundleInfo): MarketInstallationView | undefined {
  if (!marketListedBundle(bundle)) return undefined
  const editable = bundle.readOnlyReason === undefined
  return {
    kind: 'profile',
    packageName: bundle.name,
    ...(bundle.version === undefined ? {} : { version: bundle.version }),
    enabled: bundle.enabled,
    installed: bundle.installed,
    // A bundle the Host cannot read can still be switched off, never on.
    toggleable: editable && (bundle.enabled || bundle.error === undefined),
    removable: editable && bundle.removable,
    ...(bundle.error === undefined ? {} : { error: bundle.error.code }),
  }
}

/** A safe sentence for the management refusal codes the official manager reports. */
function managementMessage(error: ManagementError | undefined): string | undefined {
  switch (error?.code) {
    case undefined: return undefined
    case 'incompatible-version': {
      const named = (error.incompatible ?? []).map(plugin => `${plugin.name}@${plugin.version}`).join(', ')
      return `The plugin is not compatible with the running DSH version${named === '' ? '' : ` (${named})`}.`
    }
    case 'already-installed': return 'This plugin is already managed by the active profile.'
    case 'not-bundle': return 'The package does not declare a DSH plugin bundle.'
    case 'ambiguous-install': return 'The package manager changed more than one dependency, so the installed plugin could not be identified.'
    case 'not-removable': return 'This plugin cannot be removed by the plugin manager.'
    case 'stop-profile': return 'This plugin started the current process. Stop DSH before removing it.'
    case 'bundle-in-use': return 'This plugin is still running and could not be unloaded.'
    case 'management-required': return 'This plugin is part of the plugin management components and cannot be changed here.'
    case 'unaddressable':
    case 'unknown-plugin': return 'The plugin manager could not address this plugin.'
    case 'invalid-spec': return 'The plugin manager rejected the install target.'
    case 'stale-approval': return 'The build-script approval is no longer current.'
    case 'operation-error': return undefined
    default: return undefined
  }
}

/** Host-owned package workflow over the official plugin manager. No provider command or Renderer package spec crosses this boundary. */
export class MarketInstallService {
  private readonly candidates = new Map<string, InstallCandidate>()
  private readonly intents = new Map<string, MarketIntent>()
  private readonly now: () => number
  private readonly intentTtlMs: number
  private readonly candidateTtlMs: number
  private readonly maxIntents: number
  private readonly maxCandidates: number
  private readonly activationGraceMs: number
  private readonly activationPollMs: number
  private readonly logFailure: ((message: string) => void) | undefined
  private readonly generation = new AbortController()
  private operationActive = false
  private closed = false

  constructor(
    private readonly currentProfile: () => MarketDesktopProfile,
    private readonly manager: MarketPluginManager,
    private readonly verifier: MarketPackageVerifier,
    options: MarketInstallServiceOptions = {},
  ) {
    this.now = options.now ?? Date.now
    this.intentTtlMs = options.intentTtlMs ?? INSTALL_INTENT_TTL_MS
    this.candidateTtlMs = options.candidateTtlMs ?? CANDIDATE_TTL_MS
    this.maxIntents = options.maxIntents ?? MAX_INTENTS
    this.maxCandidates = options.maxCandidates ?? MAX_CANDIDATES
    this.activationGraceMs = options.activationGraceMs ?? ACTIVATION_GRACE_MS
    this.activationPollMs = options.activationPollMs ?? ACTIVATION_POLL_MS
    this.logFailure = options.logFailure
    for (const [label, value] of [
      ['intent TTL', this.intentTtlMs],
      ['candidate TTL', this.candidateTtlMs],
      ['intent limit', this.maxIntents],
      ['candidate limit', this.maxCandidates],
      ['activation grace', this.activationGraceMs],
      ['activation poll interval', this.activationPollMs],
    ] as const) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError(`invalid market install ${label}`)
    }
  }

  observeCatalog(snapshot: CatalogSnapshot): void {
    if (this.closed) return
    this.purge()
    for (const item of snapshot.items) {
      const key = candidateKey(snapshot.source.sourceRecordId, item.id)
      this.candidates.delete(key)
      let source: NormalizedGitHubInstallSource | undefined
      if (item.installSource !== undefined) {
        try { source = normalizeGitHubInstallSource(item.repository, item.installSource) }
        catch { continue }
      }
      const packageName = source === undefined && item.package?.registry === 'npm' && safePackageName(item.package.name)
        ? item.package.name
        : undefined
      if (
        item.provenance.sourceRecordId !== snapshot.source.sourceRecordId
        || item.provenance.providerId !== snapshot.source.providerId
        || item.provenance.itemId !== item.id
        || (packageName === undefined && source === undefined)
        || (packageName !== undefined && !marketManagedPackage(packageName))
      ) {
        continue
      }
      const candidate: InstallCandidate = {
        key,
        sourceRecordId: snapshot.source.sourceRecordId,
        providerId: snapshot.source.providerId,
        itemId: item.id,
        displayName: item.displayName,
        ...(packageName === undefined ? {} : { packageName }),
        ...(source === undefined ? {} : { source }),
        savedAt: this.now(),
      }
      this.candidates.set(key, candidate)
      this.trim(this.candidates, this.maxCandidates)
    }
  }

  invalidateSource(sourceRecordId: string): void {
    for (const [key, candidate] of this.candidates) {
      if (candidate.sourceRecordId === sourceRecordId) {
        this.candidates.delete(key)
      }
    }
    for (const [token, intent] of this.intents) {
      if (intent.kind === 'install' && intent.candidate.sourceRecordId === sourceRecordId) this.intents.delete(token)
    }
  }

  listInstallablePage(
    source: MarketSourceView,
    snapshot: CatalogSnapshot,
    categories: readonly string[],
    signal: AbortSignal,
    metadata?: MarketCatalogMetadata,
  ): MarketInstallableResponse {
    const operationSignal = this.operationSignal(signal)
    operationSignal.throwIfAborted()
    this.purge()
    this.observeCatalog(snapshot)
    const items = snapshot.items.filter(item => {
      const candidate = this.candidates.get(candidateKey(source.sourceRecordId, item.id))
      return candidate !== undefined
        && candidate.providerId === item.provenance.providerId
    })
    operationSignal.throwIfAborted()
    return {
      source,
      items,
      categories,
      manualInstall: manualInstallHints(items),
      ...(snapshot.page.nextCursor === undefined ? {} : { nextCursor: snapshot.page.nextCursor }),
      ...(metadata === undefined ? {} : { metadata }),
      fetchedAt: new Date(this.now()).toISOString(),
    }
  }

  /** Read the active profile's bundles as the official manager reports them. */
  async listInstallations(signal: AbortSignal): Promise<readonly MarketInstallationView[]> {
    const operationSignal = this.operationSignal(signal)
    const bundles = await this.listBundles()
    operationSignal.throwIfAborted()
    return bundles.flatMap(bundle => {
      const view = marketInstallationView(bundle)
      return view === undefined ? [] : [view]
    })
  }

  async previewInstall(
    sourceRecordId: string,
    itemId: string,
    signal: AbortSignal,
  ): Promise<MarketInstallPreview> {
    const operationSignal = this.operationSignal(signal)
    operationSignal.throwIfAborted()
    this.purge()
    const key = candidateKey(sourceRecordId, itemId)
    const candidate = this.candidates.get(key)
    if (candidate === undefined) {
      throw new MarketInstallError('not-available', 'This catalog item has no verified install target. Refresh the active source and try again.')
    }
    const profile = this.profile()
    if (candidate.packageName !== undefined) await this.assertNotInstalled(candidate.packageName)
    let verification: MarketPackageVerification
    try { verification = await this.verifier.verify(candidate, operationSignal) }
    catch (cause) {
      operationSignal.throwIfAborted()
      throw cause
    }
    operationSignal.throwIfAborted()
    this.assertOpen()
    if (this.candidates.get(key) !== candidate) {
      throw new MarketInstallError('not-available', 'The catalog source changed during verification. Refresh it and try again.')
    }
    const token = this.issueIntent({
      kind: 'install',
      candidate,
      verification,
      profile,
      expiresAt: this.now() + this.intentTtlMs,
    })
    const packageName = verification.packageName ?? candidate.packageName
    if (packageName === undefined || !safePackageName(packageName)) {
      throw new MarketInstallError('verification-failed', 'The verified package name is invalid.')
    }
    await this.assertNotInstalled(packageName)
    return {
      intent: token,
      action: 'install',
      profileName: profile.name,
      packageName,
      version: verification.version,
      displayName: candidate.displayName,
      expiresAt: new Date(this.now() + this.intentTtlMs).toISOString(),
    }
  }

  async executeInstall(token: string, signal: AbortSignal): Promise<MarketInstallResult> {
    return await this.runExclusive(async () => {
      const operationSignal = this.operationSignal(signal)
      const intent = this.consumeIntent(token, 'install')
      this.sameProfile(intent.profile)
      const candidate = intent.candidate
      if (this.candidates.get(candidate.key) !== candidate) {
        throw new MarketInstallError('not-available', 'The verified catalog item is no longer available.')
      }
      const verification = intent.verification
      const packageName = verification.packageName ?? candidate.packageName
      if (packageName === undefined || !safePackageName(packageName)) {
        throw new MarketInstallError('verification-failed', 'The verified package name is invalid.')
      }
      await this.assertNotInstalled(packageName)
      if (this.candidates.get(candidate.key) !== candidate) {
        throw new MarketInstallError('not-available', 'The catalog source changed before installation.')
      }
      operationSignal.throwIfAborted()
      const target = candidate.source === undefined
        ? `${packageName}@${verification.version}`
        : githubPackageTarget(candidate.source)
      // The official manager validates the bundle, restores the profile files on
      // failure, selects the bundle, and applies it live where HMR is mounted. A
      // bundle it installed and selected but judged before its rows activated is
      // given the same activation grace as a toggle.
      const result = await this.runChange(
        () => this.manager.installBundle(target, { enabled: true, saveExact: true }),
        'The plugin could not be installed.',
        failed => failed.bundle === undefined ? Promise.resolve(false) : this.awaitActivation(failed.bundle, true, failed, operationSignal),
      )
      const installed = result.bundle ?? packageName
      if (installed !== packageName) {
        throw this.packageManagerError(
          'The package manager installed a different package than the verified target.',
          `expected ${packageName}, installed ${installed}`,
        )
      }
      return { packageName, version: result.version ?? verification.version, application: result.application }
    })
  }

  async executePreview(token: string, signal: AbortSignal): Promise<MarketOperationResult> {
    this.assertOpen()
    this.purge()
    const intent = this.intents.get(token)
    if (intent === undefined) {
      throw new MarketInstallError('intent-expired', 'The confirmation expired or was already used. Preview the operation again.')
    }
    const result: MarketOperationResult = intent.kind === 'install'
      ? { action: 'install', ...await this.executeInstall(token, signal) }
      : { action: 'uninstall', ...await this.executeUninstall(token, signal) }
    return result
  }

  async previewUninstallPackage(packageName: string, signal: AbortSignal): Promise<MarketUninstallPreview> {
    const operationSignal = this.operationSignal(signal)
    operationSignal.throwIfAborted()
    const profile = this.profile()
    const bundle = await this.removableBundle(packageName)
    operationSignal.throwIfAborted()
    const expiresAt = this.now() + this.intentTtlMs
    const token = this.issueIntent({
      kind: 'uninstall',
      packageName,
      displayName: packageName,
      profile,
      expiresAt,
    })
    return {
      intent: token,
      action: 'uninstall',
      profileName: profile.name,
      packageName,
      ...(bundle.version === undefined ? {} : { version: bundle.version }),
      displayName: packageName,
      expiresAt: new Date(expiresAt).toISOString(),
    }
  }

  async executeUninstall(token: string, signal: AbortSignal): Promise<MarketUninstallResult> {
    return await this.runExclusive(async () => {
      const operationSignal = this.operationSignal(signal)
      const intent = this.consumeIntent(token, 'uninstall')
      this.sameProfile(intent.profile)
      await this.removableBundle(intent.packageName)
      operationSignal.throwIfAborted()
      // The official manager deselects and unloads the bundle before pnpm removes it.
      const result = await this.runChange(
        () => this.manager.removeBundle(intent.packageName),
        'The plugin could not be removed.',
      )
      return { packageName: intent.packageName, application: result.application }
    })
  }

  /** Select or deselect one profile bundle's layer through the official manager, keeping its dependency installed. */
  async setEnabled(packageName: string, enabled: boolean, signal: AbortSignal): Promise<MarketToggleResult> {
    return await this.runExclusive(async () => {
      const operationSignal = this.operationSignal(signal)
      if (!safePackageName(packageName) || !marketManagedPackage(packageName)) {
        throw new MarketInstallError('invalid-request', 'The Profile plugin package name is invalid.')
      }
      const view = (await this.listInstallations(operationSignal)).find(item => item.packageName === packageName)
      if (view === undefined || !view.toggleable) {
        throw new MarketInstallError('not-available', 'This plugin can no longer be enabled or disabled here. Refresh and try again.')
      }
      operationSignal.throwIfAborted()
      const result = await this.runChange(
        () => this.manager.setBundleEnabled(packageName, enabled),
        enabled ? 'The plugin could not be enabled.' : 'The plugin could not be disabled.',
        failed => this.awaitActivation(packageName, enabled, failed, operationSignal),
      )
      return { packageName, enabled, application: result.application }
    })
  }

  dispose(): void {
    if (this.closed) return
    this.closed = true
    this.generation.abort(new DOMException('Market install service was disposed', 'AbortError'))
    this.candidates.clear()
    this.intents.clear()
  }

  private profile(): MarketDesktopProfile {
    const profile = this.currentProfile()
    if (!profile.name || !isAbsolute(profile.dir) || profile.dir.includes('\0')) {
      throw new MarketInstallError('operation-failed', 'The active profile is unavailable.')
    }
    return Object.freeze({ name: profile.name, dir: resolve(profile.dir) })
  }

  private sameProfile(expected: MarketDesktopProfile): MarketDesktopProfile {
    const current = this.profile()
    if (current.name !== expected.name || current.dir !== expected.dir) {
      throw new MarketInstallError('conflict', 'The active profile changed after preview.')
    }
    return current
  }

  private async listBundles(): Promise<readonly BundleInfo[]> {
    try {
      return await this.manager.listBundles()
    } catch (cause) {
      throw this.packageManagerError(
        'The plugin manager could not read the active profile.',
        cause instanceof Error ? cause.message : String(cause),
      )
    }
  }

  private async assertNotInstalled(packageName: string): Promise<void> {
    const bundles = await this.listBundles()
    if (bundles.some(bundle => bundle.name === packageName && bundleKnown(bundle))) {
      throw new MarketInstallError('conflict', 'This plugin is already managed by the active profile.')
    }
  }

  private async removableBundle(packageName: string): Promise<BundleInfo> {
    if (!safePackageName(packageName) || !marketManagedPackage(packageName)) {
      throw new MarketInstallError('invalid-request', 'The Profile plugin package name is invalid.')
    }
    const bundle = (await this.listBundles()).find(item => item.name === packageName)
    if (bundle === undefined || marketInstallationView(bundle)?.removable !== true) {
      throw new MarketInstallError('conflict', 'This plugin is no longer a removable dependency of the active Profile.')
    }
    return bundle
  }

  /**
   * Run one official change and settle it: an applied, restart-pending or
   * overridden change returns; a failed or cancelled one becomes a Market
   * error carrying the manager's bounded pnpm output for the failure dialog
   * and the Desktop log. `recover` may turn a failed change whose files were
   * saved into an applied one once the Host state settles.
   */
  private async runChange(
    operation: () => Promise<ChangeResult>,
    fallback: string,
    recover?: (failed: ChangeResult) => Promise<boolean>,
  ): Promise<ChangeResult & { readonly application: MarketOperationApplication }> {
    let result: ChangeResult
    try {
      result = await operation()
    } catch (cause) {
      throw this.packageManagerError(
        'The plugin manager could not run the package operation.',
        cause instanceof Error ? cause.stack ?? cause.message : String(cause),
      )
    }
    switch (result.application) {
      case 'applied':
      case 'restart-required':
      case 'overridden':
        return { ...result, application: result.application }
      case 'cancelled':
        throw this.packageManagerError('The package operation was cancelled.', result.packageResult?.output ?? '')
      case 'failed': {
        if (result.changed && recover !== undefined && await recover(result)) return { ...result, application: 'applied' }
        const details = [
          result.error?.diagnostic ?? '',
          result.packageResult?.output ?? '',
          result.pendingBuilds === undefined || result.pendingBuilds.length === 0
            ? ''
            : `pending build scripts: ${result.pendingBuilds.join(', ')}`,
        ].filter(section => section.trim().length > 0).join('\n\n')
        throw this.packageManagerError(managementMessage(result.error) ?? fallback, details)
      }
    }
  }

  /**
   * Whether a saved selection the manager reported as failed has in fact
   * settled. The manager judges activation the moment its reload returns, so a
   * row still waiting for a service it injects counts as a failure there even
   * when it activates right after; the Market re-reads the rows' live phases
   * for a bounded grace period and accepts the change once every row of an
   * enabled bundle is active, or no row of a disabled bundle is live. A row
   * that fails, a selection that does not match, or a bundle the manager
   * cannot read keeps the original failure.
   * @returns true once the requested selection is live.
   */
  private async awaitActivation(name: string, enabled: boolean, failed: ChangeResult, signal: AbortSignal): Promise<boolean> {
    const deadline = this.now() + this.activationGraceMs
    while (!signal.aborted) {
      const bundle = (await this.manager.listBundles()).find(item => item.name === name)
      if (bundle === undefined || bundle.enabled !== enabled || bundle.error !== undefined) return false
      if (!enabled) {
        if (bundle.rows.every(row => row.entryId === undefined)) return true
      } else if (bundle.rows.length > 0 && bundle.rows.every(row => row.entryId !== undefined)) {
        const plugins = await this.manager.listPlugins()
        const phases = bundle.rows.map(row => plugins.find(plugin => plugin.entryId === row.entryId)?.fiberPhase)
        if (phases.some(phase => phase === 'failed' || phase === undefined)) return false
        if (phases.every(phase => phase === 'active')) return true
      }
      if (this.now() >= deadline) return false
      await new Promise<void>(resolve => {
        const finish = (): void => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve() }
        const timer = setTimeout(finish, this.activationPollMs)
        signal.addEventListener('abort', finish, { once: true })
      })
    }
    this.logFailure?.(`dsh-community-market: activation wait for ${name} ended before the Host settled: ${failed.error?.diagnostic ?? ''}`)
    return false
  }

  private issueIntent(intent: MarketIntent): string {
    this.assertOpen()
    this.purge()
    let token = opaqueToken()
    while (this.intents.has(token)) token = opaqueToken()
    this.intents.set(token, intent)
    this.trim(this.intents, this.maxIntents)
    return token
  }

  private consumeIntent<K extends MarketIntent['kind']>(token: string, kind: K): Extract<MarketIntent, { kind: K }> {
    this.purge()
    const intent = this.intents.get(token)
    if (intent === undefined || intent.kind !== kind) {
      throw new MarketInstallError('intent-expired', 'The confirmation expired or was already used. Preview the operation again.')
    }
    this.intents.delete(token)
    return intent as Extract<MarketIntent, { kind: K }>
  }

  private purge(): void {
    const now = this.now()
    for (const [key, candidate] of this.candidates) {
      if (now - candidate.savedAt >= this.candidateTtlMs) {
        this.candidates.delete(key)
      }
    }
    for (const [token, intent] of this.intents) {
      if (now >= intent.expiresAt) this.intents.delete(token)
    }
  }

  private trim<T>(map: Map<string, T>, limit: number): void {
    while (map.size > limit) {
      const oldest = map.keys().next().value as string | undefined
      if (oldest === undefined) return
      map.delete(oldest)
    }
  }

  private async runExclusive<T>(task: () => Promise<T>): Promise<T> {
    this.assertOpen()
    if (this.operationActive) throw new MarketInstallError('conflict', 'Another market package operation is already running.')
    this.operationActive = true
    try {
      return await task()
    } finally {
      this.operationActive = false
    }
  }

  private assertOpen(): void {
    if (this.closed) throw new MarketInstallError('operation-failed', 'The market install service is unavailable.')
  }

  private operationSignal(signal: AbortSignal): AbortSignal {
    signal.throwIfAborted()
    this.assertOpen()
    return AbortSignal.any([signal, this.generation.signal])
  }

  private packageManagerError(message: string, details: string): MarketInstallError {
    try { this.logFailure?.(`dsh-community-market: ${message}${details === '' ? '' : `\n${details}`}`) } catch {}
    return new MarketInstallError('operation-failed', message, ...(details === '' ? [] : [details]))
  }
}
