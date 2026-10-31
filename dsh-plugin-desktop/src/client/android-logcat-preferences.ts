/** Device-scoped persistence for Android Logcat regex inputs. */

import { ANDROID_LOGCAT_MAX_FILTER_LENGTH } from './android-logcat-api.ts'

export interface AndroidLogcatFilterPatterns {
  readonly tag: string
  readonly excludeTag: string
  readonly process: string
  readonly message: string
}

export interface AndroidLogcatPreferenceStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface AndroidLogcatDisplayPreferences {
  readonly uiFontSize: number
  readonly logFontSize: number
  readonly showOperationTips: boolean
}

export const ANDROID_LOGCAT_UI_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20] as const
export const ANDROID_LOGCAT_LOG_FONT_SIZES = [10, 11, 12, 13, 14, 16, 18, 20, 22, 24] as const
export const DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES: AndroidLogcatDisplayPreferences = Object.freeze({
  uiFontSize: 12,
  logFontSize: 12,
  showOperationTips: true,
})

const STORAGE_KEY_PREFIX = 'dsh.android-logcat.filters.v1:'
const DISPLAY_STORAGE_KEY = 'dsh.android-logcat.display.v1'
const DISPLAY_PREFERENCE_VERSION = 1
export const DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES: AndroidLogcatFilterPatterns = Object.freeze({
  tag: '',
  excludeTag: 'WebSocketClient|OSAgent\\.TTS|OSAgent\\.TaskCenter',
  process: 'native|osagent|claw|frame',
  message: '',
})

function getStorage(): AndroidLogcatPreferenceStorage | undefined {
  try {
    return typeof window === 'undefined' ? undefined : window.localStorage
  } catch {
    return undefined
  }
}

function storageKey(serial: string): string {
  return `${STORAGE_KEY_PREFIX}${encodeURIComponent(serial)}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readPattern(value: unknown): string {
  return typeof value === 'string' && value.length <= ANDROID_LOGCAT_MAX_FILTER_LENGTH ? value : ''
}

/** Load only this device's last-used fields; corrupt or unavailable storage is harmless. */
export function readAndroidLogcatFilterPreferences(
  serial: string,
  storage: AndroidLogcatPreferenceStorage | undefined = getStorage(),
): AndroidLogcatFilterPatterns {
  if (!serial || storage === undefined) return DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES
  try {
    const raw = storage.getItem(storageKey(serial))
    if (raw === null) return DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value)) return DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES
    if (value.version === 1) {
      // Migrate saved three-field preferences and seed the newly requested defaults once.
      const migrated: AndroidLogcatFilterPatterns = {
        tag: readPattern(value.tag),
        excludeTag: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.excludeTag,
        process: readPattern(value.process) || DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.process,
        message: readPattern(value.message),
      }
      writeAndroidLogcatFilterPreferences(serial, migrated, storage)
      return migrated
    }
    if (value.version !== 2) return DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES
    return {
      tag: readPattern(value.tag),
      excludeTag: readPattern(value.excludeTag),
      process: readPattern(value.process),
      message: readPattern(value.message),
    }
  } catch {
    return DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES
  }
}

/** Save each pattern under its adb serial so filters never leak across devices. */
export function writeAndroidLogcatFilterPreferences(
  serial: string,
  patterns: AndroidLogcatFilterPatterns,
  storage: AndroidLogcatPreferenceStorage | undefined = getStorage(),
): void {
  if (!serial || storage === undefined) return
  try {
    storage.setItem(storageKey(serial), JSON.stringify({
      version: 2,
      tag: readPattern(patterns.tag),
      excludeTag: readPattern(patterns.excludeTag),
      process: readPattern(patterns.process),
      message: readPattern(patterns.message),
    }))
  } catch {
    // Private browsing, quota limits, or disabled storage must not break Logcat.
  }
}

/** Read display preferences globally so typography and tips remain consistent across devices. */
export function readAndroidLogcatDisplayPreferences(
  storage: AndroidLogcatPreferenceStorage | undefined = getStorage(),
): AndroidLogcatDisplayPreferences {
  if (storage === undefined) return DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES
  try {
    const raw = storage.getItem(DISPLAY_STORAGE_KEY)
    if (raw === null) return DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES
    const value: unknown = JSON.parse(raw)
    if (!isRecord(value) || value.version !== DISPLAY_PREFERENCE_VERSION) return DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES
    return {
      uiFontSize: readFontSize(value.uiFontSize, ANDROID_LOGCAT_UI_FONT_SIZES, DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES.uiFontSize),
      logFontSize: readFontSize(value.logFontSize, ANDROID_LOGCAT_LOG_FONT_SIZES, DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES.logFontSize),
      showOperationTips: typeof value.showOperationTips === 'boolean'
        ? value.showOperationTips
        : DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES.showOperationTips,
    }
  } catch {
    return DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES
  }
}

/** Save global typography and operation-tip visibility without coupling them to a device. */
export function writeAndroidLogcatDisplayPreferences(
  preferences: AndroidLogcatDisplayPreferences,
  storage: AndroidLogcatPreferenceStorage | undefined = getStorage(),
): void {
  if (storage === undefined) return
  try {
    storage.setItem(DISPLAY_STORAGE_KEY, JSON.stringify({
      version: DISPLAY_PREFERENCE_VERSION,
      uiFontSize: readFontSize(preferences.uiFontSize, ANDROID_LOGCAT_UI_FONT_SIZES, DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES.uiFontSize),
      logFontSize: readFontSize(preferences.logFontSize, ANDROID_LOGCAT_LOG_FONT_SIZES, DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES.logFontSize),
      showOperationTips: preferences.showOperationTips,
    }))
  } catch {
    // Private browsing, quota limits, or disabled storage must not break Logcat.
  }
}

function readFontSize(value: unknown, allowed: readonly number[], fallback: number): number {
  return typeof value === 'number' && allowed.some(size => size === value) ? value : fallback
}
