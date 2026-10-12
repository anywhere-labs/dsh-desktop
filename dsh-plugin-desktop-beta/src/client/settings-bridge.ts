/** Edition-local adapter over the browser configuration-form service. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'

/**
 * Client service Desktop injects to reach the Host's configuration documents.
 * dsh 0.1.7-alpha.1 renamed the settings binder service from `settingsScope`
 * to `configForms`, so the injected name is edition-local.
 */
export const DESKTOP_SETTINGS_FORMS_SERVICE = 'configForms'

/**
 * Host entry ids whose documents Desktop chrome edits. dsh 0.1.7-alpha.1
 * addresses a settings document by its Loader entry id rather than by a
 * separately registered namespace, so these are the ids Desktop's own entries
 * carry in the profile's `cordis.patch.yml`.
 */
export const DESKTOP_SHELL_SETTINGS_NAMESPACE = 'desktop-shell'
export const DESKTOP_NOTIFICATIONS_SETTINGS_NAMESPACE = 'desktop-notifications'

/** One Host entry's accepted values and its serialized write queue. */
export type DesktopSettingsForm<T> = ConfigForm<T>

/**
 * Derive one Host entry's form on the calling plugin's lifecycle.
 * @param ctx - the Desktop client plugin context.
 * @param namespace - the Host entry id whose document is edited.
 * @returns the shared form consumed by Desktop's settings page and chrome.
 */
export function bindDesktopSettingsForm<T>(
  ctx: ClientContext,
  namespace: string,
): DesktopSettingsForm<T> {
  return ctx.configForms.get<T>(namespace)
}
