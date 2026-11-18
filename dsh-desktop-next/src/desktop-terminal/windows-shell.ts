/** Choose the Windows shell and console: PowerShell or the command prompt, Windows Terminal when it is available, and the visible-console launch broker. */

import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import {
  assertScriptValue,
  type DesktopTerminalExecutableExists,
  type DesktopTerminalFiles,
  type DesktopTerminalOptions,
  PATH,
  WINDOWS_CMD_WELCOME,
  WINDOWS_POWERSHELL_WELCOME,
  WINDOWS_PROFILE_DIRECTORY,
  WINDOWS_SHELL_EXECUTABLE,
  type WindowsTerminalLauncher,
} from './contract.ts'

const WINDOWS_SHELL_COMMANDS = ['pwsh.exe', 'powershell.exe', 'cmd.exe'] as const

/** Read one Windows environment value without trusting its key casing. */
function windowsEnvironmentValue(environment: Readonly<NodeJS.ProcessEnv>, name: string): string | undefined {
  const normalized = name.toUpperCase()
  for (const [key, value] of Object.entries(environment)) {
    if (key.toUpperCase() === normalized) return value
  }
  return undefined
}

/** Resolve known Windows shells from explicit system paths and then the inherited PATH. */
function defaultWindowsExecutableResolver(
  command: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  exists: DesktopTerminalExecutableExists,
): string | undefined {
  const candidates: string[] = []
  const systemRoot = windowsEnvironmentValue(environment, 'SystemRoot')
  if (command.toLowerCase() === 'powershell.exe' && systemRoot !== undefined) {
    candidates.push(win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'))
  }
  if (command.toLowerCase() === 'cmd.exe') {
    const comSpec = windowsEnvironmentValue(environment, 'ComSpec')
    if (comSpec !== undefined) candidates.push(comSpec)
    if (systemRoot !== undefined) candidates.push(win32.join(systemRoot, 'System32', 'cmd.exe'))
  }
  const inheritedPath = windowsEnvironmentValue(environment, PATH)
  if (inheritedPath !== undefined) {
    for (const rawDir of inheritedPath.split(';')) {
      const dir = rawDir.startsWith('"') && rawDir.endsWith('"') ? rawDir.slice(1, -1) : rawDir
      if (dir.length > 0) candidates.push(win32.join(dir, command))
    }
  }
  return candidates.find(candidate => exists(candidate))
}

interface ResolvedWindowsShell {
  kind: 'powershell' | 'cmd'
  executable: string
}

/** Resolve the preferred Windows Terminal host, preserving an explicit adapter. */
export function resolveWindowsTerminal(
  options: DesktopTerminalOptions,
  _environment: Readonly<NodeJS.ProcessEnv>,
): WindowsTerminalLauncher | undefined {
  return options.windowsTerminal
}

/** Select PowerShell 7, Windows PowerShell, or the built-in command prompt. */
export function resolveWindowsShell(
  options: DesktopTerminalOptions,
  environment: Readonly<NodeJS.ProcessEnv>,
): ResolvedWindowsShell {
  const exists = options.windowsExecutableExists ?? existsSync
  const resolveExecutable = options.windowsExecutableResolver ?? defaultWindowsExecutableResolver
  for (const command of WINDOWS_SHELL_COMMANDS) {
    const executable = resolveExecutable(command, environment, exists)
    if (executable === undefined) continue
    assertScriptValue(`${command} executable`, executable)
    return {
      kind: command === 'cmd.exe' ? 'cmd' : 'powershell',
      executable,
    }
  }
  throw new Error('dsh-desktop-next: terminal requires pwsh.exe, powershell.exe, or cmd.exe on Windows')
}

/** Convert one selected Windows shell into an argv-only launch. */
export function windowsShellArgv(
  shell: ResolvedWindowsShell,
  files: DesktopTerminalFiles,
): string[] {
  if (shell.kind === 'cmd') {
    const welcome = files.windowsCmdWelcomePath
    if (welcome === undefined) {
      throw new Error('dsh-desktop-next: terminal did not generate the Windows command prompt welcome script')
    }
    return ['/D', '/K', 'call', welcome]
  }
  return [
    '-NoLogo',
    '-NoExit',
    '-ExecutionPolicy',
    'Bypass',
    '-File',
    files.welcomePath,
  ]
}

/** Resolve the trusted command processor used only to invoke the `start` broker. */
export function resolveWindowsCommandProcessor(
  options: DesktopTerminalOptions,
  environment: Readonly<NodeJS.ProcessEnv>,
  shell: ResolvedWindowsShell,
): string {
  if (shell.kind === 'cmd') return shell.executable
  const exists = options.windowsExecutableExists ?? existsSync
  const resolveExecutable = options.windowsExecutableResolver ?? defaultWindowsExecutableResolver
  const executable = resolveExecutable('cmd.exe', environment, exists)
  if (executable === undefined) {
    throw new Error('dsh-desktop-next: terminal requires cmd.exe to create a visible Windows console')
  }
  assertScriptValue('cmd.exe executable', executable)
  return executable
}

/** Build the trusted batch broker whose `start` command owns the visible console. */
export function windowsLaunchBroker(
  shell: ResolvedWindowsShell,
): string {
  const target = shell.kind === 'cmd'
    ? `"!${WINDOWS_SHELL_EXECUTABLE}!" /D /K call "!${WINDOWS_CMD_WELCOME}!"`
    : `"!${WINDOWS_SHELL_EXECUTABLE}!" -NoLogo -NoExit -ExecutionPolicy Bypass -File "!${WINDOWS_POWERSHELL_WELCOME}!"`
  return [
    '@echo off',
    'setlocal EnableDelayedExpansion',
    `start "DSH NEXT" /D "!${WINDOWS_PROFILE_DIRECTORY}!" ${target}`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}
