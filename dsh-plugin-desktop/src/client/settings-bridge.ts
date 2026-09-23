/** Edition-local adapter over the browser configuration-form service. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Client service Desktop injects to reach the Host's configuration documents.
 * dsh 0.1.5-rc.2 names the settings binder service `settingsScope`; the Beta
 * channel's 0.1.7 core renamed it, so the injected name is
 * edition-local.
 */
export const DESKTOP_SETTINGS_FORMS_SERVICE = 'settingsScope'

/**
 * Host settings namespaces whose documents Desktop chrome edits. dsh
 * 0.1.5-rc.2 addresses a settings document by the namespace its owning plugin
 * registered, which is independent of that plugin's Loader entry id.
 */
export const DESKTOP_SHELL_SETTINGS_NAMESPACE = 'dsh-desktop'
export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'dsh-desktop-notifications'

/** One Host entry's accepted values and its serialized write queue. */
export type DesktopSettingsForm<T> = SettingsScope<T>

/**
 * Derive one Host entry's form on the calling plugin's lifecycle.
 * @param ctx - the Desktop client plugin context.
 * @param namespace - the Host settings namespace whose document is edited.
 * @returns the shared form consumed by Desktop's settings page and chrome.
 */
export function bindDesktopSettingsForm<T>(
  ctx: ClientContext,
  namespace: string,
): DesktopSettingsForm<T> {
  return ctx.settingsScope.bind<T>({ namespace })
}
