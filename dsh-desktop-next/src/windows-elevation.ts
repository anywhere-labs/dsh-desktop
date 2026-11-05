/**
 * Windows administrator detection and the de-elevated restart that precedes every child process.
 *
 * Chromium's sandbox broker cannot always create its children from an elevated token: on those machines
 * the GPU process fails to launch nine times and Chromium ends the browser process (#1487,
 * electron/electron#49167). Chrome restarts itself de-elevated before launching any child. This module
 * follows Chromium's `base::win::RunDeElevated`: the desktop shell's process token is the same user's
 * normal token, so a process created with it runs without administrator rights.
 */
import { createRequire } from 'node:module'
import { isDesktopInstallerQuitRequest } from '../../dsh-plugin-desktop/src/desktop-installer-quit.ts'
import { DE_ELEVATED_ARGUMENT } from './relaunch.ts'

type Koffi = typeof import('koffi').default
type Handle = bigint

/** Keeps an intentionally elevated launch elevated. */
export const KEEP_ELEVATED_ARGUMENT = '--next-keep-elevated'
/** Win32 `ERROR_ELEVATION_REQUIRED`: Windows insists on administrator rights for the program. */
export const ERROR_ELEVATION_REQUIRED = 740

/** `TokenIsElevated` and `TOKEN_ELEVATION_TYPE` of one token. */
export interface WindowsElevation {
  readonly elevated: boolean
  /**
   * `full` is the elevated half of a split token (UAC on), the only state with a normal token to return to;
   * `default` has no split token (UAC off, or the built-in Administrator); `limited` is the filtered half.
   */
  readonly type: 'default' | 'full' | 'limited'
}

/** Win32 call failure with its exact error code. */
export class Win32CallError extends Error {
  constructor(readonly api: string, readonly code: number) {
    super(`${api} failed (Win32 ${code})`)
    this.name = 'Win32CallError'
  }
}

/** Why the desktop shell offers no normal token of this user. */
export type ShellTokenUnavailable = 'no-shell' | 'shell-elevated' | 'shell-other-user'

/** Outcome of starting a program with the desktop shell's token. */
export type ShellTokenLaunch =
  | { readonly launched: true; readonly pid: number }
  | { readonly launched: false; readonly reason: ShellTokenUnavailable }

const TOKEN_ASSIGN_PRIMARY = 0x0001
const TOKEN_DUPLICATE = 0x0002
const TOKEN_QUERY = 0x0008
const TOKEN_ADJUST_PRIVILEGES = 0x0020
const TOKEN_ADJUST_DEFAULT = 0x0080
const TOKEN_ADJUST_SESSIONID = 0x0100
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000
const TOKEN_USER_CLASS = 1
const TOKEN_ELEVATION_TYPE_CLASS = 18
const TOKEN_ELEVATION_CLASS = 20
const SECURITY_IMPERSONATION = 2
const TOKEN_PRIMARY = 1
const SE_PRIVILEGE_ENABLED = 0x0002
/** TOKEN_USER plus the SID it points to: at most 16 + 68 bytes on 64-bit Windows. */
const TOKEN_USER_BYTES = 256

/**
 * Win32 types and functions this module binds, by library.
 * @param koffi - loaded Koffi module.
 * @returns anonymous struct layouts and `[result, parameters]` per function, all `__stdcall`.
 */
export function win32Signatures(koffi: Koffi) {
  const HANDLE = koffi.pointer('void')
  const LUID = koffi.struct({ LowPart: 'uint32', HighPart: 'int32' })
  // TOKEN_PRIVILEGES with its single LUID_AND_ATTRIBUTES entry inlined.
  const TOKEN_PRIVILEGES = koffi.struct({ PrivilegeCount: 'uint32', Luid: LUID, Attributes: 'uint32' })
  const STARTUPINFOW = koffi.struct({
    cb: 'uint32', lpReserved: 'str16', lpDesktop: 'str16', lpTitle: 'str16',
    dwX: 'uint32', dwY: 'uint32', dwXSize: 'uint32', dwYSize: 'uint32',
    dwXCountChars: 'uint32', dwYCountChars: 'uint32', dwFillAttribute: 'uint32', dwFlags: 'uint32',
    wShowWindow: 'uint16', cbReserved2: 'uint16', lpReserved2: koffi.pointer('uint8'),
    hStdInput: HANDLE, hStdOutput: HANDLE, hStdError: HANDLE,
  })
  const PROCESS_INFORMATION = koffi.struct({ hProcess: HANDLE, hThread: HANDLE, dwProcessId: 'uint32', dwThreadId: 'uint32' })
  const handleOut = koffi.out(koffi.pointer(HANDLE))
  const uint32Out = koffi.out(koffi.pointer('uint32'))
  return {
    types: { LUID, TOKEN_PRIVILEGES, STARTUPINFOW, PROCESS_INFORMATION },
    libraries: {
      'kernel32.dll': {
        GetCurrentProcess: [HANDLE, []],
        OpenProcess: [HANDLE, ['uint32', 'int', 'uint32']],
        CloseHandle: ['int', [HANDLE]],
        GetLastError: ['uint32', []],
      },
      'advapi32.dll': {
        OpenProcessToken: ['int', [HANDLE, 'uint32', handleOut]],
        // The call writes into the caller's buffer in place.
        GetTokenInformation: ['int', [HANDLE, 'int', HANDLE, 'uint32', uint32Out]],
        DuplicateTokenEx: ['int', [HANDLE, 'uint32', HANDLE, 'int', 'int', handleOut]],
        LookupPrivilegeValueW: ['int', ['str16', 'str16', koffi.out(koffi.pointer(LUID))]],
        AdjustTokenPrivileges: ['int', [HANDLE, 'int', koffi.pointer(TOKEN_PRIVILEGES), 'uint32', HANDLE, HANDLE]],
        EqualSid: ['int', [HANDLE, HANDLE]],
        CreateProcessWithTokenW: ['int', [HANDLE, 'uint32', 'str16', 'str16', 'uint32', HANDLE, 'str16',
          koffi.pointer(STARTUPINFOW), koffi.out(koffi.pointer(PROCESS_INFORMATION))]],
      },
      'user32.dll': {
        GetShellWindow: [HANDLE, []],
        GetWindowThreadProcessId: ['uint32', [HANDLE, uint32Out]],
        AllowSetForegroundWindow: ['int', ['uint32']],
      },
    },
  } as const
}

type Libraries = ReturnType<typeof win32Signatures>['libraries']
type FunctionName = { [Library in keyof Libraries]: keyof Libraries[Library] }[keyof Libraries]
type Win32 = { koffi: Koffi; startupInfoBytes: number; api: Record<FunctionName, (...args: any[]) => any> }

let cached: Win32 | undefined

/** Load Koffi and bind the Win32 functions on first use, which happens only on Windows. */
function win32(): Win32 {
  if (cached) return cached
  const koffi = createRequire(import.meta.url)('koffi') as Koffi
  const signatures = win32Signatures(koffi)
  const api: Record<string, (...args: any[]) => any> = {}
  for (const [library, functions] of Object.entries(signatures.libraries)) {
    const loaded = koffi.load(library)
    for (const [name, [result, parameters]] of Object.entries(functions)) api[name] = loaded.func('__stdcall', name, result, [...parameters])
  }
  return cached = { koffi, startupInfoBytes: koffi.sizeof(signatures.types.STARTUPINFOW), api: api as Win32['api'] }
}

function lastError({ api }: Win32, name: string): Win32CallError {
  return new Win32CallError(name, api.GetLastError() as number)
}

function openToken(win: Win32, process: Handle, access: number): Handle {
  const token: [Handle | null] = [null]
  if (!win.api.OpenProcessToken(process, access, token) || token[0] === null) throw lastError(win, 'OpenProcessToken')
  return token[0]
}

function tokenUint32(win: Win32, token: Handle, informationClass: number): number {
  const information = Buffer.alloc(4)
  if (!win.api.GetTokenInformation(token, informationClass, information, information.length, [0])) throw lastError(win, 'GetTokenInformation')
  return information.readUInt32LE(0)
}

function tokenElevation(win: Win32, token: Handle): WindowsElevation {
  const type = tokenUint32(win, token, TOKEN_ELEVATION_TYPE_CLASS)
  return { elevated: tokenUint32(win, token, TOKEN_ELEVATION_CLASS) !== 0, type: type === 2 ? 'full' : type === 3 ? 'limited' : 'default' }
}

/** Whether two tokens belong to one user. TOKEN_USER points into its own buffer, so both live in native memory. */
function sameUser(win: Win32, first: Handle, second: Handle): boolean {
  const buffers: Handle[] = []
  try {
    const sids = [first, second].map(token => {
      const information = win.koffi.alloc('uint8', TOKEN_USER_BYTES) as Handle
      buffers.push(information)
      if (!win.api.GetTokenInformation(token, TOKEN_USER_CLASS, information, TOKEN_USER_BYTES, [0])) throw lastError(win, 'GetTokenInformation')
      const sid = win.koffi.decode(information, 'void *') as Handle | null
      if (sid === null) throw new Win32CallError('GetTokenInformation', 0)
      return sid
    })
    return win.api.EqualSid(sids[0], sids[1]) !== 0
  } finally {
    for (const buffer of buffers) win.koffi.free(buffer)
  }
}

/** Best effort, as in Chromium: elevated administrators normally hold the privilege enabled already. */
function enableImpersonatePrivilege(win: Win32, token: Handle): void {
  const luid = {}
  if (!win.api.LookupPrivilegeValueW(null, 'SeImpersonatePrivilege', luid)) return
  win.api.AdjustTokenPrivileges(token, 0, { PrivilegeCount: 1, Luid: luid, Attributes: SE_PRIVILEGE_ENABLED }, 0, null, null)
}

/**
 * Read this process's token elevation.
 * @returns elevation of the current process token.
 * @throws when Koffi cannot load or the token cannot be queried.
 */
export function windowsElevation(): WindowsElevation {
  const win = win32()
  const token = openToken(win, win.api.GetCurrentProcess(), TOKEN_QUERY)
  try { return tokenElevation(win, token) } finally { win.api.CloseHandle(token) }
}

/**
 * Start a program as the same user without administrator rights, with the desktop shell's token
 * (Chromium's `base::win::RunDeElevated`). The new process inherits this process's working directory
 * and receives a fresh environment from the user's profile, as a process the shell started would.
 * @param file - program path.
 * @param commandLine - complete command line, the quoted program first.
 * @returns the new process id, or why the shell offers no normal token of this user.
 * @throws Win32CallError when a Win32 step fails, e.g. ERROR_ELEVATION_REQUIRED when Windows forces elevation.
 */
export function launchWithShellToken(file: string, commandLine: string): ShellTokenLaunch {
  const win = win32()
  const { api } = win
  const window = api.GetShellWindow() as Handle | null
  const shellPid: [number] = [0]
  if (window === null || !api.GetWindowThreadProcessId(window, shellPid) || !shellPid[0]) return { launched: false, reason: 'no-shell' }
  const shellProcess = api.OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, shellPid[0]) as Handle | null
  if (shellProcess === null) throw lastError(win, 'OpenProcess')
  const handles: Handle[] = [shellProcess]
  try {
    const shellToken = openToken(win, shellProcess, TOKEN_QUERY | TOKEN_DUPLICATE)
    handles.push(shellToken)
    if (tokenElevation(win, shellToken).elevated) return { launched: false, reason: 'shell-elevated' }
    const ownToken = openToken(win, api.GetCurrentProcess(), TOKEN_QUERY | TOKEN_ADJUST_PRIVILEGES)
    handles.push(ownToken)
    if (!sameUser(win, ownToken, shellToken)) return { launched: false, reason: 'shell-other-user' }
    enableImpersonatePrivilege(win, ownToken)
    const primary: [Handle | null] = [null]
    if (!api.DuplicateTokenEx(shellToken, TOKEN_QUERY | TOKEN_ASSIGN_PRIMARY | TOKEN_DUPLICATE | TOKEN_ADJUST_DEFAULT | TOKEN_ADJUST_SESSIONID,
      null, SECURITY_IMPERSONATION, TOKEN_PRIMARY, primary) || primary[0] === null) throw lastError(win, 'DuplicateTokenEx')
    handles.push(primary[0])
    const started: { hProcess?: Handle | null; hThread?: Handle | null; dwProcessId?: number } = {}
    if (!api.CreateProcessWithTokenW(primary[0], 0, file, commandLine, 0, null, null, { cb: win.startupInfoBytes }, started)) {
      throw lastError(win, 'CreateProcessWithTokenW')
    }
    for (const handle of [started.hProcess, started.hThread]) if (handle) handles.push(handle)
    const pid = started.dwProcessId ?? 0
    // The new instance opens its window from a process the user did not start directly.
    api.AllowSetForegroundWindow(pid)
    return { launched: true, pid }
  } finally {
    for (const handle of handles.reverse()) api.CloseHandle(handle)
  }
}

/**
 * Quote one argument for `CommandLineToArgvW`, which Chromium and the C runtime both follow.
 * @param value - raw argument.
 * @returns the argument unchanged when it needs no quoting, otherwise quoted with its quotes and trailing backslashes escaped.
 */
export function quoteWindowsArgument(value: string): string {
  if (value !== '' && !/[\s"]/u.test(value)) return value
  let quoted = '"'
  let backslashes = 0
  for (const character of value) {
    if (character === '\\') { backslashes++; continue }
    quoted += '\\'.repeat(character === '"' ? backslashes * 2 + 1 : backslashes) + character
    backslashes = 0
  }
  return `${quoted}${'\\'.repeat(backslashes * 2)}"`
}

/** Elevation facts the process that keeps running records at startup. */
export interface StartupElevation {
  readonly elevation?: WindowsElevation
  /** Why a launch holding the elevated half of a split token kept running elevated. */
  readonly kept?: 'requested' | 'restarted' | 'automation' | 'installer' | 'development' | ShellTokenUnavailable
  /** Why the elevation check or the restart failed; the launch then continues elevated. */
  readonly error?: string
  /** Win32 code of a failed restart; ERROR_ELEVATION_REQUIRED means Windows forces this program to run elevated. */
  readonly win32Code?: number
}

/** The injectable environment of {@link deElevateAtStartup}. */
export interface StartupElevationOptions {
  readonly platform: NodeJS.Platform
  readonly packaged: boolean
  /** Full `process.argv`; a packaged app's own arguments follow the executable. */
  readonly argv: readonly string[]
  readonly executable: string
  readonly elevation?: () => WindowsElevation
  readonly launch?: (file: string, commandLine: string) => ShellTokenLaunch
}

const AUTOMATION_ARGUMENT = /^--(?:remote-debugging-(?:port|pipe)|enable-automation)(?:=|$)/u

/**
 * Restart a packaged Windows launch that holds the elevated half of a split token with the user's normal token,
 * before this process starts any child. A failed restart continues the launch elevated.
 * @param options - process facts and, in tests, Win32 replacements.
 * @returns `relaunched` when the caller must exit now, otherwise what to record about this process.
 */
export function deElevateAtStartup(options: StartupElevationOptions): { readonly relaunched: true } | { readonly relaunched: false; readonly state: StartupElevation } {
  if (options.platform !== 'win32') return { relaunched: false, state: {} }
  let elevation: WindowsElevation
  try { elevation = (options.elevation ?? windowsElevation)() } catch (error) { return { relaunched: false, state: { error: String(error) } } }
  if (elevation.type !== 'full') return { relaunched: false, state: { elevation } }
  const args = options.argv.slice(1)
  const kept = !options.packaged ? 'development'
    : args.includes(KEEP_ELEVATED_ARGUMENT) ? 'requested'
      : args.includes(DE_ELEVATED_ARGUMENT) ? 'restarted'
        : isDesktopInstallerQuitRequest(args, options.platform) ? 'installer'
          : args.some(argument => AUTOMATION_ARGUMENT.test(argument)) ? 'automation' : undefined
  if (kept) return { relaunched: false, state: { elevation, kept } }
  try {
    const commandLine = [options.executable, ...args, DE_ELEVATED_ARGUMENT].map(quoteWindowsArgument).join(' ')
    const result = (options.launch ?? launchWithShellToken)(options.executable, commandLine)
    return result.launched ? { relaunched: true } : { relaunched: false, state: { elevation, kept: result.reason } }
  } catch (error) {
    return { relaunched: false, state: { elevation, error: String(error), ...error instanceof Win32CallError ? { win32Code: error.code } : {} } }
  }
}
