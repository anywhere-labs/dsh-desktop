/**
 * MCP servers an ACP client declares for a session, mounted the way the official dsh-acp does:
 * each declaration becomes one DSH `mcp-client` in the session Agent's scope, so its tools are
 * that Agent's alone and leave with it. DSH sessions are shared: a server stays mounted while a
 * client that declared it follows the session, and clients declaring the same server share one
 * connection.
 *
 * The plugin may run its own copy of `mcp-client` and `dsh-scope`, installed beside it rather
 * than DSH's. Each server therefore mounts in a scope created under `agent.ctx` and keyed by the
 * Agent, as DSH's own per-Agent features do (CUA, the built-in browser): DSH still sees the Agent
 * scope the new one inherits, and `mcp-client` keeps server names apart per Agent.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-tools'
import { createHash } from 'node:crypto'
import { validateHeaderName, validateHeaderValue } from 'node:http'
import { isAbsolute } from 'node:path'

type McpClientModule = typeof import('@deepseek-ai/dsh-mcp-client')
type ScopeModule = typeof import('@deepseek-ai/dsh-scope')
type McpClientConfig = import('@deepseek-ai/dsh-mcp-client').Config

export interface McpModules { client: McpClientModule, scope: ScopeModule }

let modules: Promise<McpModules | undefined> | undefined

/** DSH's MCP client and scope packages; undefined where they are not installed, and client MCP servers are then not supported. */
export function mcpModules(): Promise<McpModules | undefined> {
  return modules ??= Promise.all([import('@deepseek-ai/dsh-mcp-client'), import('@deepseek-ai/dsh-scope')])
    .then(([client, scope]) => ({ client, scope }), () => undefined)
}

/** A declaration the client can correct; answered as invalid params. */
export class McpConfigError extends Error {
  constructor(message: string) { super(message); this.name = 'McpConfigError' }
}

/** A declared server that did not start; the message names it. */
export class McpStartError extends Error {
  constructor(message: string) { super(message); this.name = 'McpStartError' }
}

export interface McpDeclaration {
  /** The server's tool namespace: its tools are `mcp__<name>__<tool>`. */
  readonly name: string
  readonly config: McpClientConfig
  /** Equal for declarations of the same server, whatever the order of their entries. */
  readonly fingerprint: string
}

/** DSH tool namespaces; other names are mapped the way the official dsh-acp maps them. */
const VALID_NAME = /^[A-Za-z0-9_-]{1,32}$/u

type Entry = { name: string, value: string }

function serverName(value: unknown, index: number): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u001f\u007f]/u.test(value)) throw new McpConfigError(`mcpServers[${index}] 的名称无效。`)
  if (VALID_NAME.test(value)) return value
  const slug = value.normalize('NFKD').replace(/[^A-Za-z0-9_-]+/gu, '_').replace(/^_+|_+$/gu, '').slice(0, 20) || 'server'
  return `${slug}_${createHash('sha256').update(value).digest('hex').slice(0, 8)}`.slice(0, 32)
}

function entries(value: unknown, field: string): Entry[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw new McpConfigError(`${field} 必须是列表。`)
  return value.map((item: unknown, index) => {
    const entry = item as Partial<Entry> | null
    if (!entry || typeof entry.name !== 'string' || typeof entry.value !== 'string') throw new McpConfigError(`${field}[${index}] 必须有 name 和 value。`)
    return { name: entry.name, value: entry.value }
  })
}

/**
 * Ordered name/value entries as a record. A null prototype keeps a legal `__proto__` entry as
 * data; duplicates are refused rather than one silently winning (header names case-insensitively).
 */
function toRecord(list: readonly Entry[], field: string, kind: 'env' | 'header'): Record<string, string> {
  const label = kind === 'header' ? '请求头' : '环境变量'
  const result = Object.create(null) as Record<string, string>
  const seen = new Set<string>()
  for (const entry of list) {
    if (kind === 'header') {
      try {
        validateHeaderName(entry.name)
        validateHeaderValue(entry.name, entry.value)
      } catch {
        throw new McpConfigError(`${field} 里有无效的${label}：${entry.name}`)
      }
    } else if (!entry.name || entry.name.includes('=') || entry.name.includes('\0') || entry.value.includes('\0')) {
      throw new McpConfigError(`${field} 里有无效的${label}：${entry.name}`)
    }
    const identity = kind === 'header' ? entry.name.toLowerCase() : entry.name
    if (seen.has(identity)) throw new McpConfigError(`${field} 里有重复的${label}：${entry.name}`)
    seen.add(identity)
    result[entry.name] = entry.value
  }
  return result
}

function httpUrl(value: unknown, index: number): string {
  try {
    const url = new URL(String(value))
    if (url.protocol === 'http:' || url.protocol === 'https:') return String(value)
  } catch { /* reported below */ }
  throw new McpConfigError(`mcpServers[${index}].url 必须是完整的 HTTP(S) 地址。`)
}

function sorted(list: readonly Entry[], fold = false): [string, string][] {
  return list.map(entry => [fold ? entry.name.toLowerCase() : entry.name, entry.value] as [string, string]).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
}

/**
 * Check and convert the client's declarations before anything starts, by the official dsh-acp's
 * rules: the stable stdio and HTTP transports, absolute commands, unique normalized names, valid
 * environment variables and headers. Stdio servers run in the session's directory, and every
 * server has to start: one that does not fails the request that mounts it.
 */
export function resolveDeclarations(client: McpClientModule, servers: readonly unknown[], cwd: string): McpDeclaration[] {
  const names = new Set<string>()
  return servers.map((value, index) => {
    if (!value || typeof value !== 'object') throw new McpConfigError(`mcpServers[${index}] 不是 MCP 服务器声明。`)
    const server = value as Record<string, unknown>
    const name = serverName(server.name, index)
    if (names.has(name)) throw new McpConfigError(`mcpServers 里有重名的服务器：${name}`)
    names.add(name)
    let input: Record<string, unknown>
    let identity: unknown
    let records: { env: Record<string, string> } | { headers: Record<string, string> }
    if (server.type === undefined || server.type === 'stdio') {
      if (typeof server.command !== 'string' || !isAbsolute(server.command)) throw new McpConfigError(`mcpServers[${index}].command 必须是绝对路径。`)
      const args = server.args ?? []
      if (!Array.isArray(args) || args.some(arg => typeof arg !== 'string')) throw new McpConfigError(`mcpServers[${index}].args 必须是字符串列表。`)
      const list = entries(server.env, `mcpServers[${index}].env`)
      records = { env: toRecord(list, `mcpServers[${index}].env`, 'env') }
      input = { transport: 'stdio', serverName: name, command: server.command, args, ...records, cwd, failOnStartupError: true }
      identity = ['stdio', server.command, args, sorted(list), cwd]
    } else if (server.type === 'http') {
      const url = httpUrl(server.url, index)
      const list = entries(server.headers, `mcpServers[${index}].headers`)
      records = { headers: toRecord(list, `mcpServers[${index}].headers`, 'header') }
      input = { transport: 'streamable-http', serverName: name, url, ...records, failOnStartupError: true }
      identity = ['http', url, sorted(list, true)]
    } else {
      throw new McpConfigError(`mcpServers[${index}] 用的 ${String(server.type)} 传输不受支持，请改用 stdio 或 http。`)
    }
    let config: McpClientConfig
    try {
      config = client.Config(input as never)
    } catch (error) {
      throw new McpConfigError(`mcpServers[${index}] 无效：${error instanceof Error ? error.message : String(error)}`)
    }
    // The schema copies records into ordinary objects; keep the null-prototype ones.
    return { name, config: { ...config, ...records } as McpClientConfig, fingerprint: JSON.stringify([name, identity]) }
  })
}

/** An error and the causes it carries, as one line. */
function reason(error: unknown): string {
  const parts: string[] = []
  let current: unknown = error
  for (let depth = 0; current !== undefined && current !== null && depth < 4; depth++) {
    const message = current instanceof Error ? current.message : String(current)
    if (message && !parts.includes(message)) parts.push(message)
    current = (current as { cause?: unknown }).cause
  }
  return parts.join('：') || '未知错误'
}

/** A server whose tools every session would see is not one client's to add. */
function assertAgentOnly(ctx: Context, agent: Agent, name: string): void {
  const tools = ctx.get('tools')
  if (!tools) return
  const prefix = `mcp__${name}__`
  for (const definition of tools.definitions(agent)) {
    if (definition.name.startsWith(prefix) && tools.get(definition.name) === definition) {
      throw new McpStartError(`MCP 服务器「${name}」的工具会出现在所有会话里，已经卸下：这个 DSH 不能只给一个会话添加 MCP 服务器。`)
    }
  }
}

interface Mount {
  readonly name: string
  readonly fingerprint: string
  /** The client views of the session that declared this server. */
  readonly holders: Set<object>
  /** Settles once the server is connected and its tools are listed; a failed start unmounts it. */
  ready: Promise<void>
  /** Unmount the server: its tools leave the Agent and its connection closes. */
  readonly dispose: () => Promise<void>
}

/**
 * The servers ACP clients mounted, per Agent. A holder is one client's view of one session; the
 * last holder's release unmounts a server. An Agent's disposal unmounts its servers by itself.
 */
export class McpMounts {
  private readonly agents = new WeakMap<Agent, Map<string, Mount>>()

  /**
   * Mount `declarations` in the Agent's scope for `holder`. A server another holder declared the
   * same way is shared; a different server under a name already mounted is refused, since one
   * Agent has one tool namespace per name. Resolves once every server is connected and its tools
   * are listed; on failure nothing stays mounted for this holder.
   * @returns the release of this holder's servers.
   */
  async acquire(modules: McpModules, agent: Agent, declarations: readonly McpDeclaration[], holder: object): Promise<() => Promise<void>> {
    let mounts = this.agents.get(agent)
    if (!mounts) this.agents.set(agent, mounts = new Map())
    const held: Mount[] = []
    const release = async () => { await Promise.allSettled(held.splice(0).map(mount => this.drop(agent, mount, holder))) }
    try {
      for (const declaration of declarations) {
        const existing = mounts.get(declaration.name)
        if (existing && existing.fingerprint !== declaration.fingerprint) {
          throw new McpConfigError(`这个会话里已经有另一个客户端声明的同名 MCP 服务器「${declaration.name}」，配置不同，请换一个名字。`)
        }
        const mount = existing ?? this.start(modules, agent, declaration, mounts)
        mount.holders.add(holder)
        held.push(mount)
        await mount.ready
      }
      return release
    } catch (error) {
      await release()
      throw error
    }
  }

  private start(modules: McpModules, agent: Agent, declaration: McpDeclaration, mounts: Map<string, Mount>): Mount {
    const scope = modules.scope.createScope(agent.ctx, agent)
    let disposing: Promise<void> | undefined
    const mount: Mount = {
      name: declaration.name, fingerprint: declaration.fingerprint, holders: new Set(), ready: Promise.resolve(),
      dispose: () => disposing ??= scope.dispose(),
    }
    mounts.set(declaration.name, mount)
    mount.ready = (async () => {
      try {
        await scope.ctx.plugin(modules.client, declaration.config)
        assertAgentOnly(scope.ctx, agent, declaration.name)
      } catch (error) {
        if (mounts.get(declaration.name) === mount) mounts.delete(declaration.name)
        await mount.dispose().catch(() => undefined)
        throw error instanceof McpStartError ? error : new McpStartError(`MCP 服务器「${declaration.name}」没有启动：${reason(error)}`)
      }
    })()
    // Every holder awaits it; this keeps a start nobody waits for any more from being reported as unhandled.
    mount.ready.catch(() => undefined)
    return mount
  }

  private async drop(agent: Agent, mount: Mount, holder: object): Promise<void> {
    if (!mount.holders.delete(holder) || mount.holders.size) return
    const mounts = this.agents.get(agent)
    if (mounts?.get(mount.name) === mount) mounts.delete(mount.name)
    await mount.dispose()
  }
}
