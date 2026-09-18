/** Settings-header actions backed by the Desktop launcher. */

import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import { DesktopNativeActions } from './DesktopNativeActions.tsx'

/** Registration-side capabilities for native Desktop actions. */
export interface DesktopTerminalSettingsActionInjected {
  readonly api: Pick<
    DesktopSettingsApi,
    'openTerminal' | 'restart' | 'restartToRecovery' | 'reloadRenderer' | 'toggleDeveloperTools'
  >
}

/** Renderer-composed terminal action props. */
export type DesktopTerminalSettingsActionProps =
  PropsRuntime<'settings.action'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopTerminalSettingsActionInjected>

/** Open DSH Terminal or restart without exposing launcher details to the renderer. */
export function DesktopTerminalSettingsAction({ api, t }: DesktopTerminalSettingsActionProps) {
  return <DesktopNativeActions api={api} t={t} placement="settings" />
}
