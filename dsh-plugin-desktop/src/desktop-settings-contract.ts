/** Private same-origin Desktop settings API shared with the bundled renderer. */

import type { DesktopMarketProvider } from './desktop-market.ts'

/** Read the current Desktop-owned settings state. */
export const DESKTOP_SETTINGS_PATH = '/api/desktop/settings'

/** Create one safe Web profile without selecting it. */
export const DESKTOP_PROFILE_CREATE_PATH = '/api/desktop/profiles/create'

/** Select one compatible profile for the next Desktop generation. */
export const DESKTOP_PROFILE_SELECT_PATH = '/api/desktop/profiles/select'

/** Delete one inactive, user-created Web Profile. */
export const DESKTOP_PROFILE_DELETE_PATH = '/api/desktop/profiles/delete'

/** Persist the Market provider selected for the next Desktop generation. */
export const DESKTOP_MARKET_SELECT_PATH = '/api/desktop/market/select'

/** Open the launcher-owned DSH terminal without accepting command text. */
export const DESKTOP_TERMINAL_OPEN_PATH = '/api/desktop/terminal/open'

/** Queue an orderly Desktop relaunch after acknowledging the renderer. */
export const DESKTOP_RESTART_PATH = '/api/desktop/restart'

/** Queue an orderly relaunch that opens the recovery assistant before Host boot. */
export const DESKTOP_RECOVERY_RESTART_PATH = '/api/desktop/restart/recovery'

/** Reload the renderer through the launcher without exposing Electron APIs. */
export const DESKTOP_RENDERER_RELOAD_PATH = '/api/desktop/developer/reload'

/** Toggle the mounted window's Developer Tools through the launcher. */
export const DESKTOP_DEVELOPER_TOOLS_TOGGLE_PATH = '/api/desktop/developer/devtools'

/** Run the generation-owned manual update check. */
export const DESKTOP_UPDATE_CHECK_PATH = '/api/desktop/updates/check'

/** Export one local diagnostic archive through the launcher-owned flow. */
export const DESKTOP_DIAGNOSTICS_EXPORT_PATH = '/api/desktop/diagnostics/export'

/** Open the isolated native Profile creator without accepting a path. */
export const DESKTOP_PROFILE_CREATE_WINDOW_PATH = '/api/desktop/profiles/create-window'

/** Renderer-safe projection of one discovered profile. */
export interface DesktopSettingsProfileView {
  /** Profile name accepted by the launcher. */
  readonly name: string
  /** Whether its manifest already exists on disk. */
  readonly exists: boolean
  /** Whether it contains the Web application required by Desktop. */
  readonly webCapable: boolean
  /** Whether the launcher can select it. */
  readonly selectable: boolean
  /** Whether the profile can be removed without affecting recovery state. */
  readonly deletable: boolean
}

/** Requested and generation-effective Market provider state. */
export interface DesktopSettingsMarketView {
  /** Explicit or fail-safe provider requested on disk. */
  readonly requested: DesktopMarketProvider
  /** Provider composed into the currently running generation. */
  readonly effective: DesktopMarketProvider
  /** Whether an absent or invalid legacy state produced the fail-safe default. */
  readonly legacyDefaulted: boolean
}

/** Marker-free ordinary-browser URLs for the running Web generation. */
export interface DesktopSettingsWebView {
  /** Always-available loopback URL using the actual listening port. */
  readonly localUrl: string
  /** Startup-sampled LAN URLs; empty while the generation is loopback-only. */
  readonly lanUrls: readonly string[]
}

/** Complete renderer-safe Desktop settings state. */
export interface DesktopSettingsResponse {
  /** Profile backing the currently running generation. */
  readonly current: string
  /** Fresh profile discovery without filesystem paths or manifest details. */
  readonly profiles: readonly DesktopSettingsProfileView[]
  /** Market choice for the current and next generation. */
  readonly market: DesktopSettingsMarketView
  /** Actual browser URLs for the current WebServer generation. */
  readonly web: DesktopSettingsWebView
}

/** Exact body accepted by the profile-creation endpoint. */
export interface DesktopProfileCreateRequest {
  readonly name: string
}

/** Successful creation returns a fresh state that includes the new profile. */
export type DesktopProfileCreateResponse = DesktopSettingsResponse

/** Exact body accepted by the profile-selection endpoint. */
export interface DesktopProfileSelectRequest {
  readonly name: string
}

/** Successful persisted selection returned before the Host restarts. */
export interface DesktopRestartAcceptance {
  readonly accepted: true
  readonly restartRequired: boolean
}

/** Successful profile selection handoff. */
export type DesktopProfileSelectResponse = DesktopRestartAcceptance

/** Exact body accepted by the profile-deletion endpoint. */
export interface DesktopProfileDeleteRequest {
  readonly name: string
}

/** Successful deletion returns a fresh state without the removed profile. */
export type DesktopProfileDeleteResponse = DesktopSettingsResponse

/** Exact body accepted by the Market-provider endpoint. */
export interface DesktopMarketSelectRequest {
  readonly provider: DesktopMarketProvider
}

/** Successful Market selection handoff. */
export type DesktopMarketSelectResponse = DesktopRestartAcceptance

/** Exact empty body accepted by the terminal endpoint. */
export type DesktopTerminalOpenRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned terminal action. */
export interface DesktopTerminalOpenResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the explicit restart endpoint. */
export type DesktopRestartRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher's orderly relaunch flow. */
export interface DesktopRestartResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the recovery-restart endpoint. */
export type DesktopRecoveryRestartRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher's recovery relaunch flow. */
export type DesktopRecoveryRestartResponse = DesktopRestartResponse

/** Exact empty body accepted by the renderer-reload endpoint. */
export type DesktopRendererReloadRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned renderer reload. */
export interface DesktopRendererReloadResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the Developer Tools endpoint. */
export type DesktopDeveloperToolsToggleRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned Developer Tools action. */
export interface DesktopDeveloperToolsToggleResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the manual update-check endpoint. */
export type DesktopUpdateCheckRequest = Readonly<Record<string, never>>

/** Successful completion of the interactive update-check flow. */
export interface DesktopUpdateCheckResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the diagnostic-export endpoint. */
export type DesktopDiagnosticsExportRequest = Readonly<Record<string, never>>

/** Successful handoff to the launcher-owned diagnostic export flow. */
export interface DesktopDiagnosticsExportResponse {
  readonly accepted: true
}

/** Exact empty body accepted by the native Profile-creator endpoint. */
export type DesktopProfileCreateWindowRequest = Readonly<Record<string, never>>

/** Successful handoff to the isolated native Profile creator. */
export interface DesktopProfileCreateWindowResponse {
  readonly accepted: true
}

/** Stable API failure shape that never contains native paths or raw causes. */
export interface DesktopSettingsErrorResponse {
  readonly error: string
}
