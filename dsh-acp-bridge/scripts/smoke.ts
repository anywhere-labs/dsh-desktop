/**
 * Manual checks against a running DSH that loaded the plugin. Development only; not published.
 *
 *   yarn smoke rpc   the plugin's MeshCall endpoint: endpoint records, endpoint proof, token checks, info,
 *                    one ACP message over the duplex call, and the public client with the ACP SDK
 *   yarn smoke acp   an ACP client on the generated launcher, started the way an editor starts it
 */

import {
  client as acpClient, methods, ndJsonStream, type ContentBlock, type RequestPermissionRequest, type RequestPermissionResponse,
  type SessionConfigOption, type SessionNotification, type ToolCallContent,
} from '@agentclientprotocol/sdk'
import { MeshCallClient } from 'meshcall'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { Readable, Writable } from 'node:stream'
import { setTimeout as delay } from 'node:timers/promises'
import { parseArgs } from 'node:util'
import { connectDsh } from '../src/client.js'
import { processAlive, readRecords, validProof } from '../src/endpoint.js'
import { defaultHome, endpointsDirectory, launcherPath, RPC_SERVICE, TOKEN_METADATA } from '../src/paths.js'

type Message = Record<string, unknown>
type Approve = 'ask' | 'allow' | 'reject'

const USAGE = `用法：yarn smoke <rpc|acp> [选项]

rpc  检查插件的 MeshCall 端点：端点记录、身份证明、令牌校验、info，
     再直接经 duplex 调用收发一条 ACP 消息（不经过启动脚本），
     最后用公开的客户端接口和 ACP SDK 连一次
acp  像编辑器一样启动生成的启动脚本，作为 ACP 客户端操作 DSH：
     initialize → session/list、session/new 或 session/load → 配置 → prompt

通用选项：
  --home <目录>          端点记录和启动脚本所在目录（默认 ~/.agents-anywhere/dsh-acp）
acp 选项：
  --list                 只列出 DSH 的会话（给了 --cwd 时只列这个目录的）
  --cwd <目录>           会话的工作目录（默认运行命令的目录）
  --session <ID>         打开已有会话并回放历史，不新建；工作目录从会话列表里查
  --set <配置项=值>      发送前修改配置，可重复，例如 --set model=<provider>/<model>
  --prompt <文本>        发送一条消息，可以重复：第二条起不等前一条结束就发，在 DSH 里排队；
                         不加则只建会话、打印配置，DSH 里不会留下会话
  --approve <ask|allow|reject>  DSH 请求批准时的回答（在终端里默认 ask，否则 reject）
  --cancel <秒>          发送后多少秒取消（session/cancel，排队的消息一起取消）
  --follow               结束后保持连接，继续显示这个会话的更新，Ctrl+C 退出
`

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fields(value: unknown): Message {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Message : {}
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([promise, new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} 超过 ${ms / 1000} 秒没有结果`)), ms) })])
  } finally {
    clearTimeout(timer)
  }
}

/** The rejection message, or undefined when the operation succeeded. */
async function rejection(promise: Promise<unknown>): Promise<string | undefined> {
  try { await promise; return undefined } catch (error) { return message(error) }
}

// ── rpc ─────────────────────────────────────────────────────────────────────

async function rpc(home: string): Promise<number> {
  const stored = await readRecords(home)
  console.log(`端点记录：${endpointsDirectory(home)}`)
  if (!stored.length) {
    console.error('没有端点记录：DSH 没有加载插件，或者 --home 不对。')
    return 1
  }
  for (const { record } of stored) {
    console.log(`  ${record.instanceId}  pid ${record.pid}${processAlive(record.pid) ? '' : '（已退出）'}  启动于 ${record.startedAt}  DSH ${record.runtimeVersion ?? '未知'}  插件 ${record.bridgeVersion}`)
  }
  const live = stored.find(item => processAlive(item.record.pid))
  if (!live) {
    console.error('记录里的 DSH 进程都已退出。')
    return 1
  }
  const { path, record } = live
  let failed = 0
  const check = (passed: boolean, label: string, detail?: string) => {
    if (!passed) failed++
    console.log(`${passed ? '✔' : '✘'} ${label}${detail ? `：${detail}` : ''}`)
  }
  console.log(`\n检查最新的实例 ${record.instanceId}（${'unixPath' in record.endpoint ? record.endpoint.unixPath : record.endpoint.pipe}）`)
  if (process.platform !== 'win32') {
    const mode = (await stat(path)).mode & 0o777
    check((mode & 0o077) === 0, '端点记录只有本人可读', mode.toString(8))
    if ('unixPath' in record.endpoint) {
      const socket = (await stat(record.endpoint.unixPath)).mode & 0o777
      check((socket & 0o077) === 0, 'socket 只有本人可连', socket.toString(8))
    }
  }
  const client = new MeshCallClient(record.endpoint, `dsh-acp-smoke-${process.pid}`, { retry: false })
  const metadata = { [TOKEN_METADATA]: record.token }
  try {
    const nonce = randomBytes(24).toString('base64url')
    const hello = await client.unary<Message, Message>(RPC_SERVICE, 'hello', { nonce }, { timeoutMs: 5_000 })
    check(validProof(record.token, nonce, hello.proof), 'hello：端点证明自己持有记录里的令牌，令牌没有发出去')
    const anonymous = await rejection(client.unary(RPC_SERVICE, 'info', {}, { timeoutMs: 5_000 }))
    check(anonymous !== undefined, 'info 不带令牌被拒绝', anonymous)
    const forged = await rejection(client.unary(RPC_SERVICE, 'info', {},
      { metadata: { [TOKEN_METADATA]: randomBytes(32).toString('base64url') }, timeoutMs: 5_000 }))
    check(forged !== undefined, 'info 带错误令牌被拒绝', forged)
    const info = await client.unary<Message, Message>(RPC_SERVICE, 'info', {}, { metadata, timeoutMs: 5_000 })
    check(info.acpProtocolVersion === 1, 'info 带令牌返回插件状态', JSON.stringify(info))
    const interactions = fields(info.interactions)
    check(interactions.approvals === true && interactions.questions === true, '审批和提问已接入 DSH', JSON.stringify(interactions))

    const denied = client.duplex<Message, Message, Message>(RPC_SERVICE, 'connect', {}, {})
    const refused = await rejection(withTimeout(denied[Symbol.asyncIterator]().next(), 10_000, 'connect'))
    check(refused !== undefined, 'connect 不带令牌被拒绝', refused)

    const call = client.duplex<Message, Message, Message>(RPC_SERVICE, 'connect', {}, { metadata })
    const output = call[Symbol.asyncIterator]()
    await call.send({ jsonrpc: '2.0', id: 1, method: 'initialize',
      params: { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-acp-smoke', version: '1.0.0' } } })
    let reply: Message | undefined
    while (reply?.id !== 1) {
      const next = await withTimeout(output.next(), 10_000, 'initialize')
      if (next.done) throw new Error('DSH 没有回答就结束了连接')
      reply = next.value
    }
    const result = fields(reply.result)
    check(result.protocolVersion === 1, 'connect 经 duplex 调用收发 ACP 消息（initialize）', JSON.stringify(result.agentInfo))
    await call.closeSend()
    const ended = await rejection(withTimeout((async () => { while (!(await output.next()).done) { /* drain */ } })(), 10_000, '关闭连接'))
    check(ended === undefined, '客户端结束发送后，DSH 正常结束这条 ACP 连接', ended)
  } catch (error) {
    check(false, 'RPC 调用失败', message(error))
  } finally {
    await client.close().catch(() => undefined)
  }
  // The public client other programs use, with the ACP SDK on its stream.
  try {
    const dsh = await connectDsh({ home, instance: record.instanceId })
    try {
      const connection = acpClient({ name: 'dsh-acp-smoke' }).connect(dsh.openAcpStream())
      const initialized = await withTimeout(connection.agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} }), 10_000, 'initialize')
      check(initialized.protocolVersion === 1, '公开客户端接口（connectDsh 加 ACP SDK）连上 DSH 并完成 initialize',
        `契约版本 ${dsh.info.version}，插件 ${dsh.info.bridgeVersion}`)
      connection.close()
    } finally {
      await dsh.close()
    }
  } catch (error) {
    check(false, '公开客户端接口连接失败', message(error))
  }
  console.log(failed ? `\n${failed} 项未通过。` : '\n全部通过。')
  return failed ? 1 : 0
}

// ── acp ─────────────────────────────────────────────────────────────────────

const LABELS: Record<string, string> = { user_message_chunk: '【用户】', agent_thought_chunk: '【思考】', agent_message_chunk: '【回复】' }

function contentText(block: ContentBlock): string {
  switch (block.type) {
    case 'text': return block.text
    case 'image': return `[图片 ${block.mimeType}]`
    case 'resource_link': return `[链接 ${block.uri}]`
    default: return `[${block.type}]`
  }
}

function preview(content: readonly ToolCallContent[] | null | undefined): string {
  const first = content?.[0]
  if (!first) return ''
  const text = first.type === 'content' ? contentText(first.content) : first.type === 'diff' ? `改动 ${first.path}` : `终端 ${first.terminalId}`
  const line = text.replaceAll(/\s+/gu, ' ').trim()
  return line ? `：${line.length > 160 ? `${line.slice(0, 160)}…` : line}` : ''
}

function configSummary(options: readonly SessionConfigOption[]): string {
  return options.map(option => `${option.id}=${String(option.currentValue)}`).join('，') || '（无）'
}

/** Session updates as readable terminal output; streamed text is written as it arrives. */
class Output {
  private kind: string | undefined
  private atLineStart = true
  readonly titles = new Map<string, string>()

  private write(text: string): void {
    if (!text) return
    process.stdout.write(text)
    this.atLineStart = text.endsWith('\n')
  }

  /** A line of its own, after whatever text was streaming. */
  note(text: string): void {
    if (!this.atLineStart) this.write('\n')
    this.kind = undefined
    this.write(`${text}\n`)
  }

  end(): void {
    if (!this.atLineStart) this.write('\n')
    this.kind = undefined
  }

  update({ update }: SessionNotification): void {
    switch (update.sessionUpdate) {
      case 'user_message_chunk':
      case 'agent_thought_chunk':
      case 'agent_message_chunk':
        if (this.kind !== update.sessionUpdate) {
          this.note(LABELS[update.sessionUpdate]!)
          this.kind = update.sessionUpdate
        }
        this.write(contentText(update.content))
        break
      case 'tool_call':
        this.titles.set(update.toolCallId, update.title)
        this.note(`[工具] ${update.title}（${update.kind ?? 'other'}，${update.status ?? 'pending'}）`)
        break
      case 'tool_call_update':
        if (update.status) this.note(`[工具 ${update.status}] ${this.titles.get(update.toolCallId) ?? update.toolCallId}${preview(update.content)}`)
        break
      case 'available_commands_update': {
        const names = update.availableCommands.map(command => `/${command.name}`)
        this.note(`[斜杠命令] ${names.length} 个：${names.slice(0, 12).join(' ')}${names.length > 12 ? ' …' : ''}`)
        break
      }
      case 'config_option_update':
        this.note(`[配置变化] ${configSummary(update.configOptions)}`)
        break
      case 'session_info_update':
        if (update.title) this.note(`[标题] ${update.title}`)
        break
      case 'usage_update':
        this.note(`[上下文] 已用 ${update.used} / ${update.size} tokens`)
        break
      case 'plan': {
        const marks: Record<string, string> = { completed: '✓', in_progress: '▶', pending: '○' }
        this.note(update.entries.length ? `[计划] ${update.entries.map(entry => `${marks[entry.status] ?? '·'}${entry.content}`).join(' / ')}` : '[计划] 已清空')
        break
      }
      default:
        this.note(`[${update.sessionUpdate}]`)
    }
  }
}

async function permission(params: RequestPermissionRequest, signal: AbortSignal, mode: Approve, output: Output): Promise<RequestPermissionResponse> {
  const title = params.toolCall.title ?? output.titles.get(params.toolCall.toolCallId) ?? params.toolCall.toolCallId
  // DSH questions reach clients without forms as permission requests on cards of their own.
  const kind = params.toolCall.toolCallId.startsWith('question:') ? '请选择' : '请求批准'
  output.note(`[${kind}] ${title}；选项：${params.options.map(option => option.name).join(' / ')}`)
  if (params.toolCall.title === undefined && !output.titles.has(params.toolCall.toolCallId)) {
    // ACP clients look the card up by ID; one that has not arrived yet leaves the request without a tool to show.
    output.note('⚠ 审批请求比它的工具卡片先到，编辑器可能找不到这张卡片')
  }
  const pick = (kind: 'allow_once' | 'reject_once'): RequestPermissionResponse => {
    const option = params.options.find(item => item.kind === kind)
    return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } }
  }
  if (mode === 'allow') { output.note(kind === '请选择' ? '→ 自动选第一项' : '→ 自动允许一次'); return pick('allow_once') }
  if (mode === 'reject') { output.note(kind === '请选择' ? '→ 不选，交给 DSH' : '→ 自动拒绝'); return kind === '请选择' ? { outcome: { outcome: 'cancelled' } } : pick('reject_once') }
  const prompt = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = await prompt.question('允许一次吗？[y/N] ', { signal })
    return pick(/^y/iu.test(answer.trim()) ? 'allow_once' : 'reject_once')
  } catch {
    output.note('→ 请求已撤回（DSH 里已经回答了）')
    return { outcome: { outcome: 'cancelled' } }
  } finally {
    prompt.close()
  }
}

interface AcpOptions {
  home: string
  list: boolean
  cwd: string
  cwdGiven: boolean
  session: string | undefined
  set: string[]
  prompts: string[]
  approve: Approve
  cancel: number | undefined
  follow: boolean
}

async function acp(options: AcpOptions): Promise<number> {
  const launcher = launcherPath(options.home)
  if (!existsSync(launcher)) {
    console.error(`没有找到启动脚本 ${launcher}：DSH 还没有加载过插件，或者 --home 不对。`)
    return 1
  }
  console.log(`启动 ${launcher}`)
  const child = spawn(launcher, options.home === defaultHome() ? [] : ['--home', options.home],
    { stdio: ['pipe', 'pipe', 'inherit'], shell: process.platform === 'win32' })
  const exited = new Promise<number | null>(resolve => child.once('exit', code => resolve(code)))
  /** Requests fail at once when the launcher exits, for example because no DSH is running. */
  const call = <T>(request: Promise<T>): Promise<T> =>
    Promise.race([request, exited.then(code => { throw new Error(`启动脚本已退出（退出码 ${code}），原因见上面的输出`) })])
  const output = new Output()
  const connection = acpClient({ name: 'dsh-acp-smoke' })
    .onNotification(methods.client.session.update, ({ params }) => { output.update(params) })
    .onRequest(methods.client.session.requestPermission, ({ params, signal }) => permission(params, signal, options.approve, output))
    .connect(ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(child.stdout) as ReadableStream<Uint8Array>))
  try {
    const initialized = await call(connection.agent.request(methods.agent.initialize,
      { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'dsh-acp-smoke', version: '1.0.0' } }))
    const capabilities = initialized.agentCapabilities
    console.log(`✔ initialize：${initialized.agentInfo?.title ?? initialized.agentInfo?.name ?? '?'} ${initialized.agentInfo?.version ?? ''}，ACP ${initialized.protocolVersion}`
      + `，加载会话 ${capabilities?.loadSession ? '是' : '否'}，图片 ${capabilities?.promptCapabilities?.image ? '是' : '否'}`)

    if (options.list) {
      const listed = await call(connection.agent.request(methods.agent.session.list, options.cwdGiven ? { cwd: options.cwd } : {}))
      console.log(`✔ session/list：${listed.sessions.length} 个会话${listed.nextCursor ? '（还有下一页）' : ''}`)
      for (const session of listed.sessions) console.log(`  ${session.sessionId}  ${session.updatedAt ?? ''}  ${session.cwd}  ${session.title ?? ''}`)
      return 0
    }

    let sessionId: string
    let config: readonly SessionConfigOption[]
    if (options.session !== undefined) {
      let cwd = options.cwd
      if (!options.cwdGiven) {
        const listed = await call(connection.agent.request(methods.agent.session.list, {}))
        const found = listed.sessions.find(session => session.sessionId === options.session)
        if (!found) throw new Error(`会话列表的第一页里没有 ${options.session}，请用 --cwd 指定它的工作目录`)
        cwd = found.cwd
      }
      const loaded = await call(connection.agent.request(methods.agent.session.load, { sessionId: options.session, cwd, mcpServers: [] }))
      output.end()
      sessionId = options.session
      config = loaded.configOptions ?? []
      console.log(`✔ session/load：已回放 ${sessionId} 的历史（工作目录 ${cwd}）`)
    } else {
      const created = await call(connection.agent.request(methods.agent.session.new, { cwd: options.cwd, mcpServers: [] }))
      sessionId = created.sessionId
      config = created.configOptions ?? []
      console.log(`✔ session/new：${sessionId}（工作目录 ${options.cwd}）`)
    }
    console.log(`  配置：${configSummary(config)}`)

    for (const entry of options.set) {
      const separator = entry.indexOf('=')
      if (separator <= 0) throw new Error(`--set 需要「配置项=值」：${entry}`)
      const configId = entry.slice(0, separator), value = entry.slice(separator + 1)
      const kind = config.find(option => option.id === configId)?.type
      const changed = await call(connection.agent.request(methods.agent.session.setConfigOption, kind === 'boolean'
        ? { sessionId, configId, type: 'boolean', value: value === 'true' || value === 'on' }
        : { sessionId, configId, value }))
      config = changed.configOptions
      console.log(`✔ session/set_config_option ${configId}=${value}\n  配置：${configSummary(config)}`)
    }

    let failed = false
    if (options.prompts.length) {
      const started = Date.now()
      const many = options.prompts.length > 1
      // Sent one after another without waiting: from the second on, each waits in the DSH queue.
      const running = options.prompts.map((text, index) => {
        const label = many ? `第 ${index + 1} 条` : '这一轮'
        console.log(`→ session/prompt${many ? `（${label}）` : ''}：${text}`)
        return call(connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })).then(response => {
          const usage = response.usage ? `，输入 ${response.usage.inputTokens} / 输出 ${response.usage.outputTokens} tokens` : ''
          output.note(`✔ ${label}结束：stopReason=${response.stopReason}，用时 ${((Date.now() - started) / 1_000).toFixed(1)} 秒${usage}`)
        }, (error: unknown) => {
          failed = true
          output.note(`✘ ${label}出错：${message(error)}`)
        })
      })
      const cancel = options.cancel === undefined ? undefined : setTimeout(() => {
        output.note(`→ session/cancel（发送 ${options.cancel} 秒后）`)
        void connection.agent.notify(methods.agent.session.cancel, { sessionId }).catch(() => undefined)
      }, options.cancel * 1_000)
      try {
        await Promise.all(running)
      } finally {
        clearTimeout(cancel)
      }
    }
    console.log(!options.prompts.length && options.session === undefined
      ? `会话 ID：${sessionId}（还没发消息，DSH 里不会出现这个会话；加 --prompt 发一条）`
      : `会话 ID：${sessionId}，在 DSH 的侧边栏里可以找到它`)

    if (options.follow) {
      console.log('保持连接中：DSH 里这个会话的新消息、审批会显示在这里，Ctrl+C 退出。')
      await Promise.race([new Promise<void>(resolve => process.once('SIGINT', () => resolve())), exited])
    }
    return failed ? 1 : 0
  } catch (error) {
    output.end()
    console.error(`✘ ${message(error)}`)
    return 1
  } finally {
    child.stdin.end()
    await Promise.race([exited, delay(5_000)])
    child.kill()
  }
}

// ── main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      home: { type: 'string' },
      list: { type: 'boolean', default: false },
      cwd: { type: 'string' },
      session: { type: 'string' },
      set: { type: 'string', multiple: true, default: [] },
      prompt: { type: 'string', multiple: true, default: [] },
      approve: { type: 'string' },
      cancel: { type: 'string' },
      follow: { type: 'boolean', default: false },
      help: { type: 'boolean', short: 'h', default: false },
    },
  })
  const command = positionals[0]
  if (values.help || command === undefined) {
    process.stdout.write(USAGE)
    return values.help ? 0 : 1
  }
  // Yarn runs scripts in the package directory; INIT_CWD is where the command was typed.
  const invoked = process.env.INIT_CWD ?? process.cwd()
  const home = resolve(invoked, values.home ?? defaultHome())
  if (command === 'rpc') return rpc(home)
  if (command !== 'acp') {
    console.error(`未知的子命令 ${command}`)
    process.stdout.write(USAGE)
    return 1
  }
  const approve = values.approve ?? (process.stdin.isTTY ? 'ask' : 'reject')
  if (approve !== 'ask' && approve !== 'allow' && approve !== 'reject') throw new Error('--approve 只能是 ask、allow 或 reject')
  const cancel = values.cancel === undefined ? undefined : Number(values.cancel)
  if (cancel !== undefined && !(cancel >= 0)) throw new Error('--cancel 需要秒数')
  return acp({
    home, list: values.list, cwd: resolve(invoked, values.cwd ?? '.'), cwdGiven: values.cwd !== undefined,
    session: values.session, set: values.set, prompts: values.prompt, approve, cancel, follow: values.follow,
  })
}

main().then(code => process.exit(code), (error: unknown) => {
  console.error(`✘ ${message(error)}`)
  process.exit(1)
})
