/** Pre-Host reader and atomic writer for Desktop Setup Wizard preferences. */

import {
  desktopBrowserAccessAvailable,
  desktopBrowserAccessEnabled,
  desktopNetworkExposureForBrowserAccess,
} from './desktop-network.ts'
import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
} from 'node:fs'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { parseDocument } from 'yaml'
import {
  DEFAULT_MACOS_WINDOW_MATERIAL,
  DEFAULT_WINDOWS_WINDOW_MATERIAL,
  parseMacosWindowMaterial,
  parseWindowsWindowMaterial,
} from './window-material.ts'
import type {
  DesktopSetupWizardMacosMaterial,
  DesktopSetupWizardMode,
  DesktopSetupWizardNetworkExposure,
  DesktopSetupWizardNotifications,
  DesktopSetupWizardWindowsMaterial,
} from './setup-wizard-contract.ts'

const BIN_NAME = 'dsh-plugin-desktop'
const DESKTOP_NAMESPACE = 'dsh-desktop'
const NOTIFICATIONS_NAMESPACE = 'dsh-desktop-notifications'
const MAX_DOCUMENT_BYTES = 4 * 1024 * 1024
const DOCUMENT_FILE_MODE = 0o600
const DOCUMENT_DIRECTORY_MODE = 0o700

type SettingsFormat = 'yaml' | 'json'

/** Complete notification choice committed by the Setup Wizard. */
export type DesktopSetupWizardNotificationSettings = DesktopSetupWizardNotifications

/** Preferences shown and saved before the Desktop Host boots. */
export interface DesktopSetupWizardSettings {
  readonly mode: DesktopSetupWizardMode
  /** Preserve both platform preferences when Setup runs on either platform. */
  readonly macosMaterial: DesktopSetupWizardMacosMaterial
  /** Preserve both platform preferences when Setup runs on either platform. */
  readonly windowsMaterial: DesktopSetupWizardWindowsMaterial
  /** Persisted compatibility key for ordinary-browser access permission. */
  readonly openBrowser: boolean
  /** Native Web listener exposure; LAN requires browser access permission. */
  readonly networkExposure: DesktopSetupWizardNetworkExposure
  readonly notifications: DesktopSetupWizardNotificationSettings
}

interface LoadedSettingsDocument {
  readonly format: SettingsFormat
  readonly root: Record<string, unknown>
  readonly yaml?: ReturnType<typeof parseDocument>
}

function invalid(message: string): Error {
  return new Error(`${BIN_NAME}: invalid Setup Wizard settings document: ${message}`)
}

function settingsPath(value: string): string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\0') || !isAbsolute(value)) {
    throw new TypeError(`${BIN_NAME}: Setup Wizard settings document must be an absolute path without NUL`)
  }
  const path = resolve(value)
  const extension = extname(path).toLowerCase()
  if (extension !== '.yaml' && extension !== '.yml' && extension !== '.json') {
    throw new TypeError(`${BIN_NAME}: Setup Wizard settings document must use .yaml, .yml, or .json`)
  }
  return path
}

function formatOf(path: string): SettingsFormat {
  return extname(path).toLowerCase() === '.json' ? 'json' : 'yaml'
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function readDocumentText(path: string): string | undefined {
  let pathInfo
  try {
    pathInfo = lstatSync(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
  if (!pathInfo.isFile() || pathInfo.isSymbolicLink()) throw invalid('document must be a regular file')
  if (pathInfo.size > MAX_DOCUMENT_BYTES) {
    throw invalid(`document exceeds ${String(MAX_DOCUMENT_BYTES)} bytes`)
  }
  const descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = fstatSync(descriptor)
    if (!info.isFile() || info.size > MAX_DOCUMENT_BYTES) {
      throw invalid(`document must be a regular file within ${String(MAX_DOCUMENT_BYTES)} bytes`)
    }
    if (info.dev !== pathInfo.dev || info.ino !== pathInfo.ino) {
      throw invalid('document changed while it was being opened')
    }
    const buffer = Buffer.alloc(MAX_DOCUMENT_BYTES + 1)
    let bytesRead = 0
    while (bytesRead < buffer.byteLength) {
      const count = readSync(descriptor, buffer, bytesRead, buffer.byteLength - bytesRead, null)
      if (count === 0) break
      bytesRead += count
    }
    if (bytesRead > MAX_DOCUMENT_BYTES) {
      throw invalid(`document exceeds ${String(MAX_DOCUMENT_BYTES)} bytes`)
    }
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    } catch {
      throw invalid('document must contain valid UTF-8')
    }
  } finally {
    closeSync(descriptor)
  }
}

function loadSettingsDocument(path: string): LoadedSettingsDocument {
  const format = formatOf(path)
  const text = readDocumentText(path)
  if (format === 'json') {
    let value: unknown = {}
    if (text !== undefined) {
      try {
        value = JSON.parse(text) as unknown
      } catch {
        throw invalid('JSON could not be parsed')
      }
    }
    if (!isRecord(value)) throw invalid('root must be a map of namespace sections')
    return { format, root: value }
  }

  const yaml = parseDocument(text ?? '', { prettyErrors: true })
  if (yaml.errors.length > 0) {
    throw invalid(`YAML could not be parsed: ${yaml.errors.map(error => error.message).join('; ')}`)
  }
  const value: unknown = yaml.toJS() ?? {}
  if (!isRecord(value)) throw invalid('root must be a map of namespace sections')
  return { format, root: value, yaml }
}

function section(root: Record<string, unknown>, namespace: string): Record<string, unknown> {
  const value = root[namespace]
  if (value === undefined) return {}
  if (!isRecord(value)) throw invalid(`${namespace} must be a map`)
  return value
}

function optionalBoolean(values: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = values[key]
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw invalid(`${key} must be a boolean`)
  return value
}

function parseMode(value: unknown): DesktopSetupWizardMode {
  if (value === undefined) return 'compatibility'
  if (value === 'compatibility' || value === 'extended' || value === 'advanced') return value
  throw invalid('dsh-desktop.mode must be compatibility, extended, or advanced')
}

function parseExposure(value: unknown): DesktopSetupWizardNetworkExposure {
  if (value === undefined) return 'loopback'
  if (value === 'loopback' || value === 'lan') return value
  throw invalid('dsh-desktop.networkExposure must be loopback or lan')
}

function notificationSettings(values: Record<string, unknown>): DesktopSetupWizardNotificationSettings {
  return Object.freeze({
    enabled: optionalBoolean(values, 'enabled', true),
    notifyOnTurnCompletion: optionalBoolean(values, 'notifyOnTurnCompletion', true),
    notifyOnTurnFailure: optionalBoolean(values, 'notifyOnTurnFailure', true),
    notifyOnJobCompletion: optionalBoolean(values, 'notifyOnJobCompletion', true),
    notifyOnJobFailure: optionalBoolean(values, 'notifyOnJobFailure', true),
  })
}

function projectSettings(
  root: Record<string, unknown>,
): DesktopSetupWizardSettings {
  const desktop = section(root, DESKTOP_NAMESPACE)
  const notifications = section(root, NOTIFICATIONS_NAMESPACE)
  const mode = parseMode(desktop.mode)
  const networkExposure = parseExposure(desktop.networkExposure)
  const openBrowser = desktopBrowserAccessEnabled(
    mode,
    optionalBoolean(desktop, 'openBrowser', false),
    networkExposure,
  )
  return Object.freeze({
    mode,
    macosMaterial: parseMacosWindowMaterial(desktop.macosMaterial),
    windowsMaterial: parseWindowsWindowMaterial(desktop.windowsMaterial),
    openBrowser,
    networkExposure: desktopNetworkExposureForBrowserAccess(openBrowser, networkExposure),
    notifications: notificationSettings(notifications),
  })
}

function normalizedUpdate(
  value: DesktopSetupWizardSettings,
): DesktopSetupWizardSettings {
  if (!isRecord(value)) throw new TypeError(`${BIN_NAME}: invalid Setup Wizard settings update`)
  const requestedMode = parseMode(value.mode)
  if (value.macosMaterial !== 'off' && value.macosMaterial !== 'transparent') {
    throw new TypeError(`${BIN_NAME}: macOS Setup Wizard material must be off or transparent`)
  }
  if (value.windowsMaterial !== 'off' && value.windowsMaterial !== 'acrylic' && value.windowsMaterial !== 'mica') {
    throw new TypeError(`${BIN_NAME}: Windows Setup Wizard material must be off, acrylic, or mica`)
  }
  if (typeof value.openBrowser !== 'boolean') {
    throw new TypeError(`${BIN_NAME}: Setup Wizard openBrowser must be a boolean`)
  }
  const openBrowser = desktopBrowserAccessAvailable(requestedMode) && value.openBrowser
  const networkExposure = desktopNetworkExposureForBrowserAccess(
    openBrowser,
    parseExposure(value.networkExposure),
  )
  if (!isRecord(value.notifications)) {
    throw new TypeError(`${BIN_NAME}: Setup Wizard notifications must be a map`)
  }
  const notificationKeys: readonly (keyof DesktopSetupWizardNotificationSettings)[] = [
    'enabled',
    'notifyOnTurnCompletion',
    'notifyOnTurnFailure',
    'notifyOnJobCompletion',
    'notifyOnJobFailure',
  ]
  if (Object.keys(value.notifications).length !== notificationKeys.length
    || notificationKeys.some(key => typeof value.notifications[key] !== 'boolean')) {
    throw new TypeError(`${BIN_NAME}: Setup Wizard update must contain all five notification booleans`)
  }
  return Object.freeze({
    mode: requestedMode,
    macosMaterial: value.macosMaterial,
    windowsMaterial: value.windowsMaterial,
    openBrowser,
    networkExposure,
    notifications: Object.freeze({
      enabled: value.notifications.enabled,
      notifyOnTurnCompletion: value.notifications.notifyOnTurnCompletion,
      notifyOnTurnFailure: value.notifications.notifyOnTurnFailure,
      notifyOnJobCompletion: value.notifications.notifyOnJobCompletion,
      notifyOnJobFailure: value.notifications.notifyOnJobFailure,
    }),
  })
}

function sameSettings(
  current: DesktopSetupWizardSettings,
  next: DesktopSetupWizardSettings,
): boolean {
  return current.mode === next.mode
    && current.macosMaterial === next.macosMaterial
    && current.windowsMaterial === next.windowsMaterial
    && current.openBrowser === next.openBrowser
    && current.networkExposure === next.networkExposure
    && current.notifications.enabled === next.notifications.enabled
    && current.notifications.notifyOnTurnCompletion === next.notifications.notifyOnTurnCompletion
    && current.notifications.notifyOnTurnFailure === next.notifications.notifyOnTurnFailure
    && current.notifications.notifyOnJobCompletion === next.notifications.notifyOnJobCompletion
    && current.notifications.notifyOnJobFailure === next.notifications.notifyOnJobFailure
}

function applyYamlUpdate(
  document: NonNullable<LoadedSettingsDocument['yaml']>,
  next: DesktopSetupWizardSettings,
): string {
  document.setIn([DESKTOP_NAMESPACE, 'mode'], next.mode)
  document.setIn([DESKTOP_NAMESPACE, 'macosMaterial'], next.macosMaterial)
  document.setIn([DESKTOP_NAMESPACE, 'windowsMaterial'], next.windowsMaterial)
  document.setIn([DESKTOP_NAMESPACE, 'openBrowser'], next.openBrowser)
  document.setIn([DESKTOP_NAMESPACE, 'networkExposure'], next.networkExposure)
  for (const [key, value] of Object.entries(next.notifications)) {
    document.setIn([NOTIFICATIONS_NAMESPACE, key], value)
  }
  return document.toString()
}

function applyJsonUpdate(
  root: Record<string, unknown>,
  next: DesktopSetupWizardSettings,
): string {
  const output = structuredClone(root)
  const desktop = { ...section(output, DESKTOP_NAMESPACE) }
  desktop.mode = next.mode
  desktop.macosMaterial = next.macosMaterial
  desktop.windowsMaterial = next.windowsMaterial
  desktop.openBrowser = next.openBrowser
  desktop.networkExposure = next.networkExposure
  output[DESKTOP_NAMESPACE] = desktop
  output[NOTIFICATIONS_NAMESPACE] = {
    ...section(output, NOTIFICATIONS_NAMESPACE),
    ...next.notifications,
  }
  return `${JSON.stringify(output, undefined, 2)}\n`
}

function ensureDocumentDirectory(path: string): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true, mode: DOCUMENT_DIRECTORY_MODE })
  const info = lstatSync(directory)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw invalid('document parent must be a real directory')
  }
}

/** Read defaults or validated current values from the exact prepared settings file. */
export function readDesktopSetupWizardSettings(
  documentPath: string,
): DesktopSetupWizardSettings {
  const path = settingsPath(documentPath)
  return projectSettings(loadSettingsDocument(path).root)
}

/**
 * Atomically update only Wizard-owned leaves, preserving every other setting.
 * Setup runs before the Host and never creates or waits for a settings writer
 * lock; the same-directory rename still keeps readers from seeing torn bytes.
 */
export async function updateDesktopSetupWizardSettings(
  documentPath: string,
  value: DesktopSetupWizardSettings,
): Promise<DesktopSetupWizardSettings> {
  const path = settingsPath(documentPath)
  const next = normalizedUpdate(value)
  // Explicit default leaves do not need to be materialized. Apart from making
  // Setup idempotent, this lets an unchanged first-run choice proceed while an
  // unrelated or orphaned settings writer lock exists.
  if (sameSettings(projectSettings(loadSettingsDocument(path).root), next)) return next
  ensureDocumentDirectory(path)
  const loaded = loadSettingsDocument(path)
  // Refuse to cover an invalid known value, including the inactive platform's
  // material, before touching the user's document.
  projectSettings(loaded.root)
  const output = loaded.format === 'yaml'
    ? applyYamlUpdate(loaded.yaml!, next)
    : applyJsonUpdate(loaded.root, next)
  await writeFileAtomic(path, output, {
    mode: DOCUMENT_FILE_MODE,
    dirMode: DOCUMENT_DIRECTORY_MODE,
  })
  return next
}

/**
 * Atomically migrate settings written with the former browser-handoff
 * semantics before the Host reads them. Existing LAN exposure becomes an
 * explicit browser-access grant only for an already-selected compatibility
 * mode. Incompatible modes retain their selection and withdraw browser/LAN
 * access. Returns whether the durable document changed.
 */
export async function migrateDesktopBrowserAccessSettings(
  documentPath: string,
): Promise<boolean> {
  const path = settingsPath(documentPath)

  const migrationValues = (loaded: LoadedSettingsDocument) => {
    // Validate every known Wizard-owned value before migrating any leaf.
    projectSettings(loaded.root)
    const desktop = section(loaded.root, DESKTOP_NAMESPACE)
    const storedMode = parseMode(desktop.mode)
    const storedOpenBrowser = optionalBoolean(desktop, 'openBrowser', false)
    const storedExposure = parseExposure(desktop.networkExposure)
    const browserAccess = desktopBrowserAccessEnabled(storedMode, storedOpenBrowser, storedExposure)
    const networkExposure = desktopNetworkExposureForBrowserAccess(browserAccess, storedExposure)
    return {
      browserAccess,
      needed: storedOpenBrowser !== browserAccess || storedExposure !== networkExposure,
      networkExposure,
    }
  }

  // Most Profiles are already normalized. Keep their startup entirely
  // read-only so an unrelated or orphaned settings writer lock cannot block
  // Desktop from opening.
  if (!migrationValues(loadSettingsDocument(path)).needed) return false

  ensureDocumentDirectory(path)
  const loaded = loadSettingsDocument(path)
  const migration = migrationValues(loaded)
  if (!migration.needed) return false

  let output: string
  if (loaded.format === 'yaml') {
    loaded.yaml!.setIn([DESKTOP_NAMESPACE, 'openBrowser'], migration.browserAccess)
    loaded.yaml!.setIn([DESKTOP_NAMESPACE, 'networkExposure'], migration.networkExposure)
    output = loaded.yaml!.toString()
  } else {
    const root = structuredClone(loaded.root)
    const nextDesktop = { ...section(root, DESKTOP_NAMESPACE) }
    nextDesktop.openBrowser = migration.browserAccess
    nextDesktop.networkExposure = migration.networkExposure
    root[DESKTOP_NAMESPACE] = nextDesktop
    output = `${JSON.stringify(root, undefined, 2)}\n`
  }
  await writeFileAtomic(path, output, {
    mode: DOCUMENT_FILE_MODE,
    dirMode: DOCUMENT_DIRECTORY_MODE,
  })
  return true
}

/** Defaults used when the settings document or both owned sections are absent. */
export function defaultDesktopSetupWizardSettings(
): DesktopSetupWizardSettings {
  return Object.freeze({
    mode: 'compatibility',
    macosMaterial: DEFAULT_MACOS_WINDOW_MATERIAL,
    windowsMaterial: DEFAULT_WINDOWS_WINDOW_MATERIAL,
    openBrowser: false,
    networkExposure: 'loopback',
    notifications: Object.freeze({
      enabled: true,
      notifyOnTurnCompletion: true,
      notifyOnTurnFailure: true,
      notifyOnJobCompletion: true,
      notifyOnJobFailure: true,
    }),
  })
}

export const desktopSetupWizardSettingsConstants = Object.freeze({
  desktopNamespace: DESKTOP_NAMESPACE,
  notificationsNamespace: NOTIFICATIONS_NAMESPACE,
  maxDocumentBytes: MAX_DOCUMENT_BYTES,
  fileMode: DOCUMENT_FILE_MODE,
})
