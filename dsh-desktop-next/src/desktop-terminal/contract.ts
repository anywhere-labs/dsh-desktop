/** What the terminal launch shares with its platform scripts: environment variable names, launch options, the generated file layout and value checks. */

import type { ChildProcess, SpawnOptions } from 'node:child_process'

export const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
export const DEFAULT_PROFILE = 'DSH_DESKTOP_DEFAULT_PROFILE'
export const DSH_HOME = 'DSH_HOME'
export const PATH = 'PATH'
export const WINDOWS_APP_EXECUTABLE = 'DSH_DESKTOP_APP_EXECUTABLE'
export const WINDOWS_DSH_BOOTSTRAP = 'DSH_DESKTOP_DSH_BOOTSTRAP'
export const WINDOWS_ELECTRON_VERSION = 'DSH_DESKTOP_ELECTRON_VERSION'
export const WINDOWS_PNPM_ENTRY = 'DSH_DESKTOP_PNPM_ENTRY'
export const WINDOWS_PROFILE_DIRECTORY = 'DSH_DESKTOP_PROFILE_DIRECTORY'
export const WINDOWS_TERMINAL_MODE = 'DSH_DESKTOP_TERMINAL_MODE'
export const WINDOWS_PRODUCT_VERSION = 'DSH_DESKTOP_PRODUCT_VERSION'
export const WINDOWS_SHIM_DIRECTORY = 'DSH_DESKTOP_SHIM_DIRECTORY'
export const WINDOWS_POWERSHELL_WELCOME = 'DSH_DESKTOP_POWERSHELL_WELCOME'
export const WINDOWS_CMD_WELCOME = 'DSH_DESKTOP_CMD_WELCOME'
export const WINDOWS_SHELL_EXECUTABLE = 'DSH_DESKTOP_SHELL_EXECUTABLE'

/** Platforms with a native terminal launch contract owned by DSH Desktop. */
export type DesktopTerminalPlatform = 'darwin' | 'win32'

/** Process launcher injected by the Electron adapter. */
export type DesktopTerminalSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcess

/** Filesystem probe used while resolving a Windows terminal shell. */
export type DesktopTerminalExecutableExists = (filename: string) => boolean

/** Resolver used to locate one Windows terminal shell without a command interpreter. */
export type DesktopTerminalExecutableResolver = (
  command: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  exists: DesktopTerminalExecutableExists,
) => string | undefined

/** Optional Windows terminal accepting a selected shell command after its argument prefix. */
export interface WindowsTerminalLauncher {
  /** Terminal executable, for example `wt.exe`. */
  executable: string
  /** Arguments placed before the selected shell child command. */
  arguments?: readonly string[]
}

/** Inputs for one isolated desktop terminal launch. */
export interface DesktopTerminalOptions {
  /** Host platform selecting the generated scripts and native launcher. */
  platform: NodeJS.Platform
  /** Electron executable reused as Node by command shims. */
  appExecutable: string
  /** Desktop-owned bootstrap that clears Node mode before importing the `dsh` CLI. */
  dshBootstrapPath: string
  /** Packaged JavaScript entry for the `pnpm` CLI. */
  pnpmBinPath: string
  /** Electron version used by pnpm native dependency installation. */
  electronVersion: string
  /** DSH profile selected by the desktop application. */
  profileName: string
  /** Product version displayed in the welcome message. */
  productVersion: string
  /** Explain whether commands modify the temporary runtime or the original Profile. */
  mode?: 'normal' | 'safe' | 'recovery'
  /** Absolute working directory of the selected profile. */
  profileDir: string
  /** Harness home exported as `DSH_HOME` inside the terminal. */
  homeDir: string
  /** Private directory receiving the generated terminal files. */
  stateDir: string
  /** Process launcher; production passes `node:child_process.spawn`. */
  spawn: DesktopTerminalSpawn
  /** Environment copied into the terminal child; defaults to `process.env`. */
  environment?: NodeJS.ProcessEnv
  /** Optional Windows terminal wrapper. Windows Terminal is discovered when omitted. */
  windowsTerminal?: WindowsTerminalLauncher
  /** Windows executable existence probe; defaults to `existsSync`. */
  windowsExecutableExists?: DesktopTerminalExecutableExists
  /** Windows executable resolver; defaults to a trusted PATH/SystemRoot lookup. */
  windowsExecutableResolver?: DesktopTerminalExecutableResolver
  /** Reporter attached before the platform launcher can emit an asynchronous failure. */
  onLaunchError?: (cause: Error) => void
}

/** Files and process created for one desktop terminal launch. */
export interface DesktopTerminalLaunch {
  /** Private directory prepended to this terminal's `PATH`. */
  shimDir: string
  /** Generated platform-specific `dsh` shim. */
  dshShimPath: string
  /** Generated platform-specific `pnpm` shim. */
  pnpmShimPath: string
  /** Generated platform-specific `node` shim backed by Electron's Node mode. */
  nodeShimPath: string
  /** Generated script that configures and welcomes the interactive shell. */
  welcomePath: string
  /** Windows command broker that creates the visible console, when applicable. */
  windowsLauncherPath?: string
  /** Short-lived platform launcher; callers may observe its asynchronous failure. */
  child: ChildProcess
}

export interface DesktopTerminalFiles {
  shimDir: string
  dshShimPath: string
  pnpmShimPath: string
  nodeShimPath: string
  welcomePath: string
  windowsCmdWelcomePath?: string
}

/** Reject values that cannot be represented safely in generated command files. */
export function assertScriptValue(label: string, value: string): void {
  if (value.length === 0) throw new Error(`dsh-desktop-next: terminal ${label} must not be empty`)
  if (/[\0\r\n]/.test(value)) {
    throw new Error(`dsh-desktop-next: terminal ${label} must not contain NUL or newlines`)
  }
}

export function terminalModeLabel(mode: DesktopTerminalOptions['mode']): string {
  if (mode === 'safe') return '安全模式临时环境 / Safe mode: temporary environment'
  if (mode === 'recovery') return '恢复修复终端：原 Profile / Recovery terminal: original Profile'
  return '正常环境 / Normal environment'
}
