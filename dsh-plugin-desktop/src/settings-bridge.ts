/**
 * Edition-local adapter between the shared Desktop sources and the core
 * settings surface.
 *
 * Stable rides dsh 0.1.5-rc.2, whose `SettingsProvider` service owns a
 * namespaced user-settings document: a plugin registers a namespace and its
 * schema, reads and writes through the returned scope, and observes other
 * plugins' namespaces on the `settings/updated` event.
 *
 * Every shared source file calls only the edition-neutral names exported here,
 * so `scripts/verify-desktop-variants.mjs` keeps byte-comparing them against
 * the beta edition while the two implementations stay free to diverge.
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import {
  LOCALE_SETTINGS_NAMESPACE,
  type LocaleSettings,
} from '@deepseek-ai/dsh-client-locale'
import {
  THEME_SETTINGS_NAMESPACE,
  type ThemeSettings,
} from '@deepseek-ai/dsh-client-ui-theme'
import { DESKTOP_DEFAULT_WEB_PORT } from './desktop-port.ts'
import {
  desktopBrowserAccessAvailable,
  type DesktopNetworkExposure,
} from './desktop-network.ts'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'
import type { DesktopProfilePreferences } from './profile-preferences.ts'
import { desktopProfilePreferencesFromSettings } from './profile-preferences.ts'
import type { DesktopShellMode } from './runtime.ts'
import {
  DEFAULT_LINUX_WINDOW_MATERIAL,
  DEFAULT_MACOS_WINDOW_MATERIAL,
  DEFAULT_WINDOWS_WINDOW_MATERIAL,
  type LinuxWindowMaterial,
  type MacosWindowMaterial,
  type PersistedWindowsWindowMaterial,
} from './window-material.ts'

/** Standard settings namespace shared by tray and configuration surfaces. */
export const DESKTOP_SETTINGS_NAMESPACE = 'dsh-desktop'

/**
 * Settings namespace of the Desktop shell plugin. On this channel the
 * user-settings document is keyed by namespace rather than by Loader entry id,
 * so it is the namespace itself.
 */
export const DESKTOP_SETTINGS_ENTRY_ID = DESKTOP_SETTINGS_NAMESPACE

/** Settings namespace of the Desktop notification plugin. */
export const DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID = 'dsh-desktop-notifications'

/** Namespace carrying the shared locale preference. */
const UI_LOCALE_SETTINGS_ENTRY_ID: string = LOCALE_SETTINGS_NAMESPACE

/** Namespace carrying the shared theme preference. */
const UI_THEME_SETTINGS_ENTRY_ID: string = THEME_SETTINGS_NAMESPACE

/** Desktop preferences presented by the standard configuration form. */
export interface DesktopSettings {
  /** Native presentation selected for the next application generation. */
  mode: DesktopShellMode
  /** Native translucency preference used on macOS custom-chrome modes. */
  macosMaterial: MacosWindowMaterial
  /** Native backdrop preference used on Windows custom-chrome modes. */
  windowsMaterial: PersistedWindowsWindowMaterial
  /** Electron-native transparency preference used on Linux generations. */
  linuxMaterial: LinuxWindowMaterial
  /** Loopback Web port selected for the next application generation; zero requests a random port. */
  port: number
  /** Whether Desktop advertises its marker-free compatibility client for browser use. */
  openBrowser: boolean
  /** Whether the next generation listens only on loopback or on every LAN interface. */
  networkExposure: DesktopNetworkExposure
  /** Log verbosity threshold applied to the file logger. */
  logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/** Schema of the editable Desktop preference subset. */
export const DesktopSettingsSchema: z<DesktopSettings> = z.object({
  mode: z.union(['compatibility', 'extended', 'advanced'] as const).default('compatibility'),
  macosMaterial: z.union(['off', 'transparent'] as const).default(DEFAULT_MACOS_WINDOW_MATERIAL),
  windowsMaterial: z.union(['off', 'acrylic', 'mica'] as const).default(DEFAULT_WINDOWS_WINDOW_MATERIAL),
  linuxMaterial: z.union(['off', 'transparent'] as const).default(DEFAULT_LINUX_WINDOW_MATERIAL),
  port: z.number().step(1).min(0).max(65_535).default(DESKTOP_DEFAULT_WEB_PORT),
  openBrowser: z.boolean().default(false),
  networkExposure: z.union(['loopback', 'lan'] as const).default('loopback'),
  logLevel: z.union(['debug', 'info', 'warn', 'error'] as const).default('info'),
})

/** Native window configuration. */
export interface DesktopShellConfig {
  /** Native presentation mode selected before BrowserWindow construction. */
  mode: DesktopShellMode
  /** Native translucency preference used on macOS custom-chrome modes. */
  macosMaterial: MacosWindowMaterial
  /** Native backdrop preference used on Windows custom-chrome modes. */
  windowsMaterial: PersistedWindowsWindowMaterial
  /** Electron-native transparency preference used on Linux generations. */
  linuxMaterial: LinuxWindowMaterial
  /** Configured loopback Web port used to detect restart-applied settings changes. */
  port: number
  /** Configured listener exposure used to detect restart-applied settings changes. */
  networkExposure: DesktopNetworkExposure
  /** Initial window width in CSS pixels. */
  width: number
  /** Initial window height in CSS pixels. */
  height: number
  /** Minimum window width in CSS pixels. */
  minWidth: number
  /** Minimum window height in CSS pixels. */
  minHeight: number
}

/** Validated native window configuration. */
export const DesktopShellConfig: z<DesktopShellConfig> = z.object({
  mode: z.union(['compatibility', 'extended', 'advanced'] as const).default('compatibility'),
  macosMaterial: z.union(['off', 'transparent'] as const).default(DEFAULT_MACOS_WINDOW_MATERIAL),
  windowsMaterial: z.union(['off', 'acrylic', 'mica'] as const).default(DEFAULT_WINDOWS_WINDOW_MATERIAL),
  linuxMaterial: z.union(['off', 'transparent'] as const).default(DEFAULT_LINUX_WINDOW_MATERIAL),
  port: z.number().step(1).min(0).max(65_535).default(DESKTOP_DEFAULT_WEB_PORT),
  networkExposure: z.union(['loopback', 'lan'] as const).default('loopback'),
  width: z.number().step(1).min(800).default(1280),
  height: z.number().step(1).min(600).default(840),
  minWidth: z.number().step(1).min(640).default(900),
  minHeight: z.number().step(1).min(480).default(640),
})

/** Startup-applied window configuration. */
export type ResolvedDesktopConfig = DesktopShellConfig

/**
 * Read the startup-applied configuration once.
 *
 * Every field is already a plain value on this channel, so the snapshot is the
 * configuration itself.
 * @param config - validated native window configuration.
 * @returns the plain startup configuration.
 */
export function resolveDesktopConfig(config: DesktopShellConfig): ResolvedDesktopConfig {
  return config
}

/** Edition-neutral read, observe, and write face over the Desktop preferences. */
export interface DesktopSettingsPort {
  /** @returns the preferences standing right now. */
  get(): DesktopSettings
  /**
   * Observe accepted preference changes.
   * @param listener - invoked with the preferences after each accepted change.
   * @returns the disposer removing this listener.
   */
  watch(listener: (next: DesktopSettings) => void): () => void
  /**
   * Merge a partial preference edit.
   * @param patch - fields to write.
   */
  update(patch: Partial<DesktopSettings>): Promise<void>
}

/**
 * Register the Desktop shell preferences and fence invalid combinations.
 * @param ctx - the Desktop shell plugin context.
 * @param config - this instance's validated configuration.
 * @param platform - the active Electron platform.
 * @returns the preference port consumed by the shared shell sources.
 */
export function createDesktopSettingsPort(
  ctx: Context,
  config: DesktopShellConfig,
  platform: NodeJS.Platform,
): DesktopSettingsPort {
  void config
  const scope = ctx.settings.register(
    DESKTOP_SETTINGS_NAMESPACE,
    DesktopSettingsSchema,
    {
      applies: 'restart',
      validate: (value) => { assertDesktopSettings(value, platform) },
    },
  )
  return {
    get: () => scope.get(),
    watch: listener => scope.watch((next) => { listener(next) }),
    update: patch => scope.update(patch),
  }
}

/** Refuse preference combinations the native shell cannot present. */
function assertDesktopSettings(value: DesktopSettings, platform: NodeJS.Platform): void {
  if (!desktopBrowserAccessAvailable(value.mode) && value.openBrowser) {
    throw new Error('dsh-plugin-desktop: browser access requires compatibility mode')
  }
  if (value.mode !== 'compatibility' && platform === 'linux') {
    throw new Error('dsh-plugin-desktop: custom desktop shell modes are supported on macOS and Windows')
  }
}

/** Desktop notification preferences presented by the standard configuration form. */
export interface DesktopNotificationSettings {
  /** Whether any native notification is raised at all. */
  enabled: boolean
  /** Raise attention when a user-initiated turn completes. */
  notifyOnTurnCompletion: boolean
  /** Raise attention when a user-initiated turn fails. */
  notifyOnTurnFailure: boolean
  /** Raise attention when a background job completes. */
  notifyOnJobCompletion: boolean
  /** Raise attention when a background job fails. */
  notifyOnJobFailure: boolean
}

/** Schema of the editable notification preference subset. */
export const DesktopNotificationSettingsSchema: z<DesktopNotificationSettings> = z.object({
  enabled: z.boolean().default(true),
  notifyOnTurnCompletion: z.boolean().default(true),
  notifyOnTurnFailure: z.boolean().default(true),
  notifyOnJobCompletion: z.boolean().default(true),
  notifyOnJobFailure: z.boolean().default(true),
})

/**
 * Live notification preferences.
 *
 * The notification preferences live in the user-settings document on this
 * channel, not in the entry configuration, so the entry schema exists only to
 * keep the plugin's `apply` signature aligned with the beta edition and is
 * never read.
 */
export type DesktopNotificationConfig = Readonly<Record<string, never>>

/** Validated live notification preferences. */
export const DesktopNotificationConfig: z<DesktopNotificationConfig> =
  z.object({}) as unknown as z<DesktopNotificationConfig>

/** Notification preferences standing before the first observed value. */
export const DEFAULT_NOTIFICATION_SETTINGS: DesktopNotificationSettings =
  DesktopNotificationSettingsSchema({} as DesktopNotificationSettings)

/**
 * Register the notification preferences and follow their live edits.
 * @param ctx - the notification plugin context.
 * @param config - this instance's validated configuration; unread on this channel.
 * @param listener - invoked with the preferences standing after each change.
 * @returns the disposer restoring the defaults.
 */
export function bindDesktopNotificationSettings(
  ctx: Context,
  config: DesktopNotificationConfig,
  listener: (next: DesktopNotificationSettings) => void,
): () => void {
  void config
  const scope = ctx.settings.register(
    DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID,
    DesktopNotificationSettingsSchema,
    { applies: 'live' },
  )
  listener(scope.get())
  const stopWatching = scope.watch((next) => { listener(next) })
  return () => {
    stopWatching()
    listener(DEFAULT_NOTIFICATION_SETTINGS)
  }
}

/**
 * Read the shared locale preference.
 * @param ctx - any Host context.
 * @returns the configured locale id, or undefined when none is selected.
 */
export function readUiLocalePreference(ctx: Context): string | undefined {
  return (ctx.settings.get(UI_LOCALE_SETTINGS_ENTRY_ID) as LocaleSettings | undefined)?.preference
}

/**
 * Read the shared theme preference.
 * @param ctx - any Host context.
 * @returns the configured built-in theme preference.
 * @throws When the composition does not serve the theme namespace.
 */
export function readUiThemeSource(ctx: Context): ThemeSettings['preference'] {
  const theme = ctx.settings.get(UI_THEME_SETTINGS_ENTRY_ID) as ThemeSettings | undefined
  if (theme === undefined) {
    throw new Error('dsh-plugin-desktop: custom shell requires the ui-theme settings namespace')
  }
  return theme.preference
}

/**
 * Follow the shared theme preference.
 * @param ctx - any Host context.
 * @param listener - invoked with the preference standing after each change.
 */
export function watchUiThemeSource(
  ctx: Context,
  listener: (preference: ThemeSettings['preference']) => void,
): void {
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace !== UI_THEME_SETTINGS_ENTRY_ID) return
    listener((next as ThemeSettings).preference)
  })
}

/**
 * Follow the shared locale preference.
 * @param ctx - any Host context.
 * @param listener - invoked with the preference standing after each change.
 */
export function watchUiLocalePreference(
  ctx: Context,
  listener: (preference: string | undefined) => void,
): void {
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace !== UI_LOCALE_SETTINGS_ENTRY_ID) return
    listener((next as LocaleSettings).preference)
  })
}

/** File log exporter seam owned by the Host bootstrap. */
export interface DesktopLogThresholdSink {
  /** Apply the configured verbosity threshold. */
  setThreshold(level: DesktopSettings['logLevel']): void
}

/** Serialized Profile preference writer owned by the Host bootstrap. */
export type DesktopProfilePreferencesWriter = (
  update: (current: DesktopProfilePreferences) => DesktopProfilePreferences,
) => Promise<unknown>

/**
 * Mirror the Desktop and notification preferences into the active Profile and
 * keep the file logger threshold current.
 * @param ctx - the Host root context.
 * @param fileExporter - the file log exporter, when one is installed.
 * @param enqueueProfilePreferencesWrite - the serialized Profile preference writer.
 */
export function observeDesktopPreferenceSettings(
  ctx: Context,
  fileExporter: DesktopLogThresholdSink | undefined,
  enqueueProfilePreferencesWrite: DesktopProfilePreferencesWriter,
): void {
  fileExporter?.setThreshold((ctx.settings.get(DESKTOP_SETTINGS_ENTRY_ID) as DesktopSettings | undefined)?.logLevel ?? 'info')
  ctx.on('settings/updated', (namespace, next) => {
    if (namespace === DESKTOP_SETTINGS_ENTRY_ID) {
      fileExporter?.setThreshold((next as DesktopSettings).logLevel)
    }
    if (namespace !== DESKTOP_SETTINGS_ENTRY_ID
      && namespace !== DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID) return
    const write = enqueueProfilePreferencesWrite(current => desktopProfilePreferencesFromSettings(
      namespace === DESKTOP_SETTINGS_ENTRY_ID
        ? next as DesktopSettings
        : ctx.settings.get(DESKTOP_SETTINGS_ENTRY_ID) as DesktopSettings,
      namespace === DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID
        ? next as DesktopNotificationSettings
        : ctx.settings.get(DESKTOP_NOTIFICATIONS_SETTINGS_ENTRY_ID) as DesktopNotificationSettings,
      current.market,
      current.aaEnabled === true,
    ))
    void write.catch((cause: unknown) => {
      ctx.logger.error(
        `${DESKTOP_PACKAGE_NAME}: failed to capture active Profile settings: ${cause instanceof Error ? cause.message : String(cause)}`,
      )
    })
  })
}
