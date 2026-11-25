#!/usr/bin/env node
/**
 * stdio ⇄ RPC bridge for ACP applications, scripts and automation tools.
 *
 * An ACP client starts this script and speaks newline-delimited JSON-RPC on
 * its stdin/stdout. The script reaches a running DSH that loaded the plugin
 * through the public RPC client (client.ts), opens one ACP connection on it
 * and forwards every message unchanged in both directions. Stdout carries
 * protocol messages only; diagnostics go to stderr.
 */

import { join } from 'node:path'
import { realpath } from 'node:fs/promises'
import { withStartupLock } from './startup-lock.js'
import { cliLaunch } from './cli-launch.js'
import { readStartup, writePrivateJson } from './startup-settings.js'
import { once } from 'node:events'
import { createRequire } from 'node:module'
import { createInterface } from 'node:readline'
import type { LogContext, LogLevel, RpcLogger } from 'meshcall'
import { applicationId, applications, selectApplication, applicationLaunch, runningApplications } from './applications.js'
import { desktopLaunch, startDesktop, waitForDsh, type DesktopLaunch, type StartedDesktop } from './autostart.js'
import { connectDsh, DshAcpError, listInstances, type AcpMessage, type DshConnection } from './client.js'
import { defaultHome } from './paths.js'

interface Options { app?: string, home: string, instance?: string, check: boolean, list: boolean, start: boolean, startTimeout: number }

const PLUGIN = '@agents-anywhere/dsh-acp-bridge'
const DEFAULT_START_TIMEOUT = 90

const USAGE = `用法：dsh-acp-bridge [选项]

通过 stdio 将 ACP 应用、脚本和自动化工具连接到 DeepSeek Harness。
DSH 需要已启用插件 ${PLUGIN}。DSH Desktop 没有运行时，
根据面板的默认应用设置启动，等插件就绪后再连接。官方应用在 Windows 上
隐藏窗口启动，在 macOS 上会显示窗口。

选项：
  --app <应用>           固定应用：next、beta、official 或面板中的应用 ID
  --instance <id>        连接指定的 DSH 实例（实例 ID 或其前缀）
  --list                 列出可以连接的 DSH 实例
  --check                只检查连接，打印实例信息后退出
  --no-start             DSH 没有运行时直接报错，不启动它
  --start-timeout <秒>   启动 DSH 后最多等待多少秒（默认 ${DEFAULT_START_TIMEOUT}）
  --home <目录>          读取其他位置的实例记录（默认 ~/.agents-anywhere/dsh-acp）
  --version              显示插件版本
  -h, --help             显示帮助
`

/** The plugin version, as `--version` prints it; the package resolves itself. */
function version(): string {
  try { return String(createRequire(import.meta.url)(`${PLUGIN}/package.json`).version) } catch { return '0.0.0' }
}

function fail(message: string): never {
  process.stderr.write(`dsh-acp-bridge: ${message}\n`)
  process.exit(1)
}

function parseArgs(argv: readonly string[]): Options {
  const options: Options = { home: defaultHome(), check: false, list: false, start: true, startTimeout: DEFAULT_START_TIMEOUT }
  for (let index = 0; index < argv.length; index++) {
    const argument = argv[index]!
    const value = () => {
      const next = argv[++index]
      if (next === undefined || next.startsWith('--')) fail(`${argument} 需要一个参数`)
      return next
    }
    if (argument === '-h' || argument === '--help') { process.stdout.write(USAGE); process.exit(0) }
    // One line, the version alone: ACP clients read the last line of `--version` as the agent's version.
    else if (argument === '--version') { process.stdout.write(`${version()}\n`); process.exit(0) }
    else if (argument === '--check') options.check = true
    else if (argument === '--list') options.list = true
    else if (argument === '--no-start') options.start = false
    else if (argument === '--start-timeout') {
      const seconds = Number(value())
      if (!Number.isFinite(seconds) || seconds <= 0) fail('--start-timeout 需要一个正数（秒）')
      options.startTimeout = seconds
    }
    else if (argument === '--app') options.app = value()
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

// meshcall 0.3.0 can report a call that failed while it was still being opened as an unhandled
// rejection, although the caller awaits the same failure (anywhere-labs/deepseek-harness-desktop#1574).
// Every path here awaits its own errors, so a stray one must not end the editor's agent process.
process.on('unhandledRejection', reason => {
  process.stderr.write(`dsh-acp-bridge: 忽略了一个未处理的异步错误：${reason instanceof Error ? reason.message : String(reason)}\n`)
})

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** The newest live instance that proves itself; the reason in Chinese when there is none. */
async function connect(options: Options): Promise<DshConnection> {
  const settings = await readStartup(options.home)
  const apps = await applications(options.home)
  const target = selectApplication(apps, options.app, settings.defaultApp)
  const scoped = target ? settings.applications?.[target.id] : undefined
  if (!process.argv.includes('--start-timeout')) options.startTimeout = settings.timeoutSeconds
  const route = target && scoped?.mode === 'cli' ? { ...target, dshHome: scoped.dshHome,
    profileDirectory: await realpath(join(scoped.dshHome, 'profiles', scoped.profile)),
    id: applicationId(target.launcher.runtime, scoped.dshHome, await realpath(join(scoped.dshHome, 'profiles', scoped.profile))) } : target
  let strict = Boolean(options.app)
  let profileDirectory: string | undefined
  const attempt = () => connectDsh({ home: options.home, peerId: `dsh-acp-stdio-${process.pid}`, logger,
    ...(route && !profileDirectory ? { application: route, strictApplication: strict } : {}),
    ...(options.instance === undefined ? {} : { instance: options.instance }),
    ...(profileDirectory ? { profileDirectory } : {}) })
  try { return await attempt() } catch (error) {
    if (!options.start || options.check || options.instance !== undefined || !settings.enabled
      || !(error instanceof DshAcpError) || error.code !== 'no-instance') failConnect(error, options)
  }
  return withStartupLock(options.home, options.startTimeout * 1000, async () => {
    try { return await attempt() } catch (error) {
      if (!(error instanceof DshAcpError) || error.code !== 'no-instance') throw error
    }
    // Even a pinned editor must not open a second DSH beside another running application.
    const live = await listInstances({ home: options.home })
    const running = await runningApplications(apps)
    if (live.length || running.length) {
      process.stderr.write('dsh-acp-bridge: DSH 已运行，等待目标插件就绪；不会启动第二个应用。\n')
      return waitForDsh(attempt, error => error instanceof DshAcpError, { timeoutMs: options.startTimeout * 1000 })
    }
    // A legacy CLI setting without an application/data-directory binding must not inherit the last writer's home.
    if (settings.mode === 'cli' && !scoped) throw new Error('Please select and save the startup application in the ACP panel again')
    if (!target && settings.defaultApp) throw new Error('默认应用已不可用，请打开另一个 DSH 并在 ACP 面板选择默认应用。')
    const launch = target ? scoped?.mode === 'cli'
      ? await cliLaunch(target.launcher.runtime, process.platform, scoped.dshHome, scoped.profile)
      : applicationLaunch(target)
      : desktopLaunch(process.execPath, process.platform, Boolean(process.versions.electron))
    if (!launch) throw new Error('没有找到正在运行的 DSH。请打开 DSH 并启用 ACP 插件。')
    strict = Boolean(target)
    if (target && scoped?.mode === 'cli') profileDirectory = await realpath(join(scoped.dshHome, 'profiles', scoped.profile))
    if (target && !target.background && scoped?.mode !== 'cli' && !launch.hiddenStart) process.stderr.write('dsh-acp-bridge: 官方桌面端启动时可能显示窗口。\n')
    return startAndConnect(options, launch, attempt)
  })
}

/** Start DSH Desktop in the background and connect once the plugin in it is ready. */
async function startAndConnect(options: Options, launch: DesktopLaunch, attempt: () => Promise<DshConnection>): Promise<DshConnection> {
  const record = (ok: boolean, message: string) => writePrivateJson(options.home, 'last-start.json', { at: new Date().toISOString(), ok, message }).catch(() => {})
  process.stderr.write(`dsh-acp-bridge: 没有正在运行的 DSH，正在后台启动 ${launch.name}，最多等待 ${options.startTimeout} 秒…\n`)
  let started: StartedDesktop
  try {
    started = await startDesktop(launch)
  } catch (error) {
    await record(false, `Cannot start ${launch.name}: ${errorText(error)}`)
    throw new Error(`无法启动 ${launch.name}：${errorText(error)}。请手动打开 DSH，并在 DSH 中启用插件 ${PLUGIN}。`)
  }
  if (started.notHidden !== undefined) process.stderr.write(`dsh-acp-bridge: 无法隐藏启动 ${launch.name}（${started.notHidden}），已直接启动，可能显示窗口。\n`)
  try {
    const connection = await waitForDsh(attempt, error => error instanceof DshAcpError, { timeoutMs: options.startTimeout * 1_000 })
    await record(true, `${launch.name}: ACP connected`)
    return connection
  } catch (error) {
    if (launch.environment?.ELECTRON_RUN_AS_NODE === '1') started.child?.kill('SIGTERM')
    await record(false, `${launch.name}: ACP did not become ready within ${options.startTimeout}s`)
    if (error instanceof DshAcpError && error.code === 'no-instance') {
      throw new Error(`已启动 ${launch.name}，但 ${options.startTimeout} 秒内没有等到插件就绪。请打开 ${launch.name} 查看：`
        + `当前 Profile 需要启用插件 ${PLUGIN}；DSH 正在首次设置、恢复或升级时，请先完成。`)
    }
    throw new Error(`无法连接 ${launch.name}：${errorText(error)}`)
  }
}

function failConnect(error: unknown, options: Options): never {
  if (!(error instanceof DshAcpError)) fail(`无法连接 DSH：${errorText(error)}`)
  if (error.code === 'no-instance') {
    fail(options.instance === undefined
      ? `没有找到正在运行的 DSH。请启动 DSH，并在 DSH 中启用插件 ${PLUGIN}。`
      : `没有找到实例 ${options.instance}，运行 --list 查看可以连接的实例。`)
  }
  const last = error.failures.at(-1)
  fail(`无法连接 DSH：${last?.reason === 'unproven' ? `实例 ${last.instanceId} 无法证明身份，已跳过` : errorText(last?.error ?? error)}`)
}

async function list(options: Options): Promise<void> {
  const records = await listInstances({ home: options.home })
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
async function forward(connection: DshConnection): Promise<number> {
  const call = connection.openAcpCall()
  let serverEnded = false
  const output = (async () => {
    for await (const message of call) await write(`${JSON.stringify(message)}\n`)
  })().then(() => { serverEnded = true }, (error: unknown) => {
    serverEnded = true
    process.stderr.write(`dsh-acp-bridge: DSH 连接中断：${errorText(error)}\n`)
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
      await call.send(message as AcpMessage)
    }
    if (!serverEnded) await call.closeSend()
  } catch (error) {
    if (!serverEnded) process.stderr.write(`dsh-acp-bridge: 发送失败：${errorText(error)}\n`)
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
  const connection = await connect(options)
  if (options.check) {
    process.stdout.write(`${JSON.stringify({ instanceId: connection.record.instanceId, ...connection.info }, null, 2)}\n`)
    await connection.close()
    return
  }
  const stop = () => { void connection.close().finally(() => process.exit(0)) }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  const code = await forward(connection)
  await connection.close().catch(() => undefined)
  process.exit(code)
}

main().catch((error: unknown) => fail(errorText(error)))
