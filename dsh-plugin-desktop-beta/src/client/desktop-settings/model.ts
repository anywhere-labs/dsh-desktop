/** Types of the Desktop settings page: the Host settings it edits, what its host injects, and its tabs. */

import type { ReactNode } from 'react'
import type { DesktopSettingsForm } from '../../../../dsh-plugin-desktop/src/client/settings-bridge.ts'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DesktopMarketProvider,
  DesktopSettingsApi,
} from '../../../../dsh-plugin-desktop/src/client/desktop-settings-api.ts'
import type { DesktopClientPlatform } from '../../../../dsh-plugin-desktop/src/client/environment.ts'

/** Browser view of the Host `dsh-desktop` settings namespace. */
export interface DesktopShellSettings {
  readonly mode: 'compatibility' | 'extended' | 'advanced'
  readonly macosMaterial: 'off' | 'transparent'
  readonly linuxMaterial: 'off' | 'transparent'
  /** Legacy Windows value; Windows has no selectable material and renders opaque. */
  readonly windowsMaterial: 'off' | 'acrylic' | 'mica'
  readonly port: number
  readonly openBrowser: boolean
  readonly networkExposure: 'loopback' | 'lan'
  readonly developerLogging?: boolean
  readonly sidebarFooterCompat?: boolean
  readonly sidebarFooterBalanced?: boolean
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
}

/** Browser view of the Host `dsh-desktop-notifications` settings namespace. */
export interface DesktopNotificationSettings {
  readonly enabled: boolean
  readonly notifyOnTurnCompletion: boolean
  readonly notifyOnTurnFailure: boolean
  readonly notifyOnJobCompletion: boolean
  readonly notifyOnJobFailure: boolean
  readonly notifyOnScheduleCompletion: boolean
  readonly notifyOnScheduleFailure: boolean
}

/** Registration-side business face for the Desktop settings section. */
export interface DesktopSettingsSectionInjected {
  readonly api: DesktopSettingsApi
  readonly platform: DesktopClientPlatform
  /** Installed Desktop product version rendered by the update section. */
  readonly version: string
  readonly initialMode: DesktopShellSettings['mode']
  readonly setMode: (mode: DesktopShellSettings['mode']) => Promise<void>
  readonly desktopSettings: Pick<DesktopSettingsForm<DesktopShellSettings>, 'getSnapshot' | 'subscribe' | 'set'>
  readonly notificationSettings: Pick<DesktopSettingsForm<DesktopNotificationSettings>, 'getSnapshot' | 'subscribe' | 'set'>
  /** Hosts can omit unsupported features while sharing the existing page. */
  readonly capabilities?: {
    readonly pluginSelectors?: boolean
    readonly windowModes?: boolean
    readonly featuresReadOnly?: boolean
    readonly markets?: readonly DesktopMarketProvider[]
    readonly materialRequiresRestart?: boolean
    readonly nativeLanConfirmation?: boolean
    readonly jobNotifications?: boolean
    readonly updates?: boolean
    readonly logging?: boolean
  }
  readonly browserActions?: ReactNode
  /** Rows the host adds at the top of the window appearance group. */
  readonly presentationRows?: ReactNode
  /** Groups the host adds to each tab, after the tab's own groups. */
  readonly tabSections?: Partial<Readonly<Record<DesktopSettingsTab, ReactNode>>>
}

/** One tab of the Desktop settings page. */
export type DesktopSettingsTab = 'general' | 'profiles' | 'access' | 'diagnostics'

/** Renderer-composed props for the official settings section entry. */
export type DesktopSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopSettingsSectionInjected>

export type Translate = DesktopSettingsSectionProps['t']
export type BusyOperation = 'load' | 'create-profile' | 'select-profile' | 'delete-profile' | 'select-aa' | 'select-market' | 'mode' | 'material' | 'web' | 'notification' | 'logging'
export type RestartState = 'none' | 'restarting' | 'required'
