import { describe, expect, it } from 'vitest'
import {
  DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES,
  DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES,
  readAndroidLogcatFilterPreferences,
  readAndroidLogcatDisplayPreferences,
  writeAndroidLogcatFilterPreferences,
  writeAndroidLogcatDisplayPreferences,
  type AndroidLogcatPreferenceStorage,
} from '../src/client/android-logcat-preferences.ts'

class MemoryStorage implements AndroidLogcatPreferenceStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('Android Logcat remembered regex fields', () => {
  it('restores each field for its own device across drawer/store lifetimes', () => {
    const storage = new MemoryStorage()
    const saved = { tag: '^(Runtime|System)$', excludeTag: '^(WebSocketClient)$', process: '^com\\.example$', message: 'error|timeout' }
    writeAndroidLogcatFilterPreferences('usb:1', saved, storage)

    expect(readAndroidLogcatFilterPreferences('usb:1', storage)).toEqual(saved)
    expect(readAndroidLogcatFilterPreferences('emulator-5554', storage)).toEqual(DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES)
  })

  it('ignores corrupted or unsupported preference records', () => {
    const storage = new MemoryStorage()
    storage.values.set('dsh.android-logcat.filters.v1:broken', '{not json')
    storage.values.set('dsh.android-logcat.filters.v1:future', JSON.stringify({ version: 3, tag: 'x' }))
    expect(readAndroidLogcatFilterPreferences('broken', storage)).toEqual(DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES)
    expect(readAndroidLogcatFilterPreferences('future', storage)).toEqual(DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES)
  })

  it('migrates older device preferences and seeds the new defaults once', () => {
    const storage = new MemoryStorage()
    storage.values.set('dsh.android-logcat.filters.v1:legacy', JSON.stringify({
      version: 1, tag: '^Network$', process: '', message: 'timeout',
    }))

    expect(readAndroidLogcatFilterPreferences('legacy', storage)).toEqual({
      tag: '^Network$',
      excludeTag: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.excludeTag,
      process: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.process,
      message: 'timeout',
    })
    expect(JSON.parse(storage.values.get('dsh.android-logcat.filters.v1:legacy') ?? '{}')).toMatchObject({ version: 2 })
  })

  it('bounds remembered expressions and tolerates blocked browser storage', () => {
    const storage = new MemoryStorage()
    writeAndroidLogcatFilterPreferences('device', {
      tag: 'x'.repeat(513), excludeTag: '^WebSocketClient$', process: '^system_server$', message: 'fatal',
    }, storage)
    expect(readAndroidLogcatFilterPreferences('device', storage)).toEqual({
      tag: '', excludeTag: '^WebSocketClient$', process: '^system_server$', message: 'fatal',
    })

    const blocked: AndroidLogcatPreferenceStorage = {
      getItem: () => { throw new Error('storage blocked') },
      setItem: () => { throw new Error('storage blocked') },
    }
    expect(readAndroidLogcatFilterPreferences('device', blocked)).toEqual(DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES)
    expect(() => writeAndroidLogcatFilterPreferences('device', {
      tag: '', excludeTag: '', process: '', message: '',
    }, blocked)).not.toThrow()
  })

  it('persists global display settings independently of the selected device', () => {
    const storage = new MemoryStorage()
    expect(readAndroidLogcatDisplayPreferences(storage)).toEqual(DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES)
    writeAndroidLogcatDisplayPreferences({ uiFontSize: 18, logFontSize: 20, showOperationTips: false }, storage)
    expect(readAndroidLogcatDisplayPreferences(storage)).toEqual({ uiFontSize: 18, logFontSize: 20, showOperationTips: false })
  })

  it('uses safe defaults for malformed display settings and ignores unsupported font sizes', () => {
    const storage = new MemoryStorage()
    storage.values.set('dsh.android-logcat.display.v1', JSON.stringify({
      version: 1, uiFontSize: 200, logFontSize: 'large', showOperationTips: false,
    }))
    expect(readAndroidLogcatDisplayPreferences(storage)).toEqual({
      ...DEFAULT_ANDROID_LOGCAT_DISPLAY_PREFERENCES,
      showOperationTips: false,
    })
  })
})
