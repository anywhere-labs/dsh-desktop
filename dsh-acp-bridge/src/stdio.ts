#!/usr/bin/env node
/**
 * stdio ⇄ RPC bridge for ACP clients such as Zed.
 *
 * An ACP client starts this script and speaks newline-delimited JSON-RPC on
 * its stdin/stdout. The script finds a running DSH that loaded the plugin
 * (through the endpoint records), opens one MeshCall duplex call and forwards
 * every message unchanged in both directions. Stdout carries protocol messages
 * only; diagnostics go to stderr.
 */

import { randomBytes } from 'node:crypto'
import { once } from 'node:events'
import { createInterface } from 'node:readline'
import { MeshCallClient, type LogContext, type LogLevel, type RpcLogger } from 'meshcall'
import { processAlive, readRecords, validProof, type EndpointRecord } from './endpoint.js'
import { defaultHome, RPC_SERVICE, TOKEN_METADATA } from './paths.js'

interface Options { home: string, instance?: string, check: boolean, list: boolean }
type Message = Record<string, unknown>

const USAGE = `用法：dsh-acp-bridge [选项]

把 ACP 客户端（例如 Zed）的 stdio 接到正在运行的 DeepSeek Harness。
DSH 需要已启用插件 @agents-anywhere/dsh-acp-bridge。

选项：
  --instance <id>   连接指定的 DSH 实例（实例 ID 或其前缀）
  --list            列出可以连接的 DSH 实例
  --check           只检查连接，打印实例信息后退出
  --home <目录>     读取其他位置的实例记录（默认 ~/.agents-anywhere/dsh-acp）
  -h, --help        显示帮助
`

function fail(message: string): never {
  process.stderr.write(`dsh-acp-bridge: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { home: defaultHome(), check: false, list: false }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    const value = () => {
      const next = argv[++index]
      if (next === undefined || next.startsWith('--')) fail(`${argument} 需要一个参数`)
      return next
    }
    if (argument === '-h' || argument === '--help') { process.stdout.write(USAGE); process.exit(0) }
    else if (argument === '--check') options.check = true
    else if (argument === '--list') options.list = true
    else if (argument === '--instance') options.instance = value()
    else if (argument === '--home') options.home = value()
    else fail(`未知选项 ${argument}，运行 --help 查看用法`)
  }
  return options
}

/** MeshCall diagnostics stay on stderr, and only when asked for. */
class StderrLogger implements RpcLogger {
  constructor(private readonly verbose: boolean, private readonly context: LogContext = {}) {}
  bind(context: LogContext): RpcLogger { return new StderrLogger(this.verbose, { ...this.context, ...context }) }
  log(level: LogLevel, message: string, ...args: unknown[]): void {
    if (!this.verbose && level !== 'error') return
    process.stderr.write(`dsh-acp-bridge [${level}] ${message} ${args.map(arg => arg instanceof Error ? arg.message : JSON.stringify(arg)).join(' ')}\n`)
  }
  debug(message: string, ...args: unknown[]): void { this.log('debug', message, ...args) }
  info(message: string, ...args: unknown[]): void { this.log('info', message, ...args) }
  warning(message: string, ...args: unknown[]): void { this.log('warning', message, ...args) }
  error(message: string, ...args: unknown[]): void { this.log('error', message, ...args) }
}

const logger = new StderrLogger(Boolean(process.env.DSH_ACP_DEBUG))

function metadata(record: EndpointRecord) { return { [TOKEN_METADATA]: record.token } }

interface Connected { record: EndpointRecord, client: MeshCallClient, info: Message }

/** The newest live instance that answers; older ones are tried when it does not. */
async function connect(options: Options): Promise<Connected> {
  const records = (await readRecords(options.home)).map(stored => stored.record)
    .filter(record => processAlive(record.pid))
    .filter(record => options.instance === undefined || record.instanceId.startsWith(options.instance))
  if (!records.length) {
    fail(options.instance === undefined
      ? '没有找到正在运行的 DSH。请启动 DSH，并在 DSH 中启用插件 @agents-anywhere/dsh-acp-bridge。'
      : `没有找到实例 ${options.instance}，运行 --list 查看可以连接的实例。`)
  }
  let lastError: unknown
  for (const record of records) {
    const client = new MeshCallClient(record.endpoint, `dsh-acp-stdio-${process.pid}`, { logger, retry: false })
    try {
      // The endpoint proves it wrote this record before the token leaves this process.
      const nonce = randomBytes(24).toString('base64url')
      const hello = await client.unary<Message, Message>(RPC_SERVICE, 'hello', { nonce }, { timeoutMs: 5_000 })
      if (!validProof(record.token, nonce, hello.proof)) throw new Error(`实例 ${record.instanceId} 无法证明身份，已跳过`)
      const info = await client.unary<Message, Message>(RPC_SERVICE, 'info', {}, { metadata: metadata(record), timeoutMs: 5_000 })
      return { record, client, info }
    } catch (error) {
      lastError = error
      await client.close().catch(() => undefined)
    }
  }
  fail(`无法连接 DSH：${lastError instanceof Error ? lastError.message : String(lastError)}`)
}

async function list(options: Options): Promise<void> {
  const records = (await readRecords(options.home)).map(stored => stored.record).filter(record => processAlive(record.pid))
  if (!records.length) { process.stdout.write('没有正在运行的 DSH 实例。\n'); return }
  for (const record of records) {
    process.stdout.write(`${record.instanceId}  pid ${record.pid}  启动于 ${record.startedAt}  DSH ${record.runtimeVersion ?? '未知'}  插件 ${record.bridgeVersion}\n`)
  }
}

async function write(line: string): Promise<void> {
  if (!process.stdout.write(line)) await once(process.stdout, 'drain')
}

const PARSE_ERROR = { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }

/** Forward messages until either side ends. Resolves with the process exit code. */
async function forward({ record, client }: Connected): Promise<number> {
  const call = client.duplex<Message, Message, Message>(RPC_SERVICE, 'connect', {}, { metadata: metadata(record) })
  let serverEnded = false
  const output = (async () => {
    for await (const message of call) await write(`${JSON.stringify(message)}\n`)
  })().then(() => { serverEnded = true }, (error: unknown) => {
    serverEnded = true
    process.stderr.write(`dsh-acp-bridge: DSH 连接中断：${error instanceof Error ? error.message : String(error)}\n`)
    throw error
  })
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity })
  // DSH ending the call ends the agent: stop reading so the client sees EOF.
  void output.finally(() => lines.close()).catch(() => undefined)
  try {
    for await (const line of lines) {
      if (serverEnded) break
      if (!line.trim()) continue
      let message: unknown
      try { message = JSON.parse(line) } catch { await write(`${JSON.stringify(PARSE_ERROR)}\n`); continue }
      if (message === null || typeof message !== 'object' || Array.isArray(message)) {
        await write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid Request' } })}\n`)
        continue
      }
      await call.send(message as Message)
    }
    if (!serverEnded) await call.closeSend()
  } catch (error) {
    if (!serverEnded) process.stderr.write(`dsh-acp-bridge: 发送失败：${error instanceof Error ? error.message : String(error)}\n`)
  }
  try {
    await output
    return 0
  } catch {
    return 1
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2))
  if (options.list) { await list(options); return }
  const connected = await connect(options)
  if (options.check) {
    process.stdout.write(`${JSON.stringify({ instanceId: connected.record.instanceId, pid: connected.record.pid, ...connected.info }, null, 2)}\n`)
    await connected.client.close()
    return
  }
  const stop = () => { void connected.client.close().finally(() => process.exit(0)) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const code = await forward(connected)
  await connected.client.close().catch(() => undefined)
  process.exit(code)
}

main().catch((error: unknown) => fail(error instanceof Error ? error.message : String(error)))
