/** JSON-only contract shared by the panel and Host. No endpoint tokens or credentials. */
export const MANAGEMENT_PATH = '/api/agents-anywhere/acp'
export const CONNECTIONS_PATH = `${MANAGEMENT_PATH}/connections`
export interface ConnectionDetails {
  id: string
  connectedAt: string
  initialized: boolean
  client?: { name: string; title?: string; version: string }
  sessions: { id: string; cwd: string; title?: string }[]
}
export interface ConnectionState {
  instanceId: string
  revision: number
  ready: boolean
  connections: number
  sessions: number
  clients: ConnectionDetails[]
}
export interface StartupSettings {
  enabled: boolean
  defaultApp?: string
  applications?: Record<string, { mode: 'desktop' | 'cli'; profile: string; dshHome: string }>
  mode: 'desktop' | 'cli'
  timeoutSeconds: number
  profile: string
}
export const DEFAULT_STARTUP: StartupSettings = { enabled: true, mode: 'desktop', timeoutSeconds: 90, profile: '' }
export interface ProfileCheck { name: string; valid: boolean; reason: string }
export interface ManagementState {
  applications?: import('./applications.js').Application[]
  defaultApp?: string
  live: ConnectionState
  ready: boolean
  connections: number
  sessions: number
  bridgeVersion: string
  runtimeVersion?: string
  profile: string
  host: string
  launcher: string
  settings: StartupSettings
  desktopAvailable: boolean
  cliAvailable: boolean
  profiles: ProfileCheck[]
  checks: { label: string; ok: boolean; detail: string }[]
  lastStart?: { at: string; ok: boolean; message: string }
}
