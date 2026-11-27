/**
 * One ACP connection: the agent side of the Agent Client Protocol v1, served
 * on whatever stream the RPC layer hands in. DSH sessions are shared, so a
 * connection follows sessions rather than owning them.
 */

import { agent as acpAgent, methods, PROTOCOL_VERSION, RequestError, type AgentConnection, type ClientCapabilities, type ContentBlock as AcpContent,
  type InitializeRequest, type InitializeResponse, type ListSessionsResponse, type SessionInfo, type SessionUpdate, type Stream } from '@agentclientprotocol/sdk'
import { randomUUID } from 'node:crypto'
import type { ConnectionDetails } from '../management-contract.js'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'
import { PromptError, record, type Fields } from './convert.js'
import { HostError, hostMessage, type DshHost } from './host.js'
import type { InteractionHub } from './interactions.js'
import type { Log } from './log.js'
import { McpConfigError, mcpModules, McpStartError, resolveDeclarations, type McpDeclaration } from './mcp.js'
import { AcpSession, type AcpClient } from './session.js'
import { parseSessionTitle, SET_SESSION_TITLE } from './title.js'

const LIST_PAGE = 100

export interface BridgeIdentity { version: string }

function toRequestError(error: unknown): RequestError {
  if (error instanceof RequestError) return error
  if (error instanceof PromptError || error instanceof McpConfigError) return RequestError.invalidParams(undefined, error.message)
  if (error instanceof McpStartError) return RequestError.internalError(undefined, error.message)
  if (error instanceof HostError) return error.invalid ? RequestError.invalidParams(undefined, error.message) : RequestError.internalError(undefined, error.message)
  return RequestError.internalError(undefined, hostMessage(error))
}

async function directory(cwd: unknown): Promise<string> {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw RequestError.invalidParams(undefined, 'cwd 必须是绝对路径。')
  try {
    const path = await realpath(cwd)
    if ((await stat(path)).isDirectory()) return path
  } catch { /* reported below */ }
  throw RequestError.invalidParams(undefined, `工作目录不存在或不是目录：${cwd}`)
}

function encodeCursor(offset: number): string { return Buffer.from(JSON.stringify({ offset })).toString('base64url') }

/**
 * `_session/steering` parameters: the steering extension of the Codex and Claude ACP agents, which clients
 * such as Agents Anywhere find through `_meta.steering.supported` in `initialize`. `_meta.steering.idleBehavior`
 * needs no reading: an idle session always answers `promptRequired`.
 */
function steeringParams(raw: unknown): { sessionId: string, prompt: AcpContent[] } {
  const params = record(raw)
  if (typeof params.sessionId !== 'string' || !Array.isArray(params.prompt)) {
    throw RequestError.invalidParams(undefined, '插话需要 sessionId 和 prompt。')
  }
  return { sessionId: params.sessionId, prompt: params.prompt as AcpContent[] }
}

/** A directory as the file system names it: links resolved, and case folded where Windows ignores it. */
async function canonical(path: string): Promise<string> {
  const real = await realpath(path).catch(() => resolve(path))
  return process.platform === 'win32' ? real.toLowerCase() : real
}
function decodeCursor(cursor: unknown): number {
  if (cursor === undefined || cursor === null) return 0
  try {
    const offset = record(JSON.parse(Buffer.from(String(cursor), 'base64url').toString('utf8'))).offset
    if (typeof offset === 'number' && Number.isSafeInteger(offset) && offset >= 0) return offset
  } catch { /* reported below */ }
  throw RequestError.invalidParams(undefined, '无效的分页游标。')
}

export class AcpConnection implements AcpClient {
  private readonly id = randomUUID()
  private readonly connectedAt = new Date().toISOString()
  private clientInfo: ConnectionDetails['client']
  private initialized = false
  private readonly titles = new Map<string, string>()
  private readonly sessions = new Map<string, AcpSession>()
  private capabilities: ClientCapabilities = {}
  private connection: AgentConnection | undefined
  private closing: Promise<void> | undefined
  private mcpWarned = false

  constructor(private readonly host: DshHost, private readonly hub: InteractionHub, private readonly log: Log,
    private readonly identity: BridgeIdentity, private readonly changed: () => void = () => {}) {}

  details(): ConnectionDetails {
    return { id: this.id, connectedAt: this.connectedAt, initialized: this.initialized,
      ...(this.clientInfo ? { client: this.clientInfo } : {}),
      sessions: [...this.sessions.values()].filter(session => !session.closed).map(session => ({
        id: session.id, cwd: session.workingDirectory,
        ...(this.titles.has(session.id) ? { title: this.titles.get(session.id)! } : {}),
      })) }
  }

  get elicitation(): boolean { return Boolean(this.capabilities.elicitation?.form) }
  sessionsChanged(): void { this.changed() }
  get booleanOptions(): boolean { return Boolean(record(record(record(this.capabilities).session).configOptions).boolean) }

  /** Serve until the stream ends; every session this connection followed is released afterwards. */
  async serve(stream: Stream): Promise<void> {
    const guard = <T>(operation: () => Promise<T>) => operation().catch((error: unknown) => { throw toRequestError(error) })
    const app = acpAgent({ name: 'agents-anywhere-dsh-acp' })
      .onRequest(methods.agent.initialize, ({ params }) => guard(async () => this.initialize(params.clientCapabilities, params.clientInfo)))
      .onRequest(methods.agent.authenticate, async () => ({}))
      .onRequest(methods.agent.session.new, ({ params }) => guard(() => this.newSession(params.cwd, params.mcpServers)))
      .onRequest(methods.agent.session.load, ({ params }) => guard(async () => ({ configOptions: await this.open(params.sessionId, params.cwd, params.mcpServers, true) })))
      .onRequest(methods.agent.session.resume, ({ params }) => guard(async () => ({ configOptions: await this.open(params.sessionId, params.cwd, params.mcpServers, false) })))
      .onRequest(methods.agent.session.list, ({ params, signal }) => guard(() => this.list(params.cwd, params.cursor, signal)))
      .onRequest(SET_SESSION_TITLE, parseSessionTitle, ({ params, signal }) => guard(() => this.setTitle(params.sessionId, params.title, signal)))
      .onRequest(methods.agent.session.close, ({ params }) => guard(async () => { await this.closeSession(params.sessionId); return {} }))
      .onRequest(methods.agent.session.delete, ({ params }) => guard(async () => { await this.deleteSession(params.sessionId); return {} }))
      .onRequest(methods.agent.session.fork, ({ params }) => guard(() => this.fork(params.sessionId, params.cwd, params.mcpServers)))
      .onRequest(methods.agent.session.setConfigOption, ({ params }) => guard(async () => ({
        configOptions: await this.session(params.sessionId).setConfig(params.configId, (params as Fields).value) })))
      .onRequest(methods.agent.session.prompt, ({ params, signal }) => guard(() => this.session(params.sessionId).prompt(params.prompt, signal)))
      .onRequest('_session/steering', steeringParams, ({ params }) => guard(() => this.session(params.sessionId).steer(params.prompt)))
      .onNotification(methods.agent.session.cancel, ({ params }) => {
        void this.sessions.get(params.sessionId)?.cancel().catch(error => this.log.warn('acp-bridge: cancel failed', error))
      })
    const connection = app.connect(stream)
    this.connection = connection
    try { await connection.closed } catch (error) { this.log.debug('acp-bridge: ACP connection closed with an error', error) }
    await this.close()
  }

  private async initialize(capabilities: ClientCapabilities | undefined, clientInfo: InitializeRequest['clientInfo']): Promise<InitializeResponse> {
    this.capabilities = capabilities ?? {}
    // Stdio servers are always accepted where DSH's MCP client is installed; SSE is deprecated, as in the official dsh-acp.
    const [mcp, image] = await Promise.all([mcpModules(), this.host.imagesAdvertised()])
    this.clientInfo = clientInfo ? { name: clientInfo.name, version: clientInfo.version,
      ...(clientInfo.title ? { title: clientInfo.title } : {}) } : undefined
    this.initialized = true
    this.changed()
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: { name: 'agents-anywhere-dsh', title: 'DeepSeek Harness', version: this.identity.version },
      agentCapabilities: {
        loadSession: true,
        promptCapabilities: { image, audio: false, embeddedContext: true },
        mcpCapabilities: { http: mcp !== undefined, sse: false },
        sessionCapabilities: { list: {}, resume: {}, close: {}, delete: {}, fork: {}, ...(this.host.canRename ? { title: {} } : {}) },
        // Prompts sent while a turn runs wait in the DSH queue. Not in the ACP schema: this is the
        // flag clients read to allow sending mid-turn, first advertised by claude-agent-acp.
        _meta: { claudeCode: { promptQueueing: true } },
      },
      authMethods: [],
      // `_session/steering` adds input to the running turn; found in the top-level `_meta`, as with Codex and Claude.
      _meta: { steering: { supported: true } },
    }
  }

  /**
   * The client's MCP servers for a session in `cwd`, checked before DSH creates or opens anything.
   * Without DSH's MCP client beside the plugin they cannot be mounted and are left out.
   */
  private async declarations(servers: unknown, cwd: string): Promise<McpDeclaration[]> {
    if (!Array.isArray(servers) || !servers.length) return []
    const modules = await mcpModules()
    if (modules) return resolveDeclarations(modules.client, servers, cwd)
    if (!this.mcpWarned) {
      this.mcpWarned = true
      this.log.info(`acp-bridge: ignoring ${servers.length} MCP server(s) declared by the ACP client: @deepseek-ai/dsh-mcp-client is not installed beside the plugin`)
    }
    return []
  }

  private ensureOpen(): void {
    if (this.closing) throw RequestError.internalError(undefined, 'ACP 连接已关闭。')
  }

  private async newSession(cwd: unknown, mcpServers: unknown) {
    const path = await directory(cwd)
    const mcp = await this.declarations(mcpServers, path)
    const catalog = await this.host.catalog()
    this.ensureOpen()
    const permission = this.host.defaultPermission()
    const preset = this.host.defaultPreset()
    const session = AcpSession.create(this.host, this.hub, this, this.log, { cwd: path, mcp,
      ...(catalog?.default ? { model: catalog.default } : {}), ...(permission ? { permission } : {}), ...(preset ? { preset } : {}) })
    this.sessions.set(session.id, session)
    this.changed()
    return { sessionId: session.id, configOptions: await session.configOptions() }
  }

  /**
   * The session is registered before it starts following, so a closing
   * connection or `session/close` reaches it; loading the same session again
   * closes the earlier view, including one still opening. The client's MCP
   * servers are mounted before the response.
   */
  private async open(sessionId: string, cwd: unknown, mcpServers: unknown, replay: boolean, declared?: McpDeclaration[]) {
    const path = await directory(cwd)
    const mcp = declared ?? await this.declarations(mcpServers, path)
    await this.closeSession(sessionId)
    this.ensureOpen()
    const session = AcpSession.existing(this.host, this.hub, this, this.log, sessionId, path, mcp)
    this.sessions.set(sessionId, session)
    this.changed()
    try {
      await session.open(replay)
    } catch (error) {
      if (this.sessions.get(sessionId) === session) { this.sessions.delete(sessionId); this.titles.delete(sessionId) }
      this.changed()
      await session.close()
      throw error
    }
    return session.configOptions()
  }

  private session(id: string): AcpSession {
    const session = this.sessions.get(id)
    if (!session || session.closed) throw RequestError.invalidParams(undefined, `未知的会话：${id}`)
    return session
  }

  private async setTitle(id: string, title: string, signal: AbortSignal): Promise<{ title: string }> {
    this.ensureOpen()
    if (!this.host.canRename) throw RequestError.methodNotFound(SET_SESSION_TITLE)
    const session = this.sessions.get(id)
    try {
      if (session && !session.closed) await session.prepareTitle()
      else {
        // The draft permits retitling a listed session without loading it on this connection.
        const { items } = await this.host.controller.list({}, signal)
        if (!items.some(item => item.sessionId === id && this.listable(item))) throw RequestError.resourceNotFound(id)
      }
      this.ensureOpen()
      signal.throwIfAborted()
      return { title: await this.host.rename(id, title) }
    } catch (error) {
      const code = record(error).code
      if (code === 'session/title-invalid') throw RequestError.invalidParams(undefined, hostMessage(error))
      if (code === 'session/not-found' || code === 'gateway/not-found') throw RequestError.resourceNotFound(id)
      throw error
    }
  }

  private listable(item: SessionSummary): boolean {
    return item.origin !== 'subagent' && item.parentSessionId === undefined && !item.blank
      && typeof item.cwd === 'string' && !this.host.workspaces.archivedSessionIds.includes(item.sessionId)
  }

  private async closeSession(id: string): Promise<void> {
    const session = this.sessions.get(id)
    this.sessions.delete(id)
    this.titles.delete(id)
    if (session) this.changed()
    await session?.close()
  }

  /**
   * `session/delete`: archive the session in DSH, where it can be restored. The
   * prompts this connection started are cancelled first; a turn someone else
   * runs is not this client's to stop, so the session is left alone then.
   */
  private async deleteSession(id: string): Promise<void> {
    const ours = this.sessions.get(id)?.busy ?? false
    await this.closeSession(id)
    if (this.host.workspaces.archivedSessionIds.includes(id as SessionId)) return
    if (ours) await this.host.idle(id, 5_000)
    try {
      await this.host.workspaces.archiveSession(id as SessionId)
    } catch (error) {
      if (Array.isArray(record(error).activity)) throw RequestError.invalidParams(undefined, '这个会话在 DSH 里还有任务在运行，请等它结束或在 DSH 里停止后再删除。')
      const code = record(error).code
      if (code === 'session/not-found' || /not found|does not exist/iu.test(hostMessage(error))) throw RequestError.invalidParams(undefined, 'DSH 中没有这个会话。')
      throw error
    }
  }

  /** `session/fork`: DSH copies the session's history up to its last finished turn; the copy is followed like `session/resume`. */
  private async fork(sessionId: string, cwd: unknown, mcpServers: unknown) {
    const path = await directory(cwd)
    // Checked first, so a declaration the client has to fix leaves no copy behind.
    const mcp = await this.declarations(mcpServers, path)
    let forked: string
    try {
      forked = (await this.host.controller.fork({ sessionId: sessionId as SessionId })).sessionId
    } catch (error) {
      const code = record(error).code
      if (code === 'session/not-found' || code === 'gateway/not-found') throw RequestError.invalidParams(undefined, 'DSH 中没有这个会话。')
      throw new HostError(`DSH 无法复制这个会话：${hostMessage(error)}`)
    }
    this.ensureOpen()
    return { sessionId: forked, configOptions: await this.open(forked, path, undefined, false, mcp) }
  }

  /** DSH's own session list: top-level, non-archived conversations, newest first. */
  private async list(cwd: unknown, cursor: unknown, signal: AbortSignal): Promise<ListSessionsResponse> {
    let filter: string | undefined
    if (cwd !== undefined && cwd !== null) {
      if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw RequestError.invalidParams(undefined, 'cwd 必须是绝对路径。')
      filter = await canonical(cwd)
    }
    const offset = decodeCursor(cursor)
    const { items } = await this.host.controller.list({}, signal)
    const candidates = items.filter(item => this.listable(item))
    // DSH keeps each session's directory as it was opened, links and all: compare both sides resolved.
    const resolved = new Map<string, Promise<string>>()
    const directoryOf = (path: string) => {
      let value = resolved.get(path)
      if (!value) resolved.set(path, value = canonical(path))
      return value
    }
    const matched = filter === undefined ? candidates
      : (await Promise.all(candidates.map(async item => await directoryOf(item.cwd!) === filter ? item : undefined)))
        .filter((item): item is SessionSummary => item !== undefined)
    const rows = matched.sort((a: SessionSummary, b: SessionSummary) => b.updatedAt - a.updatedAt)
    const page = rows.slice(offset, offset + LIST_PAGE)
    const sessions: SessionInfo[] = page.map((item: SessionSummary) => {
      const title = item.projections?.values.title
      return { sessionId: item.sessionId, cwd: item.cwd!, updatedAt: new Date(item.updatedAt).toISOString(),
        ...(typeof title === 'string' && title ? { title } : {}) }
    })
    return { sessions, ...(offset + LIST_PAGE < rows.length ? { nextCursor: encodeCursor(offset + LIST_PAGE) } : {}) }
  }

  // ── AcpClient: calls back into the client ──────────────────────────────

  async update(sessionId: string, update: SessionUpdate): Promise<void> {
    if (this.sessions.has(sessionId) && update.sessionUpdate === 'session_info_update'
      && typeof update.title === 'string' && this.titles.get(sessionId) !== update.title) {
      this.titles.set(sessionId, update.title)
      this.changed()
    }
    if (!this.connection) return
    await this.connection.client.notify(methods.client.session.update, { sessionId, update })
  }

  async requestPermission(params: Fields, signal: AbortSignal): Promise<Fields> {
    if (!this.connection) throw new Error('ACP connection is closed')
    return record(await this.connection.client.request(methods.client.session.requestPermission, params as never, { cancellationSignal: signal }))
  }

  async elicit(params: Fields, signal: AbortSignal): Promise<Fields> {
    if (!this.connection) throw new Error('ACP connection is closed')
    return record(await this.connection.client.request(methods.client.elicitation.create, params as never, { cancellationSignal: signal }))
  }

  /** A client that stops reading would make DSH buffer its updates without limit. */
  overloaded(): void {
    void this.close().catch(error => this.log.debug('acp-bridge: closing an overloaded connection failed', error))
  }

  /** DSH changed its command registry: refresh every followed session's slash menu. */
  refreshCommands(): void {
    for (const session of this.sessions.values()) session.refreshCommands()
  }

  /** Release every followed session; a prompt this client started is cancelled, as ACP requires on disconnect. */
  close(): Promise<void> {
    return this.closing ??= (async () => {
      const sessions = [...this.sessions.values()]
      this.sessions.clear()
      this.titles.clear()
      this.changed()
      await Promise.allSettled(sessions.map(session => session.close()))
      this.connection?.close()
    })()
  }
}
