/**
 * Starting DSH Desktop for the launcher when no DSH that loaded the plugin is running.
 *
 * The launcher runs on the executable of the DSH Desktop that wrote it (Electron in Node mode),
 * so that executable names the app to start. macOS starts the app through LaunchServices
 * (`open`): as a child of the editor it would count the editor as its responsible process,
 * which breaks Local Network access (anywhere-labs/deepseek-harness-desktop#1515). Windows and
 * Linux start the executable itself, detached, without this process's Node-mode variables.
 * DSH Desktop then starts with its tray only; releases without that argument open their window.
 *
 * An app without such a start (the official Desktop) is started by explorer on Windows, with its
 * first window hidden. Started by this process, it would inherit the editor's right to take the
 * foreground, and its hidden window would take keyboard focus from the editor seconds later.
 * Node built-ins only.
 */

import { execFile, spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
import { posix, win32 } from 'node:path'

/** DSH Desktop's argument for a start with the tray only, no window; a running instance leaves its windows alone. */
export const BACKGROUND_ARGUMENT = '--next-background'

/** How to start one DSH Desktop. */
export interface DesktopLaunch {
  /** The app's name, for messages. */
  readonly name: string
  readonly command: string
  readonly args: readonly string[]
  /** `open` exits once LaunchServices started the app; a directly started app is not waited for. */
  readonly waitForExit: boolean
  readonly environment?: NodeJS.ProcessEnv
  readonly cwd?: string
  /**
   * Hide the console of a process without windows of its own (Electron in Node mode). Never for an
   * app: Windows would hide the first window the app shows, such as Next/Beta's first tray click.
   */
  readonly windowsHide?: boolean
  /**
   * Windows: explorer starts `command`, without arguments, with its first window hidden, provided
   * explorer's environment gives the app `dshHome` as its data directory. Otherwise, or when explorer
   * cannot, the app is started directly with `environment`.
   */
  readonly hiddenStart?: { readonly dshHome: string }
}

/** The `.app` bundle whose main executable is `executable` (`…/Name.app/Contents/MacOS/Name`). */
export function appBundle(executable: string): string | undefined {
  const macos = posix.dirname(executable)
  const contents = posix.dirname(macos)
  const bundle = posix.dirname(contents)
  if (posix.basename(macos) !== 'MacOS' || posix.basename(contents) !== 'Contents' || !bundle.endsWith('.app')) return undefined
  return bundle
}

/**
 * The DSH Desktop this launcher belongs to.
 * @param executable - `process.execPath` of the launcher.
 * @param platform - Node platform.
 * @param electron - whether the launcher runs on Electron; a launcher on plain Node has no app to start.
 * @returns how to start it, or undefined when there is none.
 */
export function desktopLaunch(executable: string, platform: NodeJS.Platform, electron: boolean): DesktopLaunch | undefined {
  if (!electron) return undefined
  if (platform === 'darwin') {
    const bundle = appBundle(executable)
    if (bundle === undefined) return undefined
    // `-n` starts a new instance even when one runs: it hands the argument to the running one and exits.
    return { name: posix.basename(bundle, '.app'), command: 'open', args: ['-n', '-g', bundle, '--args', BACKGROUND_ARGUMENT], waitForExit: true }
  }
  const path = platform === 'win32' ? win32 : posix
  const base = path.basename(executable)
  return { name: platform === 'win32' ? base.replace(/\.exe$/iu, '') : base, command: executable, args: [BACKGROUND_ARGUMENT], waitForExit: false }
}

/** Variables that put Electron in Node mode or load code into Node: the app must start as itself. */
const NODE_MODE_VARIABLES = /^(?:ELECTRON_RUN_AS_NODE|ELECTRON_NO_ATTACH_CONSOLE|NODE_OPTIONS)$/iu

/** The environment of a directly started app: this one without the Node-mode variables. */
export function launchEnvironment(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(env).filter(([name]) => !NODE_MODE_VARIABLES.test(name)))
}

export type Spawn = (command: string, args: readonly string[], options: SpawnOptions) => ChildProcess

/** How a Windows PowerShell script ended; `code` is null when it did not start or did not finish. */
export interface ScriptResult {
  readonly code: number | null
  readonly stdout: string
  readonly stderr: string
}

export type RunPowerShell = (script: string, env: NodeJS.ProcessEnv) => Promise<ScriptResult>

/** Windows PowerShell 5.1, part of every supported Windows release; by path, so `PATH` cannot replace it. */
export function windowsPowerShell(env: NodeJS.ProcessEnv): string {
  const root = Object.entries(env).find(([name]) => name.toLowerCase() === 'systemroot')?.[1]
  return win32.join(root || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
}

/** Run a one-line script without a console window. Its output is read as UTF-8; keep it ASCII. */
export function runPowerShell(script: string, env: NodeJS.ProcessEnv): Promise<ScriptResult> {
  return new Promise(resolve => {
    execFile(windowsPowerShell(env), ['-NoProfile', '-NonInteractive', '-Command', script],
      { env, windowsHide: true, timeout: 30_000, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
        if (error === null) { resolve({ code: 0, stdout, stderr }); return }
        resolve({ code: typeof error.code === 'number' ? error.code : null, stdout,
          stderr: stderr || (error.killed ? 'no answer within 30 s' : error.message) })
      })
  })
}

/**
 * Explorer starts the app through the desktop's folder view (`ShellWindows.FindWindowSW` with SWC_DESKTOP 8 and
 * SWFO_NEEDDISPATCH 1, then `IShellDispatch2.ShellExecute` with SW_HIDE 0), so the app is explorer's child and
 * gets explorer's environment. First the script resolves the data directory that environment gives DSH: the
 * user's `DSH_HOME`, else the machine's, else `~\.dsh` (`~` expanded like DSH does). Exit 3: another directory;
 * exit 4: no desktop to ask. Inputs arrive as environment variables, never inside the script.
 */
const EXPLORER_START = [
  "$ErrorActionPreference = 'Stop'",
  "$configured = [Environment]::GetEnvironmentVariable('DSH_HOME', 'User')",
  "if ([string]::IsNullOrWhiteSpace($configured)) { $configured = [Environment]::GetEnvironmentVariable('DSH_HOME', 'Machine') }",
  "if ([string]::IsNullOrWhiteSpace($configured)) { $configured = Join-Path $env:USERPROFILE '.dsh' } elseif ($configured -eq '~') { $configured = $env:USERPROFILE } elseif ($configured.StartsWith('~/') -or $configured.StartsWith('~\\')) { $configured = Join-Path $env:USERPROFILE $configured.Substring(2) }",
  "if ([IO.Path]::GetFullPath($configured).TrimEnd('\\') -ne [IO.Path]::GetFullPath($env:DSH_ACP_START_HOME).TrimEnd('\\')) { exit 3 }",
  '$hwnd = 0',
  '$desktop = (New-Object -ComObject Shell.Application).Windows().FindWindowSW(0, $null, 8, [ref]$hwnd, 1)',
  'if ($null -eq $desktop) { exit 4 }',
  "$desktop.Document.Application.ShellExecute($env:DSH_ACP_START_FILE, '', $env:DSH_ACP_START_DIRECTORY, 'open', 0)",
  "[Console]::Out.WriteLine('started')",
].join('; ')

/** What starting the app did. */
export interface StartedDesktop {
  /** The process this launcher started: `open` or the app; none when explorer started the app. */
  readonly child?: ChildProcess
  /** Why explorer did not start the app hidden; it was then started directly and may show a window. */
  readonly notHidden?: string
}

export interface StartOptions {
  readonly spawn?: Spawn
  readonly env?: NodeJS.ProcessEnv
  readonly powershell?: RunPowerShell
}

/**
 * Start the app. Resolves once it was handed to the system; DSH is not ready yet.
 * @throws when the app cannot be started.
 */
export async function startDesktop(launch: DesktopLaunch, options: StartOptions = {}): Promise<StartedDesktop> {
  if (launch.hiddenStart === undefined) return { child: await startDirectly(launch, options) }
  const notHidden = await startHidden(launch.command, launch.hiddenStart.dshHome, options)
  return notHidden === undefined ? {} : { child: await startDirectly(launch, options), notHidden }
}

/** Ask explorer to start `file` hidden. @returns why it did not, or undefined once it did. */
async function startHidden(file: string, dshHome: string, options: StartOptions): Promise<string | undefined> {
  const result = await (options.powershell ?? runPowerShell)(EXPLORER_START, {
    ...launchEnvironment(options.env ?? process.env),
    DSH_ACP_START_FILE: file, DSH_ACP_START_DIRECTORY: win32.dirname(file), DSH_ACP_START_HOME: dshHome,
  })
  if (result.code === 0 && /^started\r?$/mu.test(result.stdout)) return undefined
  if (result.code === 3) return `资源管理器给新进程的数据目录不是 ${dshHome}`
  if (result.code === 4) return '没有找到资源管理器的桌面'
  const detail = result.stderr.trim().split(/\r?\n/u)[0] ?? ''
  if (result.code === null) return `无法运行 Windows PowerShell：${detail}`
  return `Windows PowerShell 以 ${result.code} 退出${detail ? `：${detail}` : ''}`
}

function startDirectly(launch: DesktopLaunch, options: StartOptions): Promise<ChildProcess> {
  const spawn = options.spawn ?? nodeSpawn
  return new Promise<ChildProcess>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(launch.command, launch.args, {
        detached: !launch.waitForExit, stdio: 'ignore', windowsHide: launch.windowsHide ?? false,
        env: { ...launchEnvironment(options.env ?? process.env), ...launch.environment },
        ...(launch.cwd ? { cwd: launch.cwd } : {}),
      })
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)))
      return
    }
    child.once('error', reject)
    if (launch.waitForExit) {
      child.once('exit', (code, signal) => {
        if (code === 0) resolve(child)
        else reject(new Error(`${launch.command} 以 ${code ?? signal} 退出`))
      })
    } else {
      child.once('spawn', () => {
        child.unref()
        resolve(child)
      })
    }
  })
}

/**
 * Connect once DSH is ready: retry while `retryable` accepts the failure, until `timeoutMs` passed.
 * @returns the connection.
 * @throws the last failure when the time is up, or the first one `retryable` rejects.
 */
export async function waitForDsh<T>(connect: () => Promise<T>, retryable: (error: unknown) => boolean,
  options: { timeoutMs: number, intervalMs?: number }): Promise<T> {
  const deadline = Date.now() + options.timeoutMs
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, options.intervalMs ?? 500))
    try {
      return await connect()
    } catch (error) {
      if (!retryable(error) || Date.now() >= deadline) throw error
    }
  }
}

/**
 * Wait for the plugin of a DSH that already runs: `connect` is retried as in {@link waitForDsh}, and every `checkMs`
 * (2000 by default) `running` says whether a DSH still runs. Once none does, such as an app that was still quitting
 * when the launcher looked, the wait ends, so that the launcher starts one instead of waiting for a plugin that cannot come.
 * @returns the connection, or undefined once no DSH runs.
 * @throws the last failure when the time is up while a DSH still runs, or the first one `retryable` rejects.
 */
export async function waitWhileRunning<T>(connect: () => Promise<T>, retryable: (error: unknown) => boolean, running: () => Promise<boolean>,
  options: { timeoutMs: number, intervalMs?: number, checkMs?: number }): Promise<T | undefined> {
  const deadline = Date.now() + options.timeoutMs
  const checkMs = options.checkMs ?? 2_000
  let check = Date.now() + checkMs
  for (;;) {
    await new Promise(resolve => setTimeout(resolve, options.intervalMs ?? 500))
    try {
      return await connect()
    } catch (error) {
      if (!retryable(error) || Date.now() >= deadline) throw error
    }
    if (Date.now() >= check) {
      if (!await running()) return undefined
      check = Date.now() + checkMs
    }
  }
}
