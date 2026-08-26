/** Data contract shared by the isolated native Setup Wizard and its owner. */

export type DesktopSetupWizardPlatform = 'darwin' | 'win32' | 'linux'
export type DesktopSetupWizardMode = 'compatibility' | 'extended' | 'advanced'
export type DesktopSetupWizardMacosMaterial = 'off' | 'transparent'
export type DesktopSetupWizardWindowsMaterial = 'off' | 'acrylic' | 'mica'
export type DesktopSetupWizardNetworkExposure = 'loopback' | 'lan'
export type DesktopSetupWizardMarket = 'disabled' | 'community-market' | 'dsh-market'

export interface DesktopSetupWizardNotifications {
  readonly enabled: boolean
  readonly notifyOnTurnCompletion: boolean
  readonly notifyOnTurnFailure: boolean
  readonly notifyOnJobCompletion: boolean
  readonly notifyOnJobFailure: boolean
}

/** Every value the launcher needs to persist after Setup completes. */
export interface DesktopSetupWizardSelection {
  readonly mode: DesktopSetupWizardMode
  readonly macosMaterial: DesktopSetupWizardMacosMaterial
  readonly windowsMaterial: DesktopSetupWizardWindowsMaterial
  readonly openBrowser: boolean
  readonly networkExposure: DesktopSetupWizardNetworkExposure
  readonly market: DesktopSetupWizardMarket
  readonly notifications: DesktopSetupWizardNotifications
}

/** Fixed capabilities and current values supplied before the Host is started. */
export interface DesktopSetupWizardInput extends DesktopSetupWizardSelection {
  readonly profileName: string
  readonly platform: DesktopSetupWizardPlatform
  readonly micaSupported: boolean
}

export type DesktopSetupWizardResult =
  | { readonly action: 'complete'; readonly selection: DesktopSetupWizardSelection }
  | { readonly action: 'skip' }
  | { readonly action: 'quit' }

const SELECTION_KEYS = Object.freeze([
  'mode',
  'macosMaterial',
  'windowsMaterial',
  'openBrowser',
  'networkExposure',
  'market',
  'notifications',
] as const)
const INPUT_KEYS = Object.freeze([...SELECTION_KEYS, 'profileName', 'platform', 'micaSupported'] as const)
const NOTIFICATION_KEYS = Object.freeze([
  'enabled',
  'notifyOnTurnCompletion',
  'notifyOnTurnFailure',
  'notifyOnJobCompletion',
  'notifyOnJobFailure',
] as const)

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === expected.length && actual.every(key => expected.includes(key))
}

function isMode(value: unknown): value is DesktopSetupWizardMode {
  return value === 'compatibility' || value === 'extended' || value === 'advanced'
}

function isMacosMaterial(value: unknown): value is DesktopSetupWizardMacosMaterial {
  return value === 'off' || value === 'transparent'
}

function isWindowsMaterial(value: unknown): value is DesktopSetupWizardWindowsMaterial {
  return value === 'off' || value === 'acrylic' || value === 'mica'
}

function isNetworkExposure(value: unknown): value is DesktopSetupWizardNetworkExposure {
  return value === 'loopback' || value === 'lan'
}

function isMarket(value: unknown): value is DesktopSetupWizardMarket {
  return value === 'disabled' || value === 'community-market' || value === 'dsh-market'
}

function isPlatform(value: unknown): value is DesktopSetupWizardPlatform {
  return value === 'darwin' || value === 'win32' || value === 'linux'
}

export function isDesktopSetupWizardNotifications(
  value: unknown,
): value is DesktopSetupWizardNotifications {
  return isObject(value)
    && hasExactKeys(value, NOTIFICATION_KEYS)
    && NOTIFICATION_KEYS.every(key => typeof value[key] === 'boolean')
}

function hasSelectionValues(value: Record<string, unknown>): boolean {
  return isMode(value.mode)
    && isMacosMaterial(value.macosMaterial)
    && isWindowsMaterial(value.windowsMaterial)
    && typeof value.openBrowser === 'boolean'
    && isNetworkExposure(value.networkExposure)
    && isMarket(value.market)
    && isDesktopSetupWizardNotifications(value.notifications)
}

/** Strictly validate a renderer-supplied complete selection. */
export function isDesktopSetupWizardSelection(
  value: unknown,
): value is DesktopSetupWizardSelection {
  return isObject(value)
    && hasExactKeys(value, SELECTION_KEYS)
    && hasSelectionValues(value)
}

/** Strictly validate the bounded JSON state loaded by the local document. */
export function isDesktopSetupWizardInput(value: unknown): value is DesktopSetupWizardInput {
  if (!isObject(value) || !hasExactKeys(value, INPUT_KEYS) || !hasSelectionValues(value)) {
    return false
  }
  return typeof value.profileName === 'string'
    && value.profileName.length > 0
    && new TextEncoder().encode(value.profileName).byteLength <= 255
    && !value.profileName.includes('/')
    && !value.profileName.includes('\\')
    && value.profileName !== '.'
    && value.profileName !== '..'
    && value.profileName !== 'node_modules'
    && !/[\0-\x1f\x7f-\x9f]/u.test(value.profileName)
    && !/[<>:"|?*]/u.test(value.profileName)
    && !/[. ]$/u.test(value.profileName)
    && !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(value.profileName)
    && isPlatform(value.platform)
    && typeof value.micaSupported === 'boolean'
}

/** Reject selections the current platform cannot actually present. */
export function desktopSetupWizardSelectionIsAvailable(
  selection: DesktopSetupWizardSelection,
  capabilities: Pick<DesktopSetupWizardInput, 'platform' | 'micaSupported'>,
): boolean {
  if (selection.openBrowser && selection.mode !== 'compatibility') return false
  if (!selection.openBrowser && selection.networkExposure === 'lan') return false
  if (capabilities.platform === 'linux' && selection.mode !== 'compatibility') return false
  return capabilities.platform !== 'win32'
    || selection.windowsMaterial !== 'mica'
    || capabilities.micaSupported
}

/** LAN always needs a fresh confirmation when moving away from loopback-only access. */
export function desktopSetupWizardRequiresLanConfirmation(
  current: DesktopSetupWizardNetworkExposure,
  requested: DesktopSetupWizardNetworkExposure,
): boolean {
  return current === 'loopback' && requested === 'lan'
}

/** A first-run Wizard must record a fresh acknowledgement before it can expose LAN. */
export function desktopSetupWizardRequiresLanAcknowledgement(
  current: DesktopSetupWizardNetworkExposure,
  requested: DesktopSetupWizardNetworkExposure,
  acknowledged: boolean,
): boolean {
  return requested === 'lan'
    && (!acknowledged || desktopSetupWizardRequiresLanConfirmation(current, requested))
}

/** Freeze a complete result before it crosses back into launcher orchestration. */
export function freezeDesktopSetupWizardSelection(
  selection: DesktopSetupWizardSelection,
): DesktopSetupWizardSelection {
  const notifications = Object.freeze({ ...selection.notifications })
  return Object.freeze({ ...selection, notifications })
}
