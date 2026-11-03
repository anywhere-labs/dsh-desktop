/** Preferences remain readable when no Host or user plugin can start. */
import { join } from 'node:path'
import { DEFAULT_PREFERENCES, type DesktopPreferences } from './desktop-contract.ts'
import { isHostStartupTimeout } from './host-startup-limit.ts'
import { atomicJson, readPrivateFile } from './private-files.ts'

/**
 * Preferences added after 2.0.22, with their validators. Released builds reject any key they do not know
 * in desktop-preferences.json and open recovery, so these live in desktop-preferences-extra.json, which
 * those builds never read: a downgrade keeps starting, and the next upgrade finds the choice again.
 * Every later preference belongs here too.
 */
const EXTRA_PREFERENCES = {
  hostStartupTimeout: isHostStartupTimeout,
} as const satisfies { readonly [K in keyof DesktopPreferences]?: (value: unknown) => value is DesktopPreferences[K] }

type ExtraPreferenceKey = keyof typeof EXTRA_PREFERENCES
export type ExtraPreferences = Pick<DesktopPreferences, ExtraPreferenceKey>
const EXTRA_PREFERENCE_KEYS = Object.keys(EXTRA_PREFERENCES) as ExtraPreferenceKey[]

export function parsePreferences(value: unknown): DesktopPreferences {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Desktop preferences')
  const source = value as Record<string, unknown>
  if (Object.keys(source).some(key => !(key in DEFAULT_PREFERENCES))) throw new Error('Unknown Desktop preference')
  const result = { ...DEFAULT_PREFERENCES, ...source }
  // Acrylic and Mica were removed like in the original Desktop. Old preference
  // files stay readable and fail closed to the ordinary opaque Windows window.
  if (source.windowsMaterial === 'acrylic' || source.windowsMaterial === 'mica') result.windowsMaterial = 'off'
  for (const key of ['developerLogging', 'sidebarFooterCompat', 'sidebarFooterBalanced', 'closeToTray', 'browserAccess', 'notifications', 'turnCompleted', 'turnFailed', 'jobCompleted', 'jobFailed', 'scheduleCompleted', 'scheduleFailed', 'anywhereSidebar', 'anywhereConversation'] as const) {
    if (typeof result[key] !== 'boolean') throw new Error(`Invalid Desktop preference: ${key}`)
  }
  for (const [key, choices] of Object.entries({ macosMaterial: ['off', 'transparent'], windowsMaterial: ['off'],
    linuxMaterial: ['off', 'transparent'], networkExposure: ['loopback', 'lan'], logLevel: ['debug', 'info', 'warn', 'error'] })) {
    if (!choices.includes(String(result[key as keyof DesktopPreferences]))) throw new Error(`Invalid Desktop preference: ${key}`)
  }
  for (const key of ['port', 'lanPort'] as const) {
    if (typeof result[key] !== 'number' || !Number.isInteger(result[key]) || result[key] < 0 || result[key] > 65535) {
      throw new Error('Port must be an integer from 0 through 65535')
    }
  }
  for (const key of EXTRA_PREFERENCE_KEYS) {
    if (!EXTRA_PREFERENCES[key](result[key])) throw new Error(`Invalid Desktop preference: ${key}`)
  }
  // The upstream compatibility client paints an opaque background, so a transparent Linux
  // frame stays invisible. Fail closed to the solid frame exactly like the existing Desktop.
  return { ...result, linuxMaterial: 'off', jobCompleted: false, jobFailed: false } as DesktopPreferences
}

export function portsChanged(previous: DesktopPreferences, next: DesktopPreferences): boolean {
  return (['port', 'lanPort'] as const).some(key => previous[key] !== next[key])
}

export class DesktopPreferenceStore {
  readonly file: string
  /** The preferences released builds do not know; see EXTRA_PREFERENCES. */
  readonly extraFile: string
  /**
   * @param home - The data directory holding both files.
   * @param warn - Receives what the lenient read of the extra file ignored.
   */
  constructor(home: string, private readonly warn: (message: string) => void = () => {}) {
    this.file = join(home, 'desktop-preferences.json')
    this.extraFile = join(home, 'desktop-preferences-extra.json')
  }
  read(): DesktopPreferences {
    const text = readPrivateFile(this.file)
    const preferences = text === undefined ? { ...DEFAULT_PREFERENCES } : parsePreferences(JSON.parse(text))
    return { ...preferences, ...this.readExtra() }
  }
  /**
   * Read the extra preferences alone, leniently: recovery must stay reachable, and each default is the
   * behaviour of the releases before the preference existed.
   * @returns Each stored valid value, or its default where the file, or that value, is missing or invalid.
   */
  readExtra(): ExtraPreferences {
    return this.loadExtra().values
  }
  write(value: unknown): DesktopPreferences {
    const preferences = parsePreferences(value)
    atomicJson(this.file, Object.fromEntries(Object.entries(preferences).filter(([key]) => !(key in EXTRA_PREFERENCES))))
    this.writeExtra(Object.fromEntries(EXTRA_PREFERENCE_KEYS.map(key => [key, preferences[key]])))
    return preferences
  }
  /**
   * Change extra preferences without reading or replacing desktop-preferences.json. Keys a later release
   * added are kept as stored.
   * @param values - The values to change.
   */
  writeExtra(values: Partial<ExtraPreferences>): void {
    for (const [key, value] of Object.entries(values)) {
      if (!(key in EXTRA_PREFERENCES) || !EXTRA_PREFERENCES[key as ExtraPreferenceKey](value)) throw new Error(`Invalid Desktop preference: ${key}`)
    }
    const { stored } = this.loadExtra()
    atomicJson(this.extraFile, { ...stored, ...values })
  }
  private loadExtra(): { values: ExtraPreferences; stored: Record<string, unknown> } {
    let stored: Record<string, unknown> = {}
    try {
      const text = readPrivateFile(this.extraFile)
      const value: unknown = text === undefined ? {} : JSON.parse(text)
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) stored = value as Record<string, unknown>
      else this.warn(`Ignored ${this.extraFile}: not a JSON object`)
    } catch (error) {
      this.warn(`Ignored ${this.extraFile}: ${String(error)}`)
    }
    const values = Object.fromEntries(EXTRA_PREFERENCE_KEYS.map(key => [key, DEFAULT_PREFERENCES[key]])) as ExtraPreferences
    for (const key of EXTRA_PREFERENCE_KEYS) {
      if (!(key in stored)) continue
      if (EXTRA_PREFERENCES[key](stored[key])) Object.assign(values, { [key]: stored[key] })
      else this.warn(`Ignored an invalid ${key} in ${this.extraFile}`)
    }
    return { values, stored }
  }
}
