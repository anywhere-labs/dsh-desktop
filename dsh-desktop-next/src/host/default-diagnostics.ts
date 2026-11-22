/**
 * Standard-log summaries of turns and MCP servers, kept in bounded per-session and per-server state. Records carry
 * failure codes and the diagnostic text the official status already shows, never prompts, arguments or model output.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { McpManagedServerStatus } from '@deepseek-ai/dsh-mcp-manager'
import type { LogInput } from '../log-record.ts'
import type { HostHealth } from './health.ts'

/** Characters of an MCP server's last error kept in a record. */
const MCP_ERROR_CHARS = 1024

/** The final failure of a turn, as `turn/end` reports it. */
export interface TurnFailure { readonly code: string; readonly status?: number | undefined }

/** One record per turn that failed or needed failed model requests, instead of one per request. */
export class TurnDiagnostics {
  private readonly turns = new Map<string, { turn: number; failures: number; code?: string }>()
  constructor(private readonly record: (input: LogInput) => void, private readonly health: HostHealth) {}

  start(sessionId: string, turn: number): void {
    this.turns.set(sessionId, { turn, failures: 0 })
    this.health.activity(`session:${sessionId}`, true)
  }

  /** @returns Whether a turn of the session is running, so its model requests are summarized here. */
  active(sessionId: string): boolean { return this.turns.has(sessionId) }

  /** Count one failed model request of the running turn. */
  failure(sessionId: string, turn: number, code: string): void {
    const running = this.turns.get(sessionId)
    if (running?.turn === turn) { running.failures++; running.code = code }
  }

  end(sessionId: string, turn: number, outcome: string, failure?: TurnFailure): void {
    const running = this.turns.get(sessionId)
    // A late end of an earlier turn leaves the running one alone.
    if (running !== undefined && turn < running.turn) return
    this.remove(sessionId)
    const failures = running?.turn === turn ? running.failures : 0
    if (outcome !== 'error' && failures === 0) return
    const code = failure?.code ?? (running?.turn === turn ? running.code : undefined)
    this.record({ source: 'host.health', event: 'turn.summary', level: outcome === 'error' ? 'error' : 'warn',
      message: outcome === 'error' ? `Turn failed${code === undefined ? '' : `: ${code}`}` : `Turn ${outcome} after failed model requests`,
      fields: { sessionId, turn, outcome, modelFailures: failures, failureCode: code ?? null,
        ...(failure?.status === undefined ? {} : { failureStatus: failure.status }) } })
  }

  remove(sessionId: string): void { this.turns.delete(sessionId); this.health.activity(`session:${sessionId}`, false) }
  clear(): void { for (const id of [...this.turns.keys()]) this.remove(id) }
}

/**
 * Record an MCP server's first failure of an outage, the end of its automatic attempts and its recovery. The
 * manager publishes a status for every transition; retries within one outage add nothing.
 */
export function observeMcp(ctx: Context, record: (input: LogInput) => void): void {
  ctx.inject(['mcpManager'], child => {
    /** Servers in an outage, and whether their automatic attempts ended. */
    const outages = new Map<string, boolean>()
    const status = (server: string, value: McpManagedServerStatus): void => {
      const previous = outages.get(server)
      const emit = (event: string, level: 'info' | 'warn', message: string, fields: LogInput['fields']) => record({
        source: 'host.health', event: `mcp.${event}`, level, message: `MCP server ${server}: ${message}`,
        fields: { server, state: value.state, ...('reason' in value ? { reason: value.reason } : {}),
          ...('lastError' in value && typeof value.lastError === 'string' ? { lastError: value.lastError.slice(0, MCP_ERROR_CHARS) } : {}), ...fields } })
      if (value.state === 'connected') {
        if (previous !== undefined) emit('recovered', 'info', 'connected again', { toolCount: value.toolCount })
        outages.delete(server)
      } else if (value.state === 'closed' || value.state === 'disabled') outages.delete(server)
      else if (value.state === 'failed') {
        if (previous !== true) emit('gave-up', 'warn', 'no further connection attempts', {})
        outages.set(server, true)
      } else if (value.state === 'reconnecting' || value.state === 'waiting-credentials' || value.state === 'waiting-authorization') {
        // An OAuth server without a usable grant (dsh 0.2.3) waits for the user like one with a missing credential.
        const waiting = value.state === 'reconnecting' ? 'connection failed; retrying'
          : value.state === 'waiting-credentials' ? 'waiting for credentials' : `waiting for authorization (${value.reason})`
        if (previous === undefined) emit('failed', 'warn', waiting,
          value.state === 'reconnecting' ? { attempt: value.attempt, maxAttempts: value.maxAttempts } : {})
        outages.set(server, false)
      }
    }
    child.on('mcp-manager/status', status)
    // Servers that failed before this plugin mounted.
    for (const server of child.mcpManager.list()) status(server.name, server.status)
    const abort = new AbortController()
    child.effect(() => () => { abort.abort(); outages.clear() })
    // A removed server publishes no status; forget its outage so a server added later under its name starts clean.
    void (async () => {
      for await (const servers of child.mcpManager.watch(abort.signal)) {
        const names = new Set(servers.map(server => server.name))
        for (const name of outages.keys()) if (!names.has(name)) outages.delete(name)
      }
    })().catch(() => {})
  })
}
