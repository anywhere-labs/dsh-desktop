/**
 * `<app> dsh …` on Linux, which has no tray terminal: the application executable runs the packaged DSH CLI (#1568).
 *
 * The main process replaces itself with the CLI before Chromium starts its interface, so the command keeps the
 * process id, terminal, signals and exit status, needs no display, and an AppImage stays mounted until it ends.
 */
import { join } from 'node:path'

/**
 * The DSH arguments of a `<app> dsh …` launch.
 * @param argv - `process.argv` of the main process.
 * @param platform - Node platform; only Linux has the command.
 * @param defaultApp - `process.defaultApp`: Electron was started with the application directory as its first argument.
 * @returns the arguments after `dsh`, or `undefined` for a desktop launch.
 */
export function dshCommandArguments(argv: readonly string[], platform: NodeJS.Platform, defaultApp: boolean): string[] | undefined {
  if (platform !== 'linux') return undefined
  const args = argv.slice(defaultApp ? 2 : 1)
  // An AppImage's AppRun puts `--no-sandbox` before the user's arguments when user namespaces are unavailable.
  const command = args[0] === '--no-sandbox' ? 1 : 0
  return args[command] === 'dsh' ? args.slice(command + 1) : undefined
}

/** The `process.execve` arguments that turn the main process into one `dsh` command. */
export interface DshCommandInvocation {
  readonly file: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
}

/**
 * Run the packaged CLI as the tray terminal's `dsh` shim does, on the desktop's data directory and Profile.
 * @param options - the application executable and root, the DSH arguments, the data directory, the selected
 * Profile (`undefined` when it cannot be read, so commands name one with `--profile`) and the inherited environment.
 * @returns the replacement process: Electron's Node mode running `lib/desktop-cli.js`.
 */
export function dshCommandInvocation(options: {
  readonly executable: string
  readonly root: string
  readonly args: readonly string[]
  readonly home: string
  readonly profile: string | undefined
  readonly environment: NodeJS.ProcessEnv
}): DshCommandInvocation {
  const env: NodeJS.ProcessEnv = { ...options.environment, ELECTRON_RUN_AS_NODE: '1', DSH_HOME: options.home }
  delete env.DSH_DESKTOP_DEFAULT_PROFILE
  if (options.profile !== undefined) env.DSH_DESKTOP_DEFAULT_PROFILE = options.profile
  const bootstrap = join(options.root, 'lib', 'desktop-cli.js')
  return { file: options.executable, args: [options.executable, '--expose-internals', bootstrap, ...options.args], env }
}
