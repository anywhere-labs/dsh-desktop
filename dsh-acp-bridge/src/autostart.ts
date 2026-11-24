/**
 * Starting DSH Desktop for the launcher when no DSH that loaded the plugin is running.
 *
 * The launcher runs on the executable of the DSH Desktop that wrote it (Electron in Node mode),
 * so that executable names the app to start. macOS starts the app through LaunchServices
 * (`open`): as a child of the editor it would count the editor as its responsible process,
 * which breaks Local Network access (anywhere-labs/deepseek-harness-desktop#1515). Windows and
 * Linux start the executable itself, detached, without this process's Node-mode variables.
 * DSH Desktop then starts with its tray only; releases without that argument open their window.
 * Node built-ins only.
 */

import { spawn as nodeSpawn, type ChildProcess, type SpawnOptions } from 'node:child_process'
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

/**
 * Start the app. Resolves once it was handed to the system; DSH is not ready yet.
 * @throws when the app cannot be started.
 */
export function startDesktop(launch: DesktopLaunch, options: { spawn?: Spawn, env?: NodeJS.ProcessEnv } = {}): Promise<ChildProcess> {
  const spawn = options.spawn ?? nodeSpawn
  return new Promise<ChildProcess>((resolve, reject) => {
    let child: ChildProcess
    try {
      child = spawn(launch.command, launch.args, {
        detached: !launch.waitForExit, stdio: 'ignore', windowsHide: true,
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
