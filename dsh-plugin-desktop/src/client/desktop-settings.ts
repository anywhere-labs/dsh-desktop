/** Official Settings Slot registration for Desktop-owned preferences. */

import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { DesktopSettingsSection, type DesktopNotificationSettings, type DesktopShellSettings } from './DesktopSettingsSection.tsx'
import { DesktopTerminalSettingsAction } from './DesktopTerminalSettingsAction.tsx'
import { createDesktopSettingsApi } from './desktop-settings-api.ts'
import { en, zh, type DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import { installDesktopSettingsStyles } from './desktop-settings-styles.ts'
import type { DesktopClientEnvironment } from './environment.ts'

/** Locale namespace owned by the Desktop settings page. */
export const DESKTOP_SETTINGS_LOCALE_NAMESPACE = 'desktop.settings'

/** Host settings namespaces bound through the standard client settings service. */
export const DESKTOP_SHELL_SETTINGS_NAMESPACE = 'dsh-desktop'
export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'

/** Shared client controls consumed by settings and Desktop-owned window chrome. */
export interface DesktopSettingsClientControl {
  readonly api: ReturnType<typeof createDesktopSettingsApi>
  setMode(mode: DesktopShellSettings['mode']): Promise<void>
}

/**
 * Persist a native mode choice without leaving browser access in a mode the
 * marker-free client cannot render. Custom modes withdraw browser and LAN
 * access in ordered writes; the Host compares only effective generation state.
 */
export async function persistDesktopModeSelection(
  desktopSettings: Pick<SettingsScope<DesktopShellSettings>, 'set'>,
  mode: DesktopShellSettings['mode'],
): Promise<void> {
  if (mode === 'compatibility') {
    await desktopSettings.set('mode', mode)
    return
  }
  // The titlebar is interactive before the settings mirror necessarily reaches
  // ready. Always withdraw both browser capabilities for a custom mode instead
  // of treating an unavailable or stale snapshot as browser access being off.
  // Withdraw the listener first so every intermediate persisted state remains
  // valid while compatibility mode is still selected.
  await desktopSettings.set('networkExposure', 'loopback')
  await desktopSettings.set('openBrowser', false)
  await desktopSettings.set('mode', mode)
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-only settings page copy. */
    'desktop.settings': DesktopSettingsLocaleKey
  }
}

/** Register the Desktop page in the settings.section list slot. */
export function applyDesktopSettings(
  ctx: ClientContext,
  environment: DesktopClientEnvironment,
): DesktopSettingsClientControl {
  const desktopSettings = ctx.settingsScope.bind<DesktopShellSettings>({
    namespace: DESKTOP_SHELL_SETTINGS_NAMESPACE,
  })
  const notificationSettings = ctx.settingsScope.bind<DesktopNotificationSettings>({
    namespace: DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE,
  })
  const api = createDesktopSettingsApi()
  const t = ctx.locale.bind(DESKTOP_SETTINGS_LOCALE_NAMESPACE)
  const setMode = async (mode: DesktopShellSettings['mode']): Promise<void> => {
    await persistDesktopModeSelection(desktopSettings, mode)
  }

  ctx.effect(
    () => ctx.locale.register(DESKTOP_SETTINGS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: settings dictionaries',
  )
  ctx.effect(
    () => installDesktopSettingsStyles(),
    'dsh-plugin-desktop: settings styles',
  )
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'desktop',
    order: 100,
    label: () => t('nav'),
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({
      api,
      platform: environment.platform,
      initialMode: environment.mode,
      micaSupported: environment.micaSupported,
      setMode,
      desktopSettings,
      notificationSettings,
    }),
  }, DesktopSettingsSection))
  ctx.slots.inject('settings.action', () => ctx.slots.register({
    name: 'settings.action',
    id: 'open-desktop-terminal',
    order: 1,
    locale: DESKTOP_SETTINGS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, DesktopTerminalSettingsAction))

  return Object.freeze({
    api,
    setMode,
  })
}
