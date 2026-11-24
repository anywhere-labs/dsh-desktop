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
export interface ManagementState {
  live: ConnectionState
  ready: boolean
  connections: number
  sessions: number
  bridgeVersion: string
  runtimeVersion?: string
  profile: string
  host: string
  launcher: string
  checks: { label: string; ok: boolean; detail: string }[]
}
