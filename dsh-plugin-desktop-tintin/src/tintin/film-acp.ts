// Film agent ACP bridge (第三行形态, 2026-10-23 用户裁决): 每部影片一个
// `dsh --profile acp` 子进程(DeepSeek Harness 的自动化 ACP stdio 面), 会话持久在
// 隔离 home, 模型路由到 TinTin 服务端(--patch 生成的模型路由 + 占位 env
// key). 对齐官方桌面 agents.mjs 的低层用法: initialize → session/new(或 resume)
// → session/prompt, 语义更新经 onEvent 流向聊天, 审批/提问路由给聊天卡回答
// (官方 `approve: true` 的口径由聊天 UI 承接; 无人应答时不自动放行).
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Readable, Writable } from 'node:stream'
import * as acp from '@agentclientprotocol/sdk'

const require_ = createRequire(import.meta.url)

/** 影片可用的服务端模型(id=请求用的模型名,name=选择器展示名). */
export interface FilmAgentModels { id: string; name: string }

/** 影片可用的服务端模型(补丁与兜底清单;与首启 provisioning 的降级清单同源). */
export const FILM_AGENT_MODELS: FilmAgentModels[] = [
  { id: 'deepseek-v4-flash', name: 'DeepSeek-V4-Flash' },
  { id: 'deepseek-v4-pro', name: 'DeepSeek-V4-Pro' },
]

/** 生成影片智能体的模型路由补丁(叠在 acp bundle 层之后生效).
    插件 id 必须是 acp 组合实际存在的行(llm-pi-ai/acp, 见 dsh-base cordis.patch.yml 135 行)
    —— id 写错(如曾经的 llm-pi-ai)整行被静默忽略, 模型回落官方直连。 */
export function filmAgentPatchText(serverUrl: string, models: FilmAgentModels[] = FILM_AGENT_MODELS): string {
  const rows = models.map((m) => `          - id: ${m.id}\n            name: ${m.name}`).join('\n')
  const lines = [
    '# TinTin 影片智能体: 模型路由到 TinTin 服务端(openai-completions, <server>/llm).',
    '# 由桌面端生成; 手改会被下次启动覆盖. key 走 env TINTIN_SERVER_API_KEY(占位值).',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      tintin-server:',
    '        displayName: TinTin',
    '        apiKeyEnv: TINTIN_SERVER_API_KEY',
    '        api: openai-completions',
    `        baseURL: ${serverUrl.replace(/\/+$/, '')}/llm`,
    '        models:',
    rows,
    '- id: acp',
    '  config:',
    '    provider: tintin-server',
    `    model: ${models[0]?.id ?? 'deepseek-v4-flash'}`,
  ]
  lines.push('')
  return lines.join('\n')
}

/** 把补丁写到隔离 home 的固定位置(内容变化才写), 返回补丁绝对路径. */
export function ensureFilmAgentPatch(channelHome: string, serverUrl: string, models?: FilmAgentModels[]): string {
  const dir = join(channelHome, 'tintin')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, 'film-agent.patch.yml')
  const text = filmAgentPatchText(serverUrl, models)
  if (!existsSync(path) || readFileSync(path, 'utf8') !== text) writeFileSync(path, text, 'utf8')
  return path
}

/** app 内的 `@deepseek-ai/dsh` CLI 可执行文件(与宿主同版本, 由包清单解析). */
export function resolveDshBin(): string {
  const manifest = require_.resolve('@deepseek-ai/dsh/package.json')
  const parsed = JSON.parse(readFileSync(manifest, 'utf8')) as { bin?: Record<string, string> | string }
  const bin = typeof parsed.bin === 'object' && parsed.bin !== null ? parsed.bin.dsh : parsed.bin
  if (typeof bin !== 'string' || bin === '') throw new Error('@deepseek-ai/dsh declares no dsh executable')
  return join(dirname(manifest), bin)
}

/** The dsh CLI is spawnable (Settings → Agents 的 ready/missing 判定). */
export function dshBinExists(): boolean {
  try { return existsSync(resolveDshBin()) } catch { return false }
}

const CLIENT_CAPABILITIES = {
  fs: { readTextFile: true, writeTextFile: true },
  elicitation: { form: {} },
  session: { notices: {} },
}
const CLIENT_INFO = { name: 'tintin-desktop', title: 'TinTin' }

/** 官方口径的审批放行选项已改由聊天 UI 承接(权限事件路由), 此处不再自动放行. */

/** ACP 表单 → 聊天问题清单(官方 formQuestions 移植): null = 该表单本聊天不展示(拒答, 智能体按跳过处理). */
function formQuestions(params: {
  mode?: unknown
  message?: unknown
  requestedSchema?: { properties?: Record<string, {
    type?: string
    title?: unknown
    description?: unknown
    enum?: unknown[]
    oneOf?: Array<{ const?: unknown; description?: unknown }> | null
    anyOf?: Array<{ const?: unknown; description?: unknown }> | null
    items?: { anyOf?: Array<{ const?: unknown; description?: unknown }> | null; oneOf?: Array<{ const?: unknown; description?: unknown }> | null }
    _meta?: { _askUserQuestionCustomAnswer?: { questionId?: unknown }; codex?: { role?: unknown; questionId?: unknown } }
  }> | null
  }}): Array<{ id: string; question: string; header: string | null; options: Array<{ label: string; description?: string }>; customId: string | null; multi: boolean }> | null {
  if (params?.mode !== undefined && params.mode !== 'form') return null
  const properties = params?.requestedSchema?.properties
  if (!properties || typeof properties !== 'object') return null
  const entries = Object.entries(properties)
  const customOf = new Map<string, string>()
  for (const [id, prop] of entries) {
    const target = prop?._meta?._askUserQuestionCustomAnswer?.questionId
      ?? (prop?._meta?.codex?.role === 'user_note' ? prop._meta.codex.questionId : undefined)
    if (typeof target === 'string' && properties[target]) customOf.set(target, id)
  }
  const custom = new Set(customOf.values())
  const fields = entries.filter(([id]) => !custom.has(id))
  if (fields.length === 0) return null
  const questions: Array<{ id: string; question: string; header: string | null; options: Array<{ label: string; description?: string }>; customId: string | null; multi: boolean }> = []
  for (const [id, prop] of fields) {
    const multi = prop?.type === 'array'
    const choices = multi ? (prop.items?.anyOf ?? prop.items?.oneOf) : (prop?.oneOf ?? prop?.anyOf)
    const options = Array.isArray(choices)
      ? choices.filter((c) => typeof c?.const === 'string').map((c) => ({ label: String(c.const), ...(c.description ? { description: String(c.description) } : {}) }))
      : Array.isArray(prop?.enum) ? prop.enum.filter((v) => typeof v === 'string').map((label) => ({ label })) : []
    if (prop?.type !== 'string' && !multi) return null
    if (multi && options.length === 0) return null
    const codex = Boolean(prop?._meta?.codex)
    const title = typeof prop?.title === 'string' && prop.title ? prop.title : null
    const description = typeof prop?.description === 'string' && prop.description ? prop.description : null
    const question = codex
      ? title ?? description ?? (typeof params.message === 'string' ? params.message : '') ?? id
      : description ?? (fields.length === 1 && typeof params.message === 'string' ? params.message : title ?? (typeof params.message === 'string' ? params.message : '') ?? id)
    const header = codex ? description : title
    questions.push({ id, question: String(question), header: header && header !== question ? header : null, options, customId: customOf.get(id) ?? null, multi })
  }
  return questions
}

/** 聊天的回答 → 表单内容(官方 formContent 移植). */
function formContent(
  questions: Array<{ id: string; options: Array<{ label: string }>; customId: string | null; multi: boolean }>,
  answers: Record<string, { label?: unknown; text?: unknown }> | null,
): Record<string, unknown> {
  const content: Record<string, unknown> = {}
  for (const q of questions) {
    const a = answers?.[q.id]
    if (!a) continue
    if (typeof a.label === 'string' && q.options.some((o) => o.label === a.label)) {
      content[q.id] = q.multi ? [a.label] : a.label
    } else if (typeof a.text === 'string' && a.text.trim()) {
      const text = a.text.trim()
      if (q.customId) content[q.customId] = text
      else if (q.options.length === 0) content[q.id] = text
    }
  }
  return content
}

export interface FilmAgentUpdate { project: string; event: FilmAgentEvent }

/** ACP 语义事件, 与官方 DesktopBridge 的 LocalAgentEvent 同形(聊天按 sessionUpdate 分派渲染). */
export type FilmAgentEvent =
  | { key: string; kind: 'update'; update: { sessionUpdate: string } & Record<string, unknown> }
  | { key: string; kind: 'permission'; requestId: string; params: { toolCall?: { title?: string }; options: Array<{ optionId: string; name: string; kind: string }> } }
  | { key: string; kind: 'question'; requestId: string; message: string; toolCallId: string | null; questions: Array<{ id: string; question: string; header: string | null; options: Array<{ label: string; description?: string }>; customId: string | null; multi: boolean }> }
  | { key: string; kind: 'exit'; code: number | null; stderr: string }
  | { key: string; kind: 'done'; ok: boolean; stopReason?: string; error?: string }

export interface FilmAgentState {
  id: 'deepseek'
  label: string
  cli: { path: string; source: 'app' } | null
  signedIn: boolean
  install: string
}

interface Handle {
  project: string
  sessionId: string | null
  child: ReturnType<typeof spawn>
  agent: Promise<{ prompt(text: string, images?: Array<{ data: string; mimeType: string }>): Promise<{ stopReason: string }> }>
  conn: {
    agent: {
      request(method: unknown, params: Record<string, unknown>): Promise<unknown>
      notify(method: unknown, params: Record<string, unknown>): Promise<void>
    }
  } | null
  init: { agentInfo?: { name?: string; title?: string; version?: string } | null; agentCapabilities?: Record<string, unknown> | null } | null
  session: Record<string, unknown> | null
  steering: boolean
}

/**
 * 每部影片一个 ACP 子进程的管理器: 首次 start 拉起并建会话(或 resume), 之后复用;
 * 进程退出即丢弃(会话已持久, 下次 start 以 resume 续上). 语义事件经 onEvent 流出.
 */
export class FilmAgentManager {
  private handles = new Map<string, Handle>()
  private sessionIds = new Map<string, string>()
  private permissions = new Map<string, { project: string; resolve: (response: unknown) => void }>()
  private questions = new Map<string, { project: string; resolve: (response: unknown) => void; questions: Array<{ id: string; options: Array<{ label: string }>; customId: string | null; multi: boolean }> }>()
  private log: (message: string) => void

  constructor(private options: { channelHome: string; serverUrl: () => string; onEvent?: (update: FilmAgentUpdate) => void; log?: (message: string) => void }) {
    this.log = options.log ?? (() => {})
  }

  /** Settings → Agents 的名册行(官方 LocalAgentState 的 TinTin 子集). */
  listState(): FilmAgentState {
    const exists = dshBinExists()
    return {
      id: 'deepseek',
      label: 'DeepSeek Harness',
      cli: exists ? { path: 'dsh', source: 'app' } : null,
      signedIn: true, /* login: null —— 无登录命令, 服务端模型 */
      install: 'https://github.com/deepseek-ai/deepseek-harness',
    }
  }

  /** 提交一条消息; 语义更新经 onEvent 流出并缓存(重载恢复), 事件同步落盘
      .film/logs/<turnId>.jsonl(Developer 的每轮日志面数据源), Promise 在整轮结束时落定. */
  async prompt(project: string, text: string, meta?: { turnId?: string }, images?: Array<{ data: string; mimeType: string }>): Promise<{ stopReason: string }> {
    const turnId = meta?.turnId ?? randomUUID()
    const logsDir = join(project, '.film', 'logs')
    mkdirSync(logsDir, { recursive: true })
    const logFile = join(logsDir, `${turnId}.jsonl`)
    this.activeLogs.set(project, logFile)
    this.trackTurn(project, null)
    const entry = this.turns.get(project)!
    const handle = await this.ensure(project)
    const agent = await handle.agent
    appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), kind: 'prompt', text })}\n`, 'utf8')
    try {
      const result = await agent.prompt(text, images)
      entry.done = { ok: true, stopReason: result.stopReason }
      appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), kind: 'done', ok: true, stopReason: result.stopReason })}\n`, 'utf8')
      this.emit(project, { key: project, kind: 'done', ok: true, stopReason: result.stopReason })
      return result
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      entry.done = { ok: false, error: message }
      appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), kind: 'done', ok: false, error: message })}\n`, 'utf8')
      this.emit(project, { key: project, kind: 'done', ok: false, error: message })
      throw error
    } finally {
      this.activeLogs.delete(project)
    }
  }

  /** 显式启动(或续接)一部影片的会话, 返回会话信息(聊天侧 start 的后端). */
  /** 显式启动(或续接)一部影片的会话, 返回会话信息(聊天侧 start 的后端)。
      */
  async begin(project: string): Promise<{
    sessionId: string; resumed: boolean; agentInfo: { name?: string; title?: string; version?: string } | null; authMethods: never[]; mcp: false;
    models: { availableModels: Array<{ modelId: string; name: string; description?: string }>; currentModelId: string } | null;
    modes: null; configOptions: Array<Record<string, unknown>> | null;
  }> {
    const handle = await this.ensure(project)
    const session = (handle.session ?? {}) as {
      models?: { availableModels?: Array<Record<string, unknown>>; currentModelId?: unknown }
      configOptions?: Array<Record<string, unknown>>
    }
    const available = Array.isArray(session.models?.availableModels) ? session.models!.availableModels! : []
    return {
      sessionId: handle.sessionId ?? '',
      resumed: false,
      agentInfo: handle.init?.agentInfo ?? null,
      authMethods: [],
      mcp: false,
      models: available.length ? {
        availableModels: available.map((m) => ({
          modelId: String(m.modelId ?? m.id ?? ''),
          name: String(m.name ?? m.modelId ?? ''),
          ...(m.description ? { description: String(m.description) } : {}),
        })),
        currentModelId: String(session.models?.currentModelId ?? available[0]?.modelId ?? ''),
      } : null,
      modes: null,
      configOptions: Array.isArray(session.configOptions) ? session.configOptions : null,
    }
  }

  /** 插话: ACP 报告支持 steering 才原样发(服务端自行并入当前轮), 否则明确不支持. */
  async steer(project: string, text: string, images?: Array<{ data: string; mimeType: string }>): Promise<{ ok: boolean; outcome: string }> {
    const handle = this.handles.get(project)
    if (!handle?.conn || !handle.steering) return { ok: false, outcome: 'not-supported' }
    const blocks: Array<Record<string, unknown>> = [{ type: 'text', text }, ...((images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })))]
    await handle.conn.agent.notify(acp.methods.agent.session.prompt, { sessionId: handle.sessionId, prompt: blocks })
    return { ok: true, outcome: 'queued' }
  }

  /** 取消进行中的一轮(session/cancel 通知; 进程与会话保留). */
  async cancel(project: string): Promise<{ ok: boolean }> {
    const handle = this.handles.get(project)
    if (!handle?.conn || !handle.sessionId) return { ok: false }
    await handle.conn.agent.notify(acp.methods.agent.session.cancel, { sessionId: handle.sessionId })
    return { ok: true }
  }

  async answerPermission(project: string, requestId: string, optionId: string | null): Promise<{ ok: boolean }> {
    const pending = this.permissions.get(requestId)
    if (!pending || pending.project !== project) return { ok: false }
    this.permissions.delete(requestId)
    pending.resolve({ outcome: optionId ? { outcome: 'selected', optionId } : { outcome: 'cancelled' } })
    return { ok: true }
  }

  async answerQuestion(project: string, requestId: string, answers: Record<string, { label?: string; text?: string }> | null): Promise<{ ok: boolean }> {
    const pending = this.questions.get(requestId)
    if (!pending || pending.project !== project) return { ok: false }
    this.questions.delete(requestId)
    if (answers === null) pending.resolve({ action: 'decline' })
    else pending.resolve({ action: 'accept', content: formContent(pending.questions, answers) })
    return { ok: true }
  }

  /** 切会话配置项(模型/模式; 官方 setOption 的直通). */
  async setOption(project: string, configId: string, value: unknown): Promise<{ ok: boolean; error?: string; result?: { configOptions?: unknown } }> {
    const handle = this.handles.get(project)
    if (!handle?.conn || !handle.sessionId) return { ok: false, error: '会话未启动' }
    try {
      const result = await handle.conn.agent.request(acp.methods.agent.session.setConfigOption, { sessionId: handle.sessionId, configId, value }) as { configOptions?: unknown } | undefined
      return { ok: true, ...(result ? { result } : {}) }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  /** 结束一部影片的智能体进程(会话已持久, 下次 start 以 resume 续上). */
  stop(project: string): void {
    const handle = this.handles.get(project)
    if (!handle) return
    this.handles.delete(project)
    try { handle.child.kill() } catch { /* 已退出 */ }
  }

  /** 轮次回执缓存: 页面重载后 running() 恢复显示用; 聊天 ack 后清除. */
  private turns = new Map<string, {
    key: string
    agent: 'deepseek'
    cwd: string
    meta: unknown
    done: { ok: true; stopReason: string } | { ok: false; error: string } | null
    events: Array<Record<string, unknown> & { kind: string }>
  }>()

  /** 聊天重载时取回仍在进行/刚结束未认领的轮次(官方 localAgents.running 语义). */
  runningTurns(): Array<{ key: string; agent: 'deepseek'; cwd: string; meta: unknown; done: { ok: true; stopReason: string } | { ok: false; error: string } | null; events: Array<Record<string, unknown> & { kind: string }> }> {
    return [...this.turns.values()].map((turn) => ({ ...turn, events: [...turn.events] }))
  }

  /** 聊天已把该轮接回显示: 丢弃缓存. */
  ackTurn(key: string): void {
    this.turns.delete(key)
  }

  /** 登记一轮( start 时建档, 供重载恢复; 已有则更新 meta ). */
  trackTurn(project: string, meta: unknown): void {
    const existing = this.turns.get(project)
    if (existing) { existing.meta = meta ?? existing.meta; return }
    this.turns.set(project, { key: project, agent: 'deepseek', cwd: project, meta: meta ?? null, done: null, events: [] })
  }

  dispose(): void {
    for (const project of [...this.handles.keys()]) this.stop(project)
  }

  // ── 内部 ────────────────────────────────────────────────────────────────

  private activeLogs = new Map<string, string>()

  private emit(project: string, event: FilmAgentEvent): void {
    const entry = this.turns.get(project)
    if (entry) entry.events.push({ ...event } as Record<string, unknown> & { kind: string })
    const logFile = this.activeLogs.get(project)
    if (logFile) {
      try { appendFileSync(logFile, `${JSON.stringify({ t: Date.now(), ...event })}\n`, 'utf8') } catch { /* 日志失败不阻断会话 */ }
    }
    this.options.onEvent?.({ project, event })
  }

  private ensure(project: string): Promise<Handle> {
    const existing = this.handles.get(project)
    /* 角色切换 = 人设不同, 会话必须重建(补丁按角色分文件) */
    if (existing && existing.child.exitCode === null) return Promise.resolve(existing)
    if (existing) this.stop(project)
    const handle = this.start(project)
    this.handles.set(project, handle)
    return handle.agent.then(() => handle)
  }

  private start(project: string): Handle {
    const serverUrl = this.options.serverUrl().replace(/\/+$/, '')
    if (!serverUrl) throw new Error('server.url 未配置: 影片智能体无法启动')
    const patchPath = ensureFilmAgentPatch(this.options.channelHome, serverUrl)
    const home = join(this.options.channelHome, 'film-agent-home')
    mkdirSync(home, { recursive: true })
    /* 内置 openfilm 技能随包分发(2026-10-24): 同步进影片智能体的 home ——
       智能体才有该技能可执行; 同步失败不阻断启动。 */
    try {
      const bundled = join(process.resourcesPath ?? '', 'skills', 'openfilm', 'SKILL.md')
      const devSource = resolve(dirname(fileURLToPath(import.meta.url)), '../../../dsh-tintin-bundle/resources/skills/openfilm/SKILL.md')
      const source = existsSync(bundled) ? bundled : devSource
      if (existsSync(source)) {
        const target = join(home, 'skills', 'openfilm')
        mkdirSync(target, { recursive: true })
        writeFileSync(join(target, 'SKILL.md'), readFileSync(source, 'utf8'))
      }
    } catch { /* 技能同步失败不阻断启动 */ }
    const bin = resolveDshBin()
    const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: home, TINTIN_SERVER_API_KEY: 'sk-tintin-local' }
    const child = spawn(process.execPath, [bin, '--profile', 'acp', '--patch', patchPath], {
      cwd: project,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16_000)
      /* 子进程 stderr 实时进管理器日志(2026-10-25 可观测性缺口: 失败轮次没有任何记录面) */
      const text = String(chunk).trim()
      if (text) this.log(`[agent-stderr] ${text.slice(0, 500)}`)
    })
    /* 占位 promise 不能用 Promise.reject: 创建即拒绝且无人接住 → unhandledRejection →
       failLoud 按致命错误退出主程序(2026-10-24 打开视频剪辑即崩的实测根因)。 */
    type AgentImpl = { prompt: (text: string, images?: Array<{ data: string; mimeType: string }>) => Promise<{ stopReason: string }> }
    let settleAgent!: (impl: AgentImpl) => void
    let failAgent!: (error: Error) => void
    const agent = new Promise<AgentImpl>((resolve, reject) => { settleAgent = resolve; failAgent = reject })
    const handle: Handle = {
      project, sessionId: this.sessionIds.get(project) ?? null, child, agent,
      conn: null, init: null, session: null, steering: false,
    }
    const forward = (update: unknown) => {
      const u = update as { sessionUpdate?: string } | null
      this.emit(project, { key: project, kind: 'update', update: { sessionUpdate: String(u?.sessionUpdate ?? 'unknown'), ...(update as Record<string, unknown>) } })
    }

    const started = (async () => {
      const stream = acp.ndJsonStream(
        Writable.toWeb(child.stdin as Writable) as WritableStream<Uint8Array>,
        /* @types/node 的 toWeb 返回 any 泛型流;桥接到 SDK 期望的 DOM 字节流视图 */
        Readable.toWeb(child.stdout as Readable) as ReadableStream<Uint8Array>,
      )
      const conn = acp.client({ name: CLIENT_INFO.name })
        .onRequest(acp.methods.client.session.requestPermission, (ctx) => new Promise((resolve) => {
          const requestId = randomUUID()
          this.permissions.set(requestId, { project, resolve: resolve as (response: unknown) => void })
          this.emit(project, {
            key: project, kind: 'permission', requestId,
            params: { toolCall: { title: String(ctx.params.toolCall?.title ?? '') }, options: (ctx.params.options ?? []) as Array<{ optionId: string; name: string; kind: string }> },
          })
        }))
        .onRequest(acp.methods.client.elicitation.create, (ctx) => new Promise((resolve) => {
          const questions = formQuestions(ctx.params as Parameters<typeof formQuestions>[0])
          if (!questions) { resolve({ action: 'decline' as const }); return }
          const requestId = randomUUID()
          this.questions.set(requestId, { project, resolve: resolve as (response: unknown) => void, questions })
          this.emit(project, { key: project, kind: 'question', requestId, message: String(ctx.params.message ?? ''), toolCallId: null, questions })
        }))
        .onRequest(acp.methods.client.fs.writeTextFile, () => ({}))
        .onRequest(acp.methods.client.fs.readTextFile, () => ({ content: '' }))
        .onNotification(acp.methods.client.session.update, (ctx) => forward(ctx.params.update))
        .connect(stream)
      handle.conn = conn
      child.once('exit', (code) => {
        if (this.handles.get(project)?.child === child) this.handles.delete(project)
        this.log(`film agent exited (${code})`)
        this.emit(project, { key: project, kind: 'exit', code: code ?? null, stderr: stderr.slice(-2000) })
      })
      const init = await conn.agent.request(acp.methods.agent.initialize, {
        protocolVersion: acp.PROTOCOL_VERSION,
        clientCapabilities: CLIENT_CAPABILITIES,
        clientInfo: CLIENT_INFO,
      }) as { agentInfo?: { name?: string; title?: string; version?: string }; agentCapabilities?: Record<string, unknown>; _meta?: { steering?: { supported?: boolean } } }
      handle.init = init
      handle.steering = init._meta?.steering?.supported === true
      /* 服务端 MCP(2026-10-25 用户裁决): 会话声明服务端的 MCP server(streamable-http),
         智能体工具清单即获得注册表全部能力 —— 大模型可自主编排服务端能力。 */
      const mcpServers: unknown[] = serverUrl
        ? [{ name: 'tintin-server', type: 'http', url: `${serverUrl.replace(/\/+$/, '')}/mcp` }]
        : []
      const params = { cwd: project, mcpServers }
      let sessionId: string | null = this.sessionIds.get(project) ?? null
      if (sessionId !== null) {
        /* 持久会话: resume 失败(如目录变更)回落新建 */
        const resumed = await conn.agent.request(acp.methods.agent.session.resume, { ...params, sessionId }).then((r) => r as { sessionId: string } & Record<string, unknown>, () => null)
        if (resumed) { sessionId = resumed.sessionId; handle.session = resumed }
        else sessionId = null
      }
      if (sessionId === null) {
        const created = await conn.agent.request(acp.methods.agent.session.new, params) as { sessionId: string } & Record<string, unknown>
        sessionId = created.sessionId
        handle.session = created
      }
      handle.sessionId = sessionId
      this.sessionIds.set(project, sessionId)
      const promptFn = async (text: string, images?: Array<{ data: string; mimeType: string }>) => {
        const blocks: Array<Record<string, unknown>> = [{ type: 'text', text }, ...((images ?? []).map((i) => ({ type: 'image', data: i.data, mimeType: i.mimeType })))]
        const response = await conn.agent.request(acp.methods.agent.session.prompt, { sessionId: handle.sessionId, prompt: blocks }) as { stopReason: string }
        return { stopReason: response.stopReason }
      }
      return { prompt: promptFn }
    })()
    void started.then(
      (impl) => { settleAgent(impl) },
      (error) => {
        this.handles.delete(project)
        this.log(`film agent start failed: ${error?.message ?? error}; stderr: ${stderr.slice(-500)}`)
        failAgent(error instanceof Error ? error : new Error(String(error)))
      },
    )
    return handle
  }
}
