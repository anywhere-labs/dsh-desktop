/** Compatibility profile composition over the official Web bundle and user plugins. */

import { createRequire } from 'node:module'
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  rmdirSync,
  statSync,
  type Dirent,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isIP } from 'node:net'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { evaluate, isJsExpr, type EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  composeEntries,
  DEFAULT_PROFILE_PATCH_RELOAD,
  healProfilesModuleFallback,
  initProfile,
  loadOptionalPatches,
  loadOverlayPatches,
  PROFILE_PATCH_FILENAME,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveProfileDir,
  writeProfileManifest,
  type Profile,
  type ProfileManifest,
  type ProfileTemplate,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import FileSettingsProvider, {
  resolveSpec as resolveSettingsFileSpec,
  type Config as SettingsFileConfig,
} from '@deepseek-ai/dsh-settings-file'
import { parseAllDocuments, parseDocument } from 'yaml'
import { findOverlayPackage, resolveOverlayPackage } from './package-overlay.ts'
import { withAsarModuleResolver } from './asar-module-resolver-state.ts'
import { DESKTOP_DEFAULT_WEB_PORT } from './desktop-port.ts'
import {
  desktopBrowserAccessEnabled,
  desktopNetworkExposureForBrowserAccess,
  desktopWebServerHost,
  parseDesktopNetworkExposure,
  parseDesktopOpenBrowser,
  type DesktopNetworkExposure,
} from './desktop-network.ts'
import type { DesktopShellMode } from './runtime.ts'
import {
  DESKTOP_PACKAGE_NAME,
  DESKTOP_PACKAGE_NAMES,
} from './product-identity.ts'
import {
  DEFAULT_MACOS_WINDOW_MATERIAL,
  DEFAULT_WINDOWS_WINDOW_MATERIAL,
  parseMacosWindowMaterial,
  parseWindowsWindowMaterial,
  type MacosWindowMaterial,
  type WindowsWindowMaterial,
} from './window-material.ts'
import {
  activeDesktopProfileLayers,
  desktopPluginBundleMutable,
  readDesktopDisabledBundles,
} from './desktop-plugins.ts'
import {
  DESKTOP_MARKET_IDENTITIES,
  desktopMarketSnapshotWithEffective,
  type DesktopMarketProvider,
  type DesktopMarketSnapshot,
} from './desktop-market.ts'

/** Persistent profile managed by the desktop launcher and the ordinary dsh plugin command. */
export const DESKTOP_PROFILE_NAME = 'desktop'

/** Standalone package name inserted through the launcher-owned desktop layer. */
export { DESKTOP_PACKAGE_NAME } from './product-identity.ts'

/** Empty include root rewritten before every profile boot. */
export const DESKTOP_PROFILE_ROOT = 'cordis.yml'

const AA_PACKAGE_NAME = '@agents-anywhere/dsh-bridge-next'
const AA_ROW_ID = 'agents-anywhere-bridge-next'
const BIN_NAME = DESKTOP_PACKAGE_NAME
const REQUIRED_BUNDLES = requiredWebBundles()
const REQUIRED_BUNDLE_SET = new Set(REQUIRED_BUNDLES)
const OBSOLETE_DESKTOP_BUNDLE_SET = new Set(['@deepseek-ai/dsh-desktop-app'])
// Electron's patched fs/module APIs read this logical ASAR path directly. The
// Desktop resolver bridges out-of-tree Profile plugins back into this virtual
// installation without materializing an incomplete ESM-only proxy tree.
const INSTALL_ANCHOR = fileURLToPath(new URL('../package.json', import.meta.url))
const DESKTOP_PATCH_PATH = fileURLToPath(new URL('../cordis.patch.yml', import.meta.url))
const DIRECTORY_PICKER_ROW_ID = 'directory-picker'
const AUTO_PICKER_PACKAGE = '@deepseek-ai/dsh-host-directory-picker-auto'
const BROWSE_PICKER_BACKEND = '@deepseek-ai/dsh-host-directory-picker-browse'
const BROWSE_PICKER_SURFACE = '@deepseek-ai/dsh-client-ui-directory-picker-browse'
const PWSH_SANDBOX_ROW_ID = 'pwsh-sandbox'
const UPSTREAM_PWSH_SANDBOX_PACKAGE = '@deepseek-ai/dsh-pwsh-sandbox'
const DESKTOP_WINDOWS_PWSH_SANDBOX_ROW_ID = 'desktop-windows-pwsh-sandbox'
const DESKTOP_WINDOWS_PWSH_SANDBOX_PACKAGE = `${DESKTOP_PACKAGE_NAME}/windows-pwsh-sandbox`
const AGENT_PRESETS_ROW_ID = 'agent-presets'
/** Harness-home directory holding locally authored presets (`agent-presets/discovery`). */
const USER_PRESET_DIRNAME = '.agent-presets'
const DEFAULT_DESKTOP_SHELL_MODE: DesktopShellMode = 'compatibility'
const DEFAULT_DESKTOP_PORT = DESKTOP_DEFAULT_WEB_PORT
const DESKTOP_WEB_SERVER_ROW_ID = 'desktop-webserver'
const DESKTOP_WEB_SERVER_PACKAGE = `${DESKTOP_PACKAGE_NAME}/webserver`
const SETTINGS_FILE_PACKAGE = '@deepseek-ai/dsh-settings-file'
const DESKTOP_SETTINGS_NAMESPACE = 'dsh-desktop'
const MAX_FALLBACK_MANIFEST_BYTES = 1024 * 1024
const UI_LAYOUT_PACKAGE = '@deepseek-ai/dsh-client-ui-layout'
const UI_SIDEBAR_PACKAGE = '@deepseek-ai/dsh-client-ui-sidebar'
const UI_CONVERSATION_PACKAGE = '@deepseek-ai/dsh-client-ui-conversation'
const DEFAULT_DESKTOP_MARKET_SNAPSHOT: DesktopMarketSnapshot = Object.freeze({
  requested: 'disabled',
  effective: 'disabled',
  legacyDefaulted: true,
})
const MARKET_ROW_IDS: ReadonlySet<string> = new Set([
  DESKTOP_MARKET_IDENTITIES.community.rowId,
  DESKTOP_MARKET_IDENTITIES.dshMarket.rowId,
])
const MARKET_PACKAGE_NAMES: ReadonlySet<string> = new Set([
  DESKTOP_MARKET_IDENTITIES.community.packageName,
  DESKTOP_MARKET_IDENTITIES.dshMarket.packageName,
])

/**
 * Parse desktop presentation state and reject corrupted values.
 * @param value - untrusted settings value.
 * @returns a supported desktop shell mode.
 */
export function parseDesktopShellMode(value: unknown): DesktopShellMode {
  if (value === undefined) return DEFAULT_DESKTOP_SHELL_MODE
  if (value === 'compatibility' || value === 'extended' || value === 'advanced') return value
  throw new Error(`${BIN_NAME}: ${DESKTOP_SETTINGS_NAMESPACE}.mode must be "compatibility", "extended", or "advanced"`)
}

/** Parse the requested loopback Web port and reject values Node cannot listen on. */
export function parseDesktopPort(value: unknown): number {
  if (value === undefined) return DEFAULT_DESKTOP_PORT
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 65_535) return value
  throw new Error(`${BIN_NAME}: ${DESKTOP_SETTINGS_NAMESPACE}.port must be an integer from 0 through 65535`)
}

/** Startup settings projected into the Loader graph before the settings plugin boots. */
export interface DesktopStartupSettings {
  mode: DesktopShellMode
  port: number
  macosMaterial: MacosWindowMaterial
  windowsMaterial: WindowsWindowMaterial
  /** Persisted compatibility key for ordinary-browser access permission. */
  openBrowser: boolean
  networkExposure: DesktopNetworkExposure
}

const DEFAULT_DESKTOP_STARTUP_SETTINGS: DesktopStartupSettings = Object.freeze({
  mode: DEFAULT_DESKTOP_SHELL_MODE,
  port: DEFAULT_DESKTOP_PORT,
  macosMaterial: DEFAULT_MACOS_WINDOW_MATERIAL,
  windowsMaterial: DEFAULT_WINDOWS_WINDOW_MATERIAL,
  openBrowser: false,
  networkExposure: 'loopback',
})

/**
 * Read Desktop startup settings from one parsed settings document.
 * @param document - untrusted settings document root.
 * @returns validated mode and port defaults for the next generation.
 */
export function desktopStartupSettingsFromSettings(document: unknown): DesktopStartupSettings {
  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new Error(`${BIN_NAME}: settings document must be a map of namespace sections`)
  }
  const section = (document as Record<string, unknown>)[DESKTOP_SETTINGS_NAMESPACE]
  if (section === undefined) {
    return { ...DEFAULT_DESKTOP_STARTUP_SETTINGS }
  }
  if (typeof section !== 'object' || section === null || Array.isArray(section)) {
    throw new Error(`${BIN_NAME}: ${DESKTOP_SETTINGS_NAMESPACE} settings must be a map`)
  }
  const values = section as Record<string, unknown>
  const mode = parseDesktopShellMode(values.mode)
  const networkExposure = parseDesktopNetworkExposure(values.networkExposure)
  const openBrowser = desktopBrowserAccessEnabled(
    mode,
    parseDesktopOpenBrowser(values.openBrowser),
    networkExposure,
  )
  return {
    mode,
    port: parseDesktopPort(values.port),
    macosMaterial: parseMacosWindowMaterial(values.macosMaterial),
    windowsMaterial: parseWindowsWindowMaterial(values.windowsMaterial),
    openBrowser,
    networkExposure: desktopNetworkExposureForBrowserAccess(openBrowser, networkExposure),
  }
}

/** Read only the shell mode from one parsed settings document. */
export function desktopShellModeFromSettings(document: unknown): DesktopShellMode {
  return desktopStartupSettingsFromSettings(document).mode
}

/**
 * Read startup settings from the same file resolved by the settings provider.
 * @param config - validated settings-file row config.
 * @returns the values projected into the startup Loader graph.
 */
export function readDesktopStartupSettings(config: SettingsFileConfig): DesktopStartupSettings {
  const spec = resolveSettingsFileSpec(config)
  let text: string
  try {
    text = readFileSync(spec.filename, 'utf8')
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...DEFAULT_DESKTOP_STARTUP_SETTINGS }
    }
    throw cause
  }
  let document: unknown
  if (spec.format === 'yaml') {
    const parsed = parseDocument(text, { prettyErrors: true })
    if (parsed.errors.length > 0) {
      throw new Error(`${BIN_NAME}: invalid settings document at ${spec.filename}: ${parsed.errors.map(error => error.message).join('; ')}`)
    }
    document = parsed.toJS() ?? {}
  } else {
    document = text.trim().length === 0 ? {} : JSON.parse(text)
  }
  return desktopStartupSettingsFromSettings(document)
}

/** Read only the shell mode from the settings provider's resolved file. */
export function readDesktopShellMode(config: SettingsFileConfig): DesktopShellMode {
  return readDesktopStartupSettings(config).mode
}

/** Resolve the public Web template once and reject an incompatible DSH release. */
function requiredWebBundles(): string[] {
  const template = PROFILE_TEMPLATES.web
  if (template === undefined) {
    throw new Error(`${BIN_NAME}: installed dsh-app-boot has no web profile template`)
  }
  return [...template.bundles]
}

/** User patch lifecycle inherited from the matching upstream Web profile. */
function requiredWebPatchReload(): ProfileTemplate['patchReload'] {
  const template = PROFILE_TEMPLATES.web
  if (template === undefined) {
    throw new Error(`${BIN_NAME}: installed dsh-app-boot has no web profile template`)
  }
  return template.patchReload
}

/** Prepared profile inputs consumed by app-boot. */
export interface PreparedDesktopProfile {
  /** Harness home shared by the launcher and generated command environment. */
  homeDir: string
  /** Resolved profile and its persistent user layer. */
  profile: Profile
  /** Absolute empty root config included by the Cordis Loader. */
  rootConfig: string
  /** Profile-owned parent URL used to resolve bare Cordis plugin packages. */
  bareModuleBaseUrl: string
  /** Complete ordered patch list for this desktop generation. */
  patches: PatchOptions[]
  /** Optional Client UI entries skipped because this profile cannot resolve them. */
  skippedOptionalEntries: SkippedOptionalEntry[]
  /** Persisted shell mode applied after every user-owned patch. */
  mode: DesktopShellMode
  /** Native translucency preference retained for macOS generations. */
  macosMaterial: MacosWindowMaterial
  /** Native backdrop preference retained for Windows generations. */
  windowsMaterial: WindowsWindowMaterial
  /** Persisted Web port applied to every startup consumer. */
  port: number
  /** Whether Desktop advertises the marker-free compatibility client for browser use. */
  openBrowser: boolean
  /** Listener scope applied to the Desktop-owned WebServer. */
  networkExposure: DesktopNetworkExposure
  /** Frozen LAN IPv4 snapshot trusted by this profile generation and its HTTPS edge. */
  lanAddresses: readonly string[]
  /** Resolved file-backed settings document used by this generation. */
  settingsDocument: string
  /** Requested provider and the fail-closed provider effective for this generation. */
  market: DesktopMarketSnapshot
  aaEnabled: boolean
  aaFailure?: string
  /** Internal boot diagnostic when the requested provider was disabled. */
  marketFailure?: string
  /** Whether packaged pnpm must rebuild a legacy Profile dependency layout. */
  requiresDependencyMigration: boolean
}

/** Optional observations emitted before profile preparation can fail. */
export interface DesktopProfilePreparationHooks {
  /** Explicit Profile choice; false also enforces safe-mode exclusion. */
  aaEnabled?: boolean

  /** Receive the trusted settings path before its contents are parsed. */
  onSettingsDocumentResolved?: (path: string) => void
  /** LAN IPv4 literals sampled once before this profile generation is composed. */
  lanAddresses?: readonly string[]
}

/** User patch entry skipped to keep a profile bootable. */
export interface SkippedOptionalEntry {
  /** Loader row id from the skipped entry. */
  id?: string
  /** Package name from the skipped entry. */
  name: string
}

/**
 * Normalize the installation-owned prefix while preserving third-party order.
 * @param current - current persistent bundle list.
 * @returns base, Web carrier, then every third-party bundle in prior order.
 */
export function desktopBundleList(current: readonly string[]): string[] {
  const thirdParty = current.filter(name => !REQUIRED_BUNDLE_SET.has(name)
    && !DESKTOP_PACKAGE_NAMES.has(name)
    && !OBSOLETE_DESKTOP_BUNDLE_SET.has(name))
  return [...REQUIRED_BUNDLES, ...thirdParty]
}

/** Return whether two ordered string lists are identical. */
function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

/**
 * Initialize or repair the persistent desktop profile.
 * @param home - Harness home containing the profiles directory.
 * @returns the absolute profile directory.
 */
export function ensureDesktopProfile(home: string = resolveDshHome()): string {
  const dir = resolveProfileDir(DESKTOP_PROFILE_NAME, home)
  if (!existsSync(join(dir, 'package.json'))) {
    initProfile(dir, REQUIRED_BUNDLES, requiredWebPatchReload())
  }
  const manifest = readProfileManifest(BIN_NAME, dir)
  const rawBundles = (manifest.dsh?.profile as { bundles?: unknown } | undefined)?.bundles
  if (rawBundles !== undefined
    && (!Array.isArray(rawBundles) || rawBundles.some(value => typeof value !== 'string'))) {
    throw new Error(`${BIN_NAME}: dsh.profile.bundles must be an array of package names`)
  }
  const current = rawBundles === undefined ? [] : rawBundles as string[]
  const bundles = desktopBundleList(current)
  const patchReload = requiredWebPatchReload()
  if (!sameList(current, bundles) || manifest.dsh?.profile?.patchReload !== patchReload) {
    writeProfileManifest(dir, {
      ...manifest,
      dsh: {
        ...manifest.dsh,
        profile: {
          ...manifest.dsh?.profile,
          bundles,
          patchReload,
        },
      },
    })
  }
  return dir
}

interface ParsedProfileYaml {
  readonly document: ReturnType<typeof parseDocument>
  readonly value: Record<string, unknown>
}

/** Parse one Profile-owned pnpm document as a YAML map. */
function parseProfileYaml(path: string): ParsedProfileYaml {
  const document = parseDocument(readFileSync(path, 'utf8'), { prettyErrors: true })
  if (document.errors.length > 0) {
    throw new Error(`${BIN_NAME}: invalid Profile pnpm document at ${path}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  const value = document.toJS()
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${BIN_NAME}: Profile pnpm document ${path} must hold a YAML map`)
  }
  return { document, value: value as Record<string, unknown> }
}

/** Apply the current out-of-tree plugin linker contract while preserving other workspace settings. */
function reconcileProfilePnpmWorkspace(profileDir: string): boolean {
  const path = join(profileDir, 'pnpm-workspace.yaml')
  if (!existsSync(path)) {
    writeFileSync(path, `packages:\n  - .\n\nnodeLinker: hoisted\nautoInstallPeers: false\n`)
    return true
  }
  const { document } = parseProfileYaml(path)
  let changed = false
  if (document.get('packages') === undefined) {
    document.set('packages', ['.'])
    changed = true
  }
  if (document.get('nodeLinker') !== 'hoisted') {
    document.set('nodeLinker', 'hoisted')
    changed = true
  }
  if (document.get('autoInstallPeers') !== false) {
    document.set('autoInstallPeers', false)
    changed = true
  }
  if (changed) writeFileSync(path, document.toString())
  return changed
}

/** Read the virtual-store path limit pnpm applies to this Profile. */
function profileVirtualStoreDirMaxLength(profileDir: string, platform: NodeJS.Platform): number {
  const configured = parseProfileYaml(join(profileDir, 'pnpm-workspace.yaml')).value.virtualStoreDirMaxLength
  if (configured === undefined) return platform === 'win32' ? 60 : 120
  if (typeof configured !== 'number' || !Number.isInteger(configured) || configured < 0) {
    throw new Error(`${BIN_NAME}: pnpm-workspace.yaml virtualStoreDirMaxLength must be a non-negative integer`)
  }
  return configured
}

/** Return whether private module metadata was written by a compatible pnpm generation. */
function compatiblePnpmPackageManager(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const match = /^pnpm@(\d+)(?:\.|$)/.exec(value)
  return match !== null && Number(match[1]) >= 10
}

/** Detect pnpm state that cannot satisfy the current hoisted Profile contract. */
function profileDependencyMigrationRequired(
  profileDir: string,
  workspaceChanged: boolean,
  platform: NodeJS.Platform,
): boolean {
  const manifest = readProfileManifest(BIN_NAME, profileDir)
  const hasDependencies = Object.keys(manifest.dependencies ?? {}).length > 0
  const modulesDir = join(profileDir, 'node_modules')
  const hasModules = existsSync(modulesDir)
  if (!hasDependencies && !hasModules) return false

  let modulesCompatible = false
  const modulesStatePath = join(modulesDir, '.modules.yaml')
  if (existsSync(modulesStatePath)) {
    try {
      const modulesState = parseProfileYaml(modulesStatePath).value
      modulesCompatible = modulesState.nodeLinker === 'hoisted'
        && compatiblePnpmPackageManager(modulesState.packageManager)
        && modulesState.virtualStoreDirMaxLength === profileVirtualStoreDirMaxLength(profileDir, platform)
    } catch {
      // pnpm can replace malformed or obsolete private module metadata.
    }
  }

  const lockfilePath = join(profileDir, 'pnpm-lock.yaml')
  let lockfileCompatible = !existsSync(lockfilePath) && !hasDependencies
  if (existsSync(lockfilePath)) {
    try {
      const settings = parseProfileYaml(lockfilePath).value.settings
      lockfileCompatible = typeof settings === 'object' && settings !== null
        && !Array.isArray(settings)
        && (settings as Record<string, unknown>).autoInstallPeers === false
    } catch {
      // A controlled non-frozen install owns lockfile reconciliation below.
    }
  }
  return workspaceChanged || !modulesCompatible || !lockfileCompatible
}

interface RecoveryFilteredProfile {
  readonly profile: Profile
  readonly dshMarketFailure?: string
  readonly aaFailure?: string
}

/** Render one provider failure without leaking an arbitrary thrown object into public state. */
function marketFailureMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Load a profile while resolving disabled third-party bundles only after they have been filtered.
 * Every direct bundle uses the same Desktop/Profile SemVer overlay that Loader imports use.
 * The `dshmarket` bundle is filtered before resolution unless explicitly selected.
 */
function loadRecoveryFilteredProfile(
  profileName: string,
  profileDir: string,
  disabledBundles: ReadonlySet<string>,
  marketProvider: DesktopMarketProvider,
  aaEnabled: boolean,
): RecoveryFilteredProfile {
  if (!existsSync(join(profileDir, 'package.json'))) {
    const template = PROFILE_TEMPLATES[profileName]
    if (template === undefined) {
      throw new Error(`${BIN_NAME}: profile ${JSON.stringify(profileName)} does not exist`)
    }
    initProfile(profileDir, template.bundles, template.patchReload)
  }
  const manifest = readProfileManifest(BIN_NAME, profileDir)
  const rawBundles = (manifest.dsh?.profile as { bundles?: unknown } | undefined)?.bundles
  if (rawBundles !== undefined
    && (!Array.isArray(rawBundles) || rawBundles.some(value => typeof value !== 'string'))) {
    throw new Error(`${BIN_NAME}: dsh.profile.bundles must be an array of package names`)
  }
  const bundles = (rawBundles ?? []) as string[]
  const rawPatchReload: unknown = manifest.dsh?.profile?.patchReload
  if (rawPatchReload !== undefined && rawPatchReload !== 'live' && rawPatchReload !== 'startup') {
    throw new Error(`${BIN_NAME}: dsh.profile.patchReload must be "live" or "startup"`)
  }
  const patchReload = rawPatchReload ?? PROFILE_TEMPLATES[profileName]?.patchReload ?? DEFAULT_PROFILE_PATCH_RELOAD
  const selectedBundles = bundles.filter(packageName =>
    (aaEnabled || packageName !== AA_PACKAGE_NAME) &&
    packageName !== DESKTOP_MARKET_IDENTITIES.community.packageName
    && (marketProvider === DESKTOP_MARKET_IDENTITIES.dshMarket.provider
      || packageName !== DESKTOP_MARKET_IDENTITIES.dshMarket.packageName),
  )
  if (marketProvider === DESKTOP_MARKET_IDENTITIES.dshMarket.provider
    && !selectedBundles.includes(DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)) {
    selectedBundles.push(DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)
  }
  if (aaEnabled && !selectedBundles.includes(AA_PACKAGE_NAME)) selectedBundles.push(AA_PACKAGE_NAME)
  const layers: Profile['layers'] = []
  let aaFailure: string | undefined
  let dshMarketFailure: string | undefined
  const installPackageUrl = pathToFileURL(INSTALL_ANCHOR).href
  const profilePackageUrl = pathToFileURL(join(profileDir, 'package.json')).href
  for (const packageName of selectedBundles) {
    const isDshMarket = packageName === DESKTOP_MARKET_IDENTITIES.dshMarket.packageName
    const isAa = packageName === AA_PACKAGE_NAME
    if (!isAa && !isDshMarket && desktopPluginBundleMutable(packageName) && disabledBundles.has(packageName)) continue
    try {
      const packageDir = resolveOverlayPackage(packageName, {
        installPackageUrl,
        profilePackageUrl,
      }).selected.packageDir
      const bundleManifest: unknown = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
      if ((isDshMarket || isAa) && (bundleManifest === null || typeof bundleManifest !== 'object'
        || Array.isArray(bundleManifest)
        || (bundleManifest as { name?: unknown }).name !== packageName)) {
        throw new Error(`${BIN_NAME}: selected ${packageName} bundle has an invalid package identity`)
      }
      const declared = bundleManifest !== null && typeof bundleManifest === 'object'
        ? (bundleManifest as { dsh?: { bundle?: { patch?: unknown } } }).dsh?.bundle?.patch
        : undefined
      if (typeof declared !== 'string' || declared.length === 0) {
        throw new Error(`${BIN_NAME}: profile bundle ${JSON.stringify(packageName)} declares no dsh.bundle in its package.json`)
      }
      const patchPath = join(packageDir, declared)
      layers.push({
        packageName,
        packageDir,
        patchPath,
        patches: loadOverlayPatches(BIN_NAME, patchPath),
      })
    } catch (cause) {
      if (isAa) aaFailure = marketFailureMessage(cause)
      else if (isDshMarket) dshMarketFailure = marketFailureMessage(cause)
      else throw cause
    }
  }
  const patchPath = join(profileDir, PROFILE_PATCH_FILENAME)
  return {
    profile: {
      name: profileName,
      dir: profileDir,
      layers,
      patchPath,
      patches: existsSync(patchPath) ? loadOverlayPatches(BIN_NAME, patchPath) : [],
      patchReload,
    },
    ...(dshMarketFailure === undefined ? {} : { dshMarketFailure }),
    ...(aaFailure === undefined ? {} : { aaFailure }),
  }
}

/** Resolve the agent presets shipped by the matching presets dependency. */
export function shippedPresetRoot(moduleUrl: string = import.meta.url): string {
  const require = createRequire(moduleUrl)
  return join(dirname(require.resolve('@deepseek-ai/dsh-agent-presets/package.json')), 'presets')
}

/** Read a row's object config without trusting arbitrary YAML values. */
function rowConfig(row: EntryOptions | undefined): Record<string, unknown> {
  const config = row?.config
  return config !== null && typeof config === 'object' && !Array.isArray(config)
    ? config as Record<string, unknown>
    : {}
}

/** Snapshot, validate, and deduplicate the LAN allowlist supplied by the launcher. */
function preparedLanAddresses(addresses: readonly string[] | undefined): readonly string[] {
  const unique = new Set<string>()
  for (const address of addresses ?? []) {
    if (isIP(address) !== 4) {
      throw new Error(`${BIN_NAME}: LAN address ${JSON.stringify(address)} is not an IPv4 literal`)
    }
    unique.add(address)
  }
  return Object.freeze([...unique])
}

/** Merge launcher-derived LAN literals with a profile's explicit Web trust entries. */
function webRuntimeTrustedHosts(
  configured: unknown,
  lanAddresses: readonly string[],
): string[] {
  if (configured === undefined) return [...lanAddresses]
  if (!Array.isArray(configured) || configured.some(entry => typeof entry !== 'string')) {
    throw new Error(`${BIN_NAME}: web-runtime trustedHosts must be an array of strings`)
  }
  return [...new Set([...configured, ...lanAddresses])]
}

/** Resolve a Loader row's platform gate without mutating the host process. */
function rowDisabledOnPlatform(row: EntryOptions, platform: NodeJS.Platform): boolean {
  if (!isJsExpr(row.disabled)) return row.disabled === true
  const scopedProcess = new Proxy(process, {
    get(target, property) {
      if (property === 'platform') return platform
      const value = Reflect.get(target, property, target)
      return typeof value === 'function' ? value.bind(target) : value
    },
  })
  return Boolean(evaluate({ process: scopedProcess }, row.disabled.__jsExpr))
}

/** Reject duplicate entries before the Loader turns them into a startup crash. */
function assertUniqueEntryIds(rows: readonly EntryOptions[]): void {
  const seen = new Set<string>()
  for (const row of rows) {
    if (typeof row.id === 'string') {
      if (seen.has(row.id)) {
        throw new Error(`${BIN_NAME}: duplicate loader entry id "${row.id}" in the composed profile`)
      }
      seen.add(row.id)
    }
    if (row.group === true && Array.isArray(row.config)) {
      assertUniqueEntryIds(row.config)
    }
  }
}

/** Return whether a Loader specifier names an npm package. */
function isBarePackageSpecifier(name: string): boolean {
  return !name.startsWith('.')
    && !name.startsWith('/')
    && !name.startsWith('#')
    && !URL.canParse(name)
}

/** Return whether a package is a user-facing Client UI extension, not a Host provider. */
function isOptionalClientPackage(name: string): boolean {
  return /^(@[^/]+\/)?dsh-client-ui-/u.test(name)
}

/** Drop unresolved optional Client UI rows from the machine-wide patch only. */
function omitUnresolvedOptionalEntries(
  patches: PatchOptions[],
  profilePackageUrl: string,
): { patches: PatchOptions[], skipped: SkippedOptionalEntry[] } {
  const skipped: SkippedOptionalEntry[] = []
  const installPackageUrl = pathToFileURL(INSTALL_ANCHOR).href

  const filterRows = (rows: EntryOptions[]): EntryOptions[] => {
    const filtered: EntryOptions[] = []
    for (const row of rows) {
      if (typeof row.name === 'string'
        && isBarePackageSpecifier(row.name)
        && isOptionalClientPackage(row.name)
        && findOverlayPackage(row.name, { installPackageUrl, profilePackageUrl }) === undefined) {
        skipped.push({
          ...(typeof row.id === 'string' ? { id: row.id } : {}),
          name: row.name,
        })
        continue
      }
      const config = row.group === true && Array.isArray(row.config) ? filterRows(row.config) : undefined
      filtered.push(config === undefined ? row : { ...row, config })
    }
    return filtered
  }

  return {
    patches: patches.flatMap((patch) => {
      if (!Array.isArray(patch.insert)) return [patch]
      const insert = filterRows(patch.insert)
      return [{ ...patch, insert }]
    }),
    skipped,
  }
}

interface MarketPatchFilter {
  readonly patches: PatchOptions[]
  readonly removedProviderReference: boolean
}

/** Return whether one Loader row claims either Desktop-owned Market identity. */
function isMarketProviderEntry(entry: { readonly id?: unknown, readonly name?: unknown }): boolean {
  return (typeof entry.id === 'string' && MARKET_ROW_IDS.has(entry.id))
    || (typeof entry.name === 'string' && MARKET_PACKAGE_NAMES.has(entry.name))
}

/** Remove provider rows recursively before an untrusted patch can activate either implementation. */
function filterMarketProviderRows(rows: EntryOptions[], matches = isMarketProviderEntry): {
  rows: EntryOptions[]
  removedProviderReference: boolean
} {
  const filtered: EntryOptions[] = []
  let removedProviderReference = false
  for (const row of rows) {
    if (matches(row)) {
      removedProviderReference = true
      continue
    }
    if (row.group === true && Array.isArray(row.config)) {
      const nested = filterMarketProviderRows(row.config, matches)
      removedProviderReference ||= nested.removedProviderReference
      filtered.push(nested.removedProviderReference ? { ...row, config: nested.rows } : row)
    } else {
      filtered.push(row)
    }
  }
  return { rows: filtered, removedProviderReference }
}

/** Strip provider inserts and overrides from every non-provider layer. */
function filterMarketProviderPatches(patches: PatchOptions[], matches = isMarketProviderEntry): MarketPatchFilter {
  const filtered: PatchOptions[] = []
  let removedProviderReference = false
  for (const patch of patches) {
    if (matches(patch)) {
      removedProviderReference = true
      continue
    }
    if (Array.isArray(patch.insert)) {
      const insert = filterMarketProviderRows(patch.insert, matches)
      removedProviderReference ||= insert.removedProviderReference
      filtered.push(insert.removedProviderReference ? { ...patch, insert: insert.rows } : patch)
    } else {
      filtered.push(patch)
    }
  }
  return { patches: filtered, removedProviderReference }
}

/** AA is an optional bundle; user layers cannot bypass its Desktop selection. */
function isAaEntry(entry: { readonly id?: unknown, readonly name?: unknown }): boolean {
  return entry.id === AA_ROW_ID || entry.name === AA_PACKAGE_NAME
    || (typeof entry.name === 'string' && entry.name.startsWith(`${AA_PACKAGE_NAME}/`))
}

/** Accept only the audited single-row contract from the selected direct bundle layer. */
export function validateDshMarketBundlePatches(patches: readonly PatchOptions[]): void {
  const rows = composeEntries([[...patches]])
  const row = rows[0]
  if (rows.length !== 1 || row === undefined
    || row.id !== DESKTOP_MARKET_IDENTITIES.dshMarket.rowId
    || row.name !== DESKTOP_MARKET_IDENTITIES.dshMarket.packageName
    || Object.keys(row).some(key => key !== 'id' && key !== 'name')) {
    throw new Error(`${BIN_NAME}: dshmarket bundle patch must insert exactly the canonical dsh-market row`)
  }
}

/** Ensure a Desktop dependency is resolvable through the selected profile fallback. */
function validateMarketPackage(name: string, profilePackageUrl: string): string | undefined {
  try {
    resolveOverlayPackage(name, {
      installPackageUrl: pathToFileURL(INSTALL_ANCHOR).href,
      profilePackageUrl,
    })
  } catch (cause) {
    return `${BIN_NAME}: cannot resolve selected Market package ${name}: ${marketFailureMessage(cause)}`
  }
}

/** Assert the final graph contains only the provider selected by the launcher. */
function assertEffectiveMarketRows(
  rows: readonly EntryOptions[],
  effective: DesktopMarketProvider,
): void {
  const providers = rows.filter(isMarketProviderEntry)
  if (effective === 'disabled') {
    if (providers.length !== 0) throw new Error(`${BIN_NAME}: disabled Market provider leaked into the Loader graph`)
    return
  }
  const identity = effective === DESKTOP_MARKET_IDENTITIES.community.provider
    ? DESKTOP_MARKET_IDENTITIES.community
    : DESKTOP_MARKET_IDENTITIES.dshMarket
  if (providers.length !== 1 || providers[0]?.id !== identity.rowId
    || providers[0]?.name !== identity.packageName) {
    throw new Error(`${BIN_NAME}: selected Market provider did not compose to one canonical Loader row`)
  }
}

/**
 * Read the Desktop machine-wide patch without relaxing upstream patch parsing.
 *
 * A YAML null document is the natural result of an empty, comment-only, or
 * explicit `null` file. Desktop treats only that machine-wide state as an
 * empty patch layer; every non-null document still goes through app-boot's
 * strict parser, including its `!!js` schema and diagnostics.
 */
function loadDesktopMachinePatches(home: string): PatchOptions[] {
  const path = join(home, PROFILE_PATCH_FILENAME)
  let content: string
  try {
    content = readFileSync(path, 'utf8')
  } catch {
    return loadOptionalPatches(BIN_NAME, path) ?? []
  }

  try {
    const documents = parseAllDocuments(content, { prettyErrors: true })
    if (documents.length === 0) return []
    const [document] = documents
    if (documents.length === 1
      && document !== undefined
      && document.errors.length === 0
      && document.warnings.length === 0
      && document.toJS() === null) {
      return []
    }
  } catch {
    // Preserve app-boot's strict parser and user-facing diagnostic below.
  }

  return loadOptionalPatches(BIN_NAME, path) ?? []
}

/**
 * Load and compose one desktop profile generation.
 * @param telemetryDisabled - inherited DSH telemetry opt-out value.
 * @param home - Harness home containing profiles and the machine-wide patch.
 * @param platform - native platform selecting launcher-owned safety overlays.
 * @param profileName - existing or lazily available Web profile to compose.
 * @param pluginStatePath - optional Desktop-private disabled-bundle state.
 * @param marketSelection - machine-level provider request fixed for this generation.
 * @returns root config, profile metadata, and ordered patches.
 */
export function prepareDesktopProfile(
  telemetryDisabled: string | undefined = process.env.DSH_TELEMETRY_DISABLED,
  home: string = resolveDshHome(),
  platform: NodeJS.Platform = process.platform,
  profileName: string = DESKTOP_PROFILE_NAME,
  pluginStatePath?: string,
  marketSelection: DesktopMarketSnapshot = DEFAULT_DESKTOP_MARKET_SNAPSHOT,
  hooks: DesktopProfilePreparationHooks = {},
): PreparedDesktopProfile {
  const lanAddresses = preparedLanAddresses(hooks.lanAddresses)
  const profileDir = profileName === DESKTOP_PROFILE_NAME
    ? ensureDesktopProfile(home)
    : resolveProfileDir(profileName, home)
  const workspaceChanged = reconcileProfilePnpmWorkspace(profileDir)
  const requiresDependencyMigration = profileDependencyMigrationRequired(profileDir, workspaceChanged, platform)
  // `plugin-management` remains the community market's user-facing scope.
  // Recovery mode no longer reads or writes an independent disable policy:
  // package removal goes through the provider-neutral `dsh plugin remove`.
  const managedDisabledBundles = pluginStatePath === undefined
    ? new Set<string>()
    : readDesktopDisabledBundles(pluginStatePath, profileName)
  const disabledBundles = marketSelection.requested === DESKTOP_MARKET_IDENTITIES.community.provider
    ? new Set(managedDisabledBundles)
    : new Set<string>()
  const loadedProfile = loadRecoveryFilteredProfile(
    profileName,
    profileDir,
    disabledBundles,
    marketSelection.requested,
    hooks.aaEnabled === true,
  )
  const profile = loadedProfile.profile
  const rootConfig = join(profileDir, DESKTOP_PROFILE_ROOT)
  const bareModuleBaseUrl = pathToFileURL(join(profile.dir, 'package.json')).href
  writeFileSync(rootConfig, '[]\n')

  const desktopPatches = loadOverlayPatches(BIN_NAME, DESKTOP_PATCH_PATH)
  const bundlePatches: PatchOptions[] = []
  let aaLayer: Profile['layers'][number] | undefined
  let dshMarketPatches: PatchOptions[] | undefined
  let desktopLayerInserted = false
  const providerAwareDisabledBundles = new Set(disabledBundles)
  if (marketSelection.requested === DESKTOP_MARKET_IDENTITIES.dshMarket.provider) {
    providerAwareDisabledBundles.delete(DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)
  }
  if (hooks.aaEnabled === true) providerAwareDisabledBundles.delete(AA_PACKAGE_NAME)
  for (const layer of activeDesktopProfileLayers(profile, providerAwareDisabledBundles)) {
    if (layer.packageName === AA_PACKAGE_NAME) { aaLayer = layer; continue }
    if (layer.packageName === DESKTOP_MARKET_IDENTITIES.dshMarket.packageName) {
      dshMarketPatches = layer.patches
      continue
    }
    bundlePatches.push(...layer.patches)
    if (layer.packageName !== '@deepseek-ai/dsh-web-app') continue
    bundlePatches.push(...desktopPatches)
    desktopLayerInserted = true
  }
  if (!desktopLayerInserted) {
    throw new Error(`${BIN_NAME}: desktop profile is missing @deepseek-ai/dsh-web-app`)
  }

  const loadedHomePatches = loadDesktopMachinePatches(home)
  const { patches: homePatches, skipped: skippedOptionalEntries } = omitUnresolvedOptionalEntries(
    loadedHomePatches,
    bareModuleBaseUrl,
  )
  const filteredBundles = filterMarketProviderPatches(bundlePatches)
  const filteredProfile = filterMarketProviderPatches(profile.patches)
  const filteredHome = filterMarketProviderPatches(homePatches)
  const hasProviderConflict = filteredBundles.removedProviderReference
    || filteredProfile.removedProviderReference
    || filteredHome.removedProviderReference
  let effectiveMarket: DesktopMarketProvider = 'disabled'
  let marketFailure: string | undefined
  const providerPatches: PatchOptions[] = []
  if (marketSelection.requested !== 'disabled') {
    if (hasProviderConflict) {
      marketFailure = `${BIN_NAME}: conflicting Market provider Loader identity was removed`
    } else if (marketSelection.requested === DESKTOP_MARKET_IDENTITIES.community.provider) {
      marketFailure = validateMarketPackage(
        DESKTOP_MARKET_IDENTITIES.community.packageName,
        bareModuleBaseUrl,
      )
      if (marketFailure === undefined) {
        providerPatches.push({
          insert: [{
            id: DESKTOP_MARKET_IDENTITIES.community.rowId,
            name: DESKTOP_MARKET_IDENTITIES.community.packageName,
          }],
        })
        effectiveMarket = DESKTOP_MARKET_IDENTITIES.community.provider
      }
    } else if (loadedProfile.dshMarketFailure !== undefined) {
      marketFailure = loadedProfile.dshMarketFailure
    } else if (dshMarketPatches === undefined) {
      marketFailure = `${BIN_NAME}: selected dshmarket bundle layer is unavailable`
    } else {
      try {
        validateDshMarketBundlePatches(dshMarketPatches)
        providerPatches.push(...dshMarketPatches)
        effectiveMarket = DESKTOP_MARKET_IDENTITIES.dshMarket.provider
      } catch (cause) {
        marketFailure = marketFailureMessage(cause)
      }
    }
  }
  const ordinary = filterMarketProviderPatches([
    ...filteredBundles.patches,
    ...providerPatches,
    ...filteredProfile.patches,
    ...filteredHome.patches,
  ], isAaEntry)
  const aaPatches: PatchOptions[] = []
  let aaFailure = loadedProfile.aaFailure
  if (hooks.aaEnabled === true && aaFailure === undefined) {
    try {
      if (ordinary.removedProviderReference) throw new Error('conflicting AA configuration was removed')
      if (!aaLayer) throw new Error('selected AA bundle layer is unavailable')
      const aaRows = composeEntries([aaLayer.patches])
      const aaRow = aaRows.find(row => row.id === AA_ROW_ID && row.name === AA_PACKAGE_NAME)
      if (!aaRow || aaRows.length !== 1 || aaRow.disabled === true) {
        throw new Error('AA bundle must contain one active canonical plugin entry')
      }
      // Preserve the declared bundle. Supply only the actual Harness home and
      // the physical Python payload path required when Electron uses ASAR.
      const connectorSourceDir = join(aaLayer.packageDir, 'lib', 'bundled-connector')
        .replace(/([\\/])app\.asar([\\/])/u, '$1app.asar.unpacked$2')
      if (!existsSync(join(connectorSourceDir, 'pyproject.toml'))) throw new Error('AA Connector payload is unavailable')
      aaPatches.push(...aaLayer.patches, { id: AA_ROW_ID, config: {
        ...rowConfig(aaRow), dshHome: home, connectorSourceDir,
      } })
    } catch (cause) {
      aaFailure = marketFailureMessage(cause)
    }
  }
  const patches: PatchOptions[] = [...ordinary.patches, ...aaPatches]
  const composedRows = composeEntries([patches])
  assertUniqueEntryIds(composedRows)
  assertEffectiveMarketRows(composedRows, effectiveMarket)
  const rows = new Map<string, EntryOptions>()
  for (const row of composedRows) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }
  const settings = rows.get('settings')
  if (settings?.name !== SETTINGS_FILE_PACKAGE) {
    throw new Error(`${BIN_NAME}: desktop profile must use ${SETTINGS_FILE_PACKAGE} in the settings row`)
  }
  const settingsConfig = FileSettingsProvider.Config({
    dshHome: home,
    ...rowConfig(settings),
  } as SettingsFileConfig)
  const settingsDocument = resolveSettingsFileSpec(settingsConfig).filename
  hooks.onSettingsDocumentResolved?.(settingsDocument)
  const {
    mode,
    port,
    macosMaterial,
    windowsMaterial,
    openBrowser,
    networkExposure,
  } = readDesktopStartupSettings(settingsConfig)
  patches.push({
    id: 'settings',
    config: settingsConfig,
  })
  const webRuntime = rows.get('web-runtime')
  if (webRuntime === undefined) {
    throw new Error(`${BIN_NAME}: desktop profile has no web-runtime row`)
  }
  const webRuntimeConfig = rowConfig(webRuntime)
  patches.push({
    id: 'web-runtime',
    config: {
      ...webRuntimeConfig,
      // Browser access is an advertised Desktop capability, never an
      // instruction to launch the operating system's default browser.
      openBrowser: false,
      trustedHosts: webRuntimeTrustedHosts(webRuntimeConfig.trustedHosts, lanAddresses),
    },
  })
  if (mode === 'advanced' || mode === 'extended') {
    for (const [id, packageName] of [
      ['ui-layout', UI_LAYOUT_PACKAGE],
      ['ui-sidebar', UI_SIDEBAR_PACKAGE],
      ['ui-conversation', UI_CONVERSATION_PACKAGE],
    ] as const) {
      if (rows.get(id)?.name !== packageName) {
        throw new Error(`${BIN_NAME}: ${mode} desktop mode must use ${packageName} in the ${id} row`)
      }
    }
    patches.push(
      { id: 'ui-layout', disabled: true },
      { id: 'ui-sidebar', disabled: false },
      { id: 'ui-conversation', disabled: false },
    )
  }
  const presets = rows.get(AGENT_PRESETS_ROW_ID)
  if (presets !== undefined) {
    const shippedRoot = shippedPresetRoot()
    const roots: Array<{ path: string, trust: 'system' | 'user' }> = [
      { path: shippedRoot, trust: 'system' },
      { path: join(home, USER_PRESET_DIRNAME), trust: 'user' },
    ]
    patches.push({
      id: AGENT_PRESETS_ROW_ID,
      config: { ...rowConfig(presets), roots, includeUserRoot: false },
    })
  }
  const webserver = rows.get('webserver')
  if (webserver === undefined) {
    throw new Error(`${BIN_NAME}: desktop profile has no webserver row`)
  }
  if (platform === 'win32') {
    if (!rows.has(DIRECTORY_PICKER_ROW_ID)) {
      throw new Error(`${BIN_NAME}: desktop profile has no directory-picker row`)
    }
    patches.push(
      {
        id: DIRECTORY_PICKER_ROW_ID,
        name: AUTO_PICKER_PACKAGE,
        disabled: true,
      },
      {
        insert: [
          {
            id: 'desktop-directory-picker-browse-host',
            name: BROWSE_PICKER_BACKEND,
          },
          {
            id: 'desktop-directory-picker-browse-surface',
            name: BROWSE_PICKER_SURFACE,
          },
        ],
      },
    )
    const pwshSandbox = rows.get(PWSH_SANDBOX_ROW_ID)
    if (pwshSandbox?.name === UPSTREAM_PWSH_SANDBOX_PACKAGE
      && !rowDisabledOnPlatform(pwshSandbox, platform)) {
      patches.push(
        {
          id: PWSH_SANDBOX_ROW_ID,
          name: UPSTREAM_PWSH_SANDBOX_PACKAGE,
          disabled: true,
        },
        {
          insert: [
            {
              id: DESKTOP_WINDOWS_PWSH_SANDBOX_ROW_ID,
              name: DESKTOP_WINDOWS_PWSH_SANDBOX_PACKAGE,
              ...(pwshSandbox.disabled === undefined ? {} : { disabled: pwshSandbox.disabled }),
              config: rowConfig(pwshSandbox),
            },
          ],
        },
      )
    }
  }
  // Loader patches cannot change an existing row's package identity. Disable the
  // profile row by its current identity and insert the Desktop-owned provider.
  const webserverConfig = { host: desktopWebServerHost(networkExposure), port }
  if (webserver.name === DESKTOP_WEB_SERVER_PACKAGE) {
    patches.push({
      id: 'webserver',
      name: DESKTOP_WEB_SERVER_PACKAGE,
      disabled: false,
      config: webserverConfig,
    })
  } else {
    if (typeof webserver.name !== 'string') {
      throw new Error(`${BIN_NAME}: desktop profile webserver row has no package identity`)
    }
    const replacement = rows.get(DESKTOP_WEB_SERVER_ROW_ID)
    if (replacement !== undefined && replacement.name !== DESKTOP_WEB_SERVER_PACKAGE) {
      throw new Error(`${BIN_NAME}: reserved ${DESKTOP_WEB_SERVER_ROW_ID} row has a conflicting package identity`)
    }
    patches.push({
      id: 'webserver',
      name: webserver.name,
      disabled: true,
    })
    if (replacement === undefined) {
      patches.push({
        insert: [{
          id: DESKTOP_WEB_SERVER_ROW_ID,
          name: DESKTOP_WEB_SERVER_PACKAGE,
          config: webserverConfig,
        }],
      })
    } else {
      patches.push({
        id: DESKTOP_WEB_SERVER_ROW_ID,
        name: DESKTOP_WEB_SERVER_PACKAGE,
        disabled: false,
        config: webserverConfig,
      })
    }
  }
  if ((telemetryDisabled ?? '') !== '' && rows.has('session-telemetry-otel')) {
    patches.push({ id: 'session-telemetry-otel', disabled: true })
  }
  const desktopShell = rows.get('desktop-shell')
  if (desktopShell === undefined) {
    throw new Error(`${BIN_NAME}: desktop profile has no desktop-shell row`)
  }
  patches.push({
    id: 'desktop-shell',
    disabled: false,
    config: {
      ...rowConfig(desktopShell),
      mode,
      port,
      networkExposure,
      macosMaterial,
      windowsMaterial,
    },
  })
  return {
    homeDir: home,
    profile,
    rootConfig,
    bareModuleBaseUrl,
    patches: structuredClone(patches),
    skippedOptionalEntries,
    mode,
    port,
    macosMaterial,
    windowsMaterial,
    openBrowser,
    networkExposure,
    lanAddresses,
    settingsDocument,
    aaEnabled: aaPatches.length > 0,
    ...(aaFailure === undefined ? {} : { aaFailure }),
    market: desktopMarketSnapshotWithEffective(marketSelection, effectiveMarket),
    requiresDependencyMigration,
    ...(marketFailure === undefined ? {} : { marketFailure }),
  }
}

/** Maintain the upstream module fallback for one fully resolved Desktop profile. */
export function healDesktopProfileModuleFallback(home: string, profile?: Profile): Promise<void> {
  const heal = () => healProfilesModuleFallback({
    installAnchor: INSTALL_ANCHOR,
    home,
    ...(profile === undefined ? {} : { profile }),
  })
  if (!/([\\/])app\.asar\1/u.test(INSTALL_ANCHOR)) return heal()
  removeObsoleteDesktopSharedModuleFallback(home)
  return withAsarModuleResolver(heal)
}

function isDshManagedModuleProxy(directory: string): boolean {
  const manifestPath = join(directory, 'package.json')
  try {
    if (statSync(manifestPath).size > MAX_FALLBACK_MANIFEST_BYTES) return false
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh?: { moduleFallback?: { targets?: unknown } }
    }
    const targets = manifest.dsh?.moduleFallback?.targets
    return targets !== null && typeof targets === 'object' && !Array.isArray(targets)
      && Object.keys(targets).length > 0
      && Object.values(targets).every((target) => {
        if (typeof target !== 'string') return false
        try {
          const url = new URL(target)
          return url.protocol === 'file:'
            && /(^|[\\/])app\.asar(?:\.unpacked)?([\\/]|$)/iu.test(fileURLToPath(url))
        } catch {
          return false
        }
      })
  } catch {
    return false
  }
}

function removeManagedFallbackEntry(entryPath: string): boolean {
  let stat: ReturnType<typeof lstatSync>
  try {
    stat = lstatSync(entryPath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    return false
  }
  try {
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(entryPath)
      const absoluteTarget = isAbsolute(target) ? target : resolve(dirname(entryPath), target)
      // Desktop releases that mirrored the whole dependency graph produced
      // links into app.asar(.unpacked). No ordinary user Profile installation
      // needs such a shared parent link.
      if (!/(^|[\\/])app\.asar(?:\.unpacked)?([\\/]|$)/iu.test(absoluteTarget)) return false
      unlinkSync(entryPath)
      return true
    }
    if (!stat.isDirectory() || !isDshManagedModuleProxy(entryPath)) return false
    rmSync(entryPath, { recursive: true, force: true })
    return true
  } catch {
    // A locked legacy link must not make Desktop startup fail. The resolver
    // also refuses shared/legacy ASAR results, so leaving it is safe.
    return false
  }
}

/**
 * Remove only provably DSH-generated installation fallbacks from releases
 * predating the ASAR resolver. Unknown files and directories are preserved.
 */
export function removeObsoleteDesktopSharedModuleFallback(home: string): number {
  const modulesDirectory = join(home, 'profiles', 'node_modules')
  let entries: Dirent<string>[]
  try {
    entries = readdirSync(modulesDirectory, { withFileTypes: true, encoding: 'utf8' })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 0
    return 0
  }
  let removed = 0
  for (const entry of entries) {
    const entryPath = join(modulesDirectory, entry.name)
    if (entry.name.startsWith('@') && entry.isDirectory()) {
      let scopedEntries: typeof entries
      try {
        scopedEntries = readdirSync(entryPath, { withFileTypes: true, encoding: 'utf8' })
      } catch {
        continue
      }
      let removedFromScope = 0
      for (const scopedEntry of scopedEntries) {
        if (removeManagedFallbackEntry(join(entryPath, scopedEntry.name))) removedFromScope += 1
      }
      removed += removedFromScope
      if (removedFromScope > 0) {
        try {
          rmdirSync(entryPath)
        } catch {
          // The scope still contains unknown/user-owned data or another writer.
        }
      }
      continue
    }
    if (removeManagedFallbackEntry(entryPath)) removed += 1
  }
  return removed
}

/** Expose the package anchor for focused resolution tests. */
export function desktopInstallAnchor(): string {
  return INSTALL_ANCHOR
}

/** Preserve the public manifest type in the declaration graph used by plugin tooling. */
export type DesktopProfileManifest = ProfileManifest
