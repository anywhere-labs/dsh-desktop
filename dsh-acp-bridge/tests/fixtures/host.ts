/**
 * A real DSH host in-process: official session store, persistence, Gateway,
 * Agent loop and Session Controller, with only the paid model scripted.
 * Adapted from the fixtures of the Agents Anywhere DSH plugin (`dsh-bridge-next`).
 */

import { Context } from '@deepseek-ai/cordis'
import Include from '@deepseek-ai/cordis-plugin-include'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentDefaultModel from '@deepseek-ai/dsh-agent-default-model'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPreset from '@deepseek-ai/dsh-agent-preset'
import AgentPresets from '@deepseek-ai/dsh-agent-preset-registry'
import TeamService from '@deepseek-ai/dsh-agent-team'
import Gateway from '@deepseek-ai/dsh-api-gateway'
import * as Remotes from '@deepseek-ai/dsh-api-remotes'
import SessionController from '@deepseek-ai/dsh-api-session-controller'
import Attachments from '@deepseek-ai/dsh-attachment-local'
import { HostConnectionService } from '@deepseek-ai/dsh-client-connection'
import FileUploads from '@deepseek-ai/dsh-client-file-upload'
import Commands from '@deepseek-ai/dsh-commands'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { LlmAdapter, ReasoningEffortId, ToolCallId, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import PermissionPresets from '@deepseek-ai/dsh-permission-presets'
import SessionStore from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjection from '@deepseek-ai/dsh-session-projection'
import SqliteQuery from '@deepseek-ai/dsh-session-query-sqlite'
import Shell from '@deepseek-ai/dsh-shell'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomain from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import SubagentRuntime from '@deepseek-ai/dsh-subagent'
import * as SubagentSpawn from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as AskUserTool from '@deepseek-ai/dsh-tool-ask-user'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import * as SubagentTool from '@deepseek-ai/dsh-tool-subagent'
import * as TodoTool from '@deepseek-ai/dsh-tool-todo'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import TypertRegistry from '@deepseek-ai/dsh-typert-registry'
import Approval from '@deepseek-ai/dsh-user-approval'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'
import WorkspaceRegistry from '@deepseek-ai/dsh-workspace'
import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { MeshCallClient } from 'meshcall'
import { readRecords, type EndpointRecord } from '../../src/endpoint.js'
import { interactionPeer } from '../../src/acp/interaction-stream.js'
import type * as BridgePlugin from '../../src/index.js'
import { RPC_SERVICE, TOKEN_METADATA } from '../../src/paths.js'

/** No shell tools are registered here; any shell execution is a test failure. */
class UnusedShell extends Shell {
  override get sandboxMode() { return 'workspace-write' as const }
  resolve(): never { throw new Error('Unexpected shell execution') }
  async run(): Promise<never> { throw new Error('Unexpected shell execution') }
  start(): never { throw new Error('Unexpected shell execution') }
  async execute(): Promise<never> { throw new Error('Unexpected shell execution') }
}

type Message = { role?: string, source?: { kind?: string }, content?: readonly { type: string, text?: string }[] }

/** A point a test opens when it is ready; `reached` counts the callers that arrived. */
export class Gate {
  reached = 0
  private opened = false
  private readonly waiters: (() => void)[] = []
  async wait(): Promise<void> {
    this.reached++
    if (!this.opened) await new Promise<void>(resolve => this.waiters.push(resolve))
  }
  open(): void {
    this.opened = true
    for (const resume of this.waiters.splice(0)) resume()
  }
}

/** Rejects when the model call is cancelled, so a held script never keeps DSH from ending a turn. */
function aborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise<never>((_, reject) => {
    const abort = () => reject(signal?.reason ?? new Error('aborted'))
    if (signal?.aborted) abort()
    else signal?.addEventListener('abort', abort, { once: true })
  })
}

/**
 * The latest tool result, else the latest message a person wrote (DSH appends runtime context after
 * it), else a subagent's completion notice when that came after the person's message.
 */
function lastText(options: GenerateOptions): { role: string, text: string } {
  const messages = options.messages as readonly Message[]
  const last = messages.at(-1)
  if (last?.role === 'tool') return { role: 'tool', text: '' }
  const user = messages.findLast(message => message.role === 'user' && (message.source?.kind === 'user' || message.source?.kind === 'subagent-settled'))
  if (user?.source?.kind === 'subagent-settled') return { role: 'notice', text: '' }
  return { role: 'user', text: (user?.content ?? []).map(block => block.text ?? '').join('') }
}

/**
 * The scripted model. The latest message decides what it does:
 * - a tool result: reply 「工具完成」;
 * - a subagent's completion notice: reply 「收到结果」;
 * - 「派助手」: start a background subagent with the `subagent` tool, whose task is 「后台工作」;
 * - 「后台工作」 (the subagent's own model): hold until `child` opens, then reply 「后台完成」;
 * - 「调用工具」: call the approval-gated `danger` tool;
 * - 「提问」: call `ask_user_question` with a single-choice and a free-text question;
 * - 「单选」: call `ask_user_question` with one single-choice question;
 * - 「计划」: write a three-item todo list with `todo_write`;
 * - 「等待」: stream 「开始」, then hold until cancelled;
 * - 「分段」: stream 「你好前半」, wait for `midway`, then stream 「后半」;
 * - anything else: think, then stream 「你好」.
 * While `unavailable` is set, resolving any model fails, as with a provider offline.
 */
export class ScriptAdapter extends LlmAdapter {
  requests: GenerateOptions[] = []
  unavailable = false
  midway = new Gate()
  /** Holds every subagent until the test opens it. */
  child = new Gate()
  override async listModels(provider: string) {
    return ['text', 'thinking'].map(id => ({ provider, id, name: id === 'text' ? 'Text' : 'Thinking' }))
  }
  override async resolveModel(provider: string, model: string) {
    if (model === 'invalid' || this.unavailable) throw new Error('模型服务暂时不可用')
    return { provider, id: model, name: model, contextWindow: 64_000, ...(model === 'thinking' ? { reasoning: {
      efforts: ['low', 'high'].map(id => ({ id: ReasoningEffortId(id), name: id })), defaultEffort: ReasoningEffortId('low'),
    } } : {}) }
  }
  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    this.requests.push(options)
    const last = lastText(options)
    const text = async function* (value: string, index = 0): AsyncIterable<StreamChunk> {
      yield { type: 'block-start', index, blockType: 'text' }
      for (const piece of [...value]) yield { type: 'text-delta', index, text: piece }
      yield { type: 'block-end', index, block: { type: 'text', text: value } }
    }
    const call = async function* (name: string, args: unknown): AsyncIterable<StreamChunk> {
      const id = ToolCallId(randomUUID())
      yield { type: 'block-start', index: 0, blockType: 'tool-call' }
      yield { type: 'block-end', index: 0, block: { type: 'tool-call', id, name, arguments: JSON.stringify(args) } }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
    }
    if (last.role === 'tool') {
      yield* text('工具完成')
    } else if (last.role === 'notice') {
      yield* text('收到结果')
    } else if (last.text.includes('后台工作')) {
      await Promise.race([this.child.wait(), aborted(options.signal)])
      yield* text('后台完成')
    } else if (last.text.includes('派助手')) {
      yield* call('subagent', { description: '后台任务', prompt: '后台工作：等放行后回复' })
      return
    } else if (last.text.includes('调用工具')) {
      yield* call('danger', { target: '/etc/hosts' })
      return
    } else if (last.text.includes('提问')) {
      yield* call('ask_user_question', { questions: [
        { id: 'mode', question: '选择模式', options: [{ label: '标准' }, { label: '快速', description: '少做检查' }] },
        { id: 'notes', question: '其他要求' },
      ] })
      return
    } else if (last.text.includes('单选')) {
      yield* call('ask_user_question', { questions: [
        { id: 'mode', header: '模式', question: '选择模式', options: [{ label: '标准' }, { label: '快速', description: '少做检查' }] },
      ] })
      return
    } else if (last.text.includes('计划')) {
      yield* call('todo_write', { todos: [
        { content: '读代码', status: 'completed' }, { content: '写测试', status: 'in_progress' }, { content: '提交', status: 'pending' },
      ] })
      return
    } else if (last.text.includes('分段')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '你好前半' }
      await Promise.race([this.midway.wait(), aborted(options.signal)])
      yield { type: 'text-delta', index: 0, text: '后半' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: '你好前半后半' } }
    } else if (last.text.includes('等待')) {
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: '开始' }
      await aborted(options.signal)
    } else {
      yield { type: 'block-start', index: 0, blockType: 'reasoning' }
      yield { type: 'reasoning-delta', index: 0, text: '想一想' }
      yield { type: 'block-end', index: 0, block: { type: 'reasoning', text: '想一想' } }
      yield* text('你好', 1)
    }
    yield { type: 'usage', usage: { inputTokens: 12, outputTokens: 3 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** The 0.2.1+ Gateway and Session Controller inject the RemoteAccess policy service. */
async function mountRemoteAccess(ctx: Context): Promise<void> {
  if (ctx.get('remoteAccess')) return
  const path = createRequire(import.meta.url).resolve('@deepseek-ai/dsh-api-remote-access')
  await ctx.plugin((await import(pathToFileURL(path).href)).default).await()
}

/** The endpoint answers and DSH already delivers approvals and questions to it. */
export async function ready(acpHome: string): Promise<EndpointRecord> {
  const deadline = Date.now() + 15_000
  for (;;) {
    const [stored] = await readRecords(acpHome)
    if (stored) {
      const client = new MeshCallClient(stored.record.endpoint, undefined, { retry: false })
      try {
        const info = await client.unary<object, { interactions?: { approvals?: boolean, questions?: boolean } }>(RPC_SERVICE, 'info', {},
          { metadata: { [TOKEN_METADATA]: stored.record.token }, timeoutMs: 2_000 })
        if (info.interactions?.approvals && info.interactions.questions) return stored.record
      } catch { /* not serving yet */ } finally { await client.close() }
    }
    if (Date.now() > deadline) throw new Error('The ACP endpoint did not become ready')
    await delay(20)
  }
}

/**
 * A DSH Desktop window: an owner interaction stream that receives every
 * approval and question and holds it, as a card nobody has clicked yet.
 * Returns the stop function.
 */
export function holdInteractions(ctx: Context): () => void {
  const abort = new AbortController()
  const open = ctx.typertGateway.wireStream.open as (...args: unknown[]) => Promise<AsyncIterable<unknown>>
  void (async () => {
    const stream = await Reflect.apply(open, ctx.typertGateway.wireStream,
      ['$events', { args: {} }, (async function* () {})(), interactionPeer(ctx.connection), abort.signal])
    for await (const _frame of stream) { /* shown, never answered */ }
  })().catch(() => undefined)
  return () => abort.abort()
}

/** What the bridge reports about itself over RPC. */
export interface BridgeInfo { connections: number, followed: number, interactions: { approvals: boolean, questions: boolean } }

export async function bridgeInfo(acpHome: string): Promise<BridgeInfo> {
  const [stored] = await readRecords(acpHome)
  if (!stored) throw new Error('No endpoint record')
  const client = new MeshCallClient(stored.record.endpoint, undefined, { retry: false })
  try {
    return await client.unary<object, BridgeInfo>(RPC_SERVICE, 'info', {}, { metadata: { [TOKEN_METADATA]: stored.record.token }, timeoutMs: 5_000 })
  } finally { await client.close() }
}

/**
 * Make a Session Controller method wait for `gate` first, as a slow DSH would.
 * `follow` returns its stream at once and waits on the first read. Returns the restore function.
 */
export function holdController(ctx: Context, method: 'create' | 'follow', gate: Gate): () => void {
  const controller = ctx.sessionController as unknown as Record<string, (...args: unknown[]) => unknown>
  const original = controller[method]!
  controller[method] = method === 'follow'
    ? (...args: unknown[]) => ({
      async *[Symbol.asyncIterator]() {
        await gate.wait()
        yield* original.apply(controller, args) as AsyncIterable<unknown>
      },
    })
    : async (...args: unknown[]) => { await gate.wait(); return original.apply(controller, args) }
  return () => { controller[method] = original }
}

export interface Host {
  ctx: Context
  root: string
  /** Endpoint records, sockets and the launcher. */
  acpHome: string
  /** A workspace directory sessions run in. */
  workspace: string
  adapter: ScriptAdapter
  /** Calls of the `/wait` command, which runs until cancelled. */
  waits: { started: number, stopped: number }
  /** Unload every plugin, keeping the files for inspection. */
  dispose(): Promise<void>
  close(): Promise<void>
}

export interface HostOptions {
  /** Runs before the plugin starts, for example to leave records behind in its home. */
  prepare?(acpHome: string): Promise<void>
  /** Mount DSH's subagents with the in-process backend and the `subagent` tool, as the base bundle does. */
  subagents?: boolean
  /** Also mount DSH's Team mode (`ctx.agentTeams`), the 「启用智能体团队协作」 switch; implies `subagents`. */
  agentTeams?: boolean
  /** Directory name of the plugin home under the test root. */
  homeName?: string
}

export async function startHost(options: HostOptions = {}): Promise<Host> {
  // Real paths: DSH and the bridge canonicalize workspaces (macOS /var is /private/var).
  const root = await realpath(await mkdtemp(join(tmpdir(), 'aa-acp-test-')))
  const workspace = join(root, 'project')
  await mkdir(workspace, { recursive: true })
  const ctx = new Context()
  const adapter = new ScriptAdapter()
  try {
    await ctx.plugin(SessionStore).await()
    await ctx.plugin(Reflect.get(JsonlPersistence, 'default') ?? JsonlPersistence, { root: join(root, 'sessions'), compression: 'none' }).await()
    await ctx.plugin(SqliteQuery, { path: ':memory:', openAt: 'never' }).await()
    await ctx.plugin(Storage).await()
    await ctx.plugin(StorageJson, { root: join(root, 'storage') }).await()
    await ctx.plugin(StorageDomain, { backend: 'json' }).await()
    await ctx.plugin(WorkspaceRegistry).await()
    await ctx.plugin(TypertRegistry).await()
    await mountRemoteAccess(ctx)
    await ctx.plugin(Gateway).await()
    await ctx.plugin(LlmRuntime).await()
    await ctx.plugin(SessionProjection).await()
    await ctx.plugin(SystemPrompt).await()
    await ctx.plugin(ToolRuntime).await()
    await ctx.plugin(NativeToolExecutor).await()
    await ctx.plugin(TodoTool, { allowParallelInProgress: false }).await()
    await ctx.plugin(AgentRegistry).await()
    await ctx.plugin(AgentLoop, { agents: [] }).await()
    await ctx.plugin(AgentDefaultModel, { provider: 'test', model: 'text' }).await()
    ctx.llm.registerAdapter(['test'], adapter)
    ctx.baseUrl = import.meta.url
    await ctx.plugin(Loader, { baseUrl: import.meta.url }).await()
    ctx.loader.builtins.include = Include
    const composition = join(root, 'agent.mjs')
    await writeFile(composition, 'export default function () {}\n')
    await ctx.plugin(AgentPresets, { default: 'standard' }).await()
    for (const id of ['standard', 'minimal']) {
      await ctx.plugin(AgentPreset, { id, name: id === 'standard' ? '标准' : '极简', plugins: [{ name: pathToFileURL(composition).href }] }).await()
    }
    await ctx.plugin(Attachments, { dshHome: root }).await()
    await ctx.plugin(Commands).await()
    await ctx.plugin(UnusedShell).await()
    await ctx.plugin(Approval, { policy: 'ask' }).await()
    await ctx.plugin(PermissionPresets, { defaultPreset: 'workspace-write' }).await()
    // In-process route registry and owner Peer; this fixture never serves browser requests.
    new HostConnectionService(ctx, [], {} as ConstructorParameters<typeof HostConnectionService>[2])
    await ctx.plugin(FileUploads).await()
    await ctx.plugin(LocalFileSystem).await()
    if (options.subagents || options.agentTeams) {
      await ctx.plugin(WorkingDirectory).await()
      await ctx.plugin(SubagentRuntime).await()
      await ctx.plugin(SubagentSpawn, { providerName: 'spawn' }).await()
      await ctx.plugin(SubagentTool, { provider: 'spawn', toolName: 'subagent' }).await()
    }
    if (options.agentTeams) await ctx.plugin(TeamService).await()
    await ctx.plugin(SessionController, { nativeOpen: false }).await()
    await ctx.plugin(UserQuestionService).await()
    await ctx.plugin(AskUserTool).await()
    await ctx.plugin(Remotes).await()
    ctx.tools.register(defineTool({
      name: 'danger',
      description: 'Touch a protected file; always asks for approval.',
      parameters: { target: { type: 'string', required: true, description: 'File to touch.' } },
      output: {
        schema: { type: 'object', additionalProperties: false, properties: { done: { type: 'boolean', required: true } } },
        render: (_args, value) => [{ type: 'text', text: value.done ? '已执行' : '已拒绝' }],
      },
      async execute(args, exec) {
        const outcome = await ctx.approval.request({ agent: exec.agent!, toolName: 'danger', reason: `修改 ${args.target}`, callId: exec.callId })
        return { done: outcome === 'allowed-once' }
      },
    }))
    const waits = { started: 0, stopped: 0 }
    ctx.commands.register({
      name: 'wait', description: 'Run until cancelled.',
      async handler({ signal }) {
        waits.started++
        await new Promise<void>(resolve => {
          if (signal.aborted) resolve()
          else signal.addEventListener('abort', () => resolve(), { once: true })
        })
        waits.stopped++
        return { kind: 'error', text: '已停止' }
      },
    })
    const acpHome = join(root, options.homeName ?? 'acp')
    await options.prepare?.(acpHome)
    // The built package, as DSH loads it; typed from the source so type checks run before the build.
    const plugin = await import(new URL('../../lib/index.js', import.meta.url).href) as typeof BridgePlugin
    await ctx.plugin(plugin, { home: acpHome }).await()
    await ready(acpHome)
    let disposed: Promise<void> | undefined
    const dispose = () => disposed ??= ctx.fiber.dispose().then(() => undefined)
    return { ctx, root, acpHome, workspace, adapter, waits, dispose,
      close: async () => { await dispose(); await rm(root, { recursive: true, force: true }) } }
  } catch (error) {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
    throw error
  }
}
