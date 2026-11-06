/**
 * Windows administrator detection and the de-elevated restart that precedes every child process.
 *
 * Chromium's sandbox broker cannot always create its children from an elevated token: on those machines
 * the GPU process fails to launch nine times and Chromium ends the browser process (#1487,
 * electron/electron#49167). Chrome restarts itself de-elevated before launching any child. This module
 * follows Chromium's `base::win::RunDeElevated`: the desktop shell's process token is the same user's
 * normal token, so a process created with it runs without administrator rights.
 *
 * A launch below Medium integrity cannot start the GPU process either, and no restart raises it: Windows
 * starts a program at most at the integrity level of its file's label (#1564). The startup check reads
 * both levels so the user learns which one to fix.
 */
import { createRequire } from 'node:module'
import { win32 as windowsPath } from 'node:path'
import { isDesktopInstallerQuitRequest } from '../../dsh-plugin-desktop/src/desktop-installer-quit.ts'
import { DE_ELEVATED_ARGUMENT } from './relaunch.ts'

type Koffi = typeof import('koffi').default
type Handle = bigint

/** Keeps an intentionally elevated launch elevated. */
export const KEEP_ELEVATED_ARGUMENT = '--next-keep-elevated'
/** Win32 `ERROR_ELEVATION_REQUIRED`: Windows insists on administrator rights for the program. */
export const ERROR_ELEVATION_REQUIRED = 740
/** `SECURITY_MANDATORY_MEDIUM_RID`, the level of a normal launch and of an object without a label. */
export const MEDIUM_INTEGRITY = 0x2000

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
const TOKEN_INTEGRITY_LEVEL_CLASS = 25
/** TOKEN_MANDATORY_LABEL plus the label SID it points to: 16 + 12 bytes on 64-bit Windows. */
const TOKEN_LABEL_BYTES = 64
const SE_FILE_OBJECT = 1
const LABEL_SECURITY_INFORMATION = 0x10
const ACL_HEADER_BYTES = 8
const SYSTEM_MANDATORY_LABEL_ACE_TYPE = 0x11
const INHERIT_ONLY_ACE = 0x08
/** SYSTEM_MANDATORY_LABEL_ACE: the label SID follows the ACE header and the access mask. */
const LABEL_SID_OFFSET = 8
/** S-1-16-<level>: the revision, one sub-authority, the six-byte authority and the level. */
const LABEL_SID_BYTES = 12
const MANDATORY_LABEL_AUTHORITY = 16

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
        LocalFree: [HANDLE, [HANDLE]],
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
        // Returns the Win32 error code itself; the label ACL points into the returned security descriptor.
        GetNamedSecurityInfoW: ['uint32', ['str16', 'int', 'uint32', HANDLE, HANDLE, HANDLE, handleOut, handleOut]],
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
 * The level of a mandatory label SID, S-1-16-<level>.
 * @param sid - SID bytes.
 * @returns the level.
 * @throws RangeError for any other SID or truncated bytes, so that misread memory never counts as a low level.
 */
export function mandatoryLabelLevel(sid: Uint8Array): number {
  const bytes = Buffer.from(sid.buffer, sid.byteOffset, sid.byteLength)
  if (bytes.length < LABEL_SID_BYTES || bytes.readUInt8(0) !== 1 || bytes.readUInt8(1) !== 1 || bytes.readUIntBE(2, 6) !== MANDATORY_LABEL_AUTHORITY) {
    throw new RangeError('Not a mandatory label SID')
  }
  return bytes.readUInt32LE(8)
}

/**
 * The level of the first mandatory label in an ACL that applies to the object itself.
 * @param acl - ACL bytes read with `LABEL_SECURITY_INFORMATION`.
 * @returns the label's level, or undefined when the object carries none and counts as Medium.
 * @throws RangeError for a truncated ACL or a label without a mandatory label SID.
 */
export function aclIntegrityLevel(acl: Uint8Array): number | undefined {
  const bytes = Buffer.from(acl.buffer, acl.byteOffset, acl.byteLength)
  let offset = ACL_HEADER_BYTES
  for (let index = 0; index < bytes.readUInt16LE(4); index++) {
    const size = bytes.readUInt16LE(offset + 2)
    if (size < LABEL_SID_OFFSET) throw new RangeError('ACE is shorter than its header')
    if (bytes.readUInt8(offset) === SYSTEM_MANDATORY_LABEL_ACE_TYPE && (bytes.readUInt8(offset + 1) & INHERIT_ONLY_ACE) === 0) {
      return mandatoryLabelLevel(bytes.subarray(offset + LABEL_SID_OFFSET, offset + size))
    }
    offset += size
  }
  return undefined
}

function nativeBytes({ koffi }: Win32, pointer: Handle, length: number): Buffer {
  return Buffer.from(koffi.decode(pointer, 'uint8', length) as Uint8Array)
}

/**
 * Read this process token's integrity level.
 * @returns the mandatory label level of the current process token.
 * @throws when Koffi cannot load or the token cannot be queried.
 */
export function windowsIntegrityLevel(): number {
  const win = win32()
  const token = openToken(win, win.api.GetCurrentProcess(), TOKEN_QUERY)
  const information = win.koffi.alloc('uint8', TOKEN_LABEL_BYTES) as Handle
  try {
    if (!win.api.GetTokenInformation(token, TOKEN_INTEGRITY_LEVEL_CLASS, information, TOKEN_LABEL_BYTES, [0])) throw lastError(win, 'GetTokenInformation')
    // TOKEN_MANDATORY_LABEL points at the label SID inside the same buffer.
    const sid = win.koffi.decode(information, 'void *') as Handle | null
    if (sid === null) throw new Win32CallError('GetTokenInformation', 0)
    return mandatoryLabelLevel(nativeBytes(win, sid, LABEL_SID_BYTES))
  } finally {
    win.koffi.free(information)
    win.api.CloseHandle(token)
  }
}

/**
 * Read the integrity level of a file's mandatory label, its own or inherited.
 * @param path - file or folder path.
 * @returns the label's level, or undefined when the file carries none and counts as Medium.
 * @throws when the label cannot be read.
 */
export function fileIntegrityLevel(path: string): number | undefined {
  const win = win32()
  const acl: [Handle | null] = [null]
  const descriptor: [Handle | null] = [null]
  const code = win.api.GetNamedSecurityInfoW(path, SE_FILE_OBJECT, LABEL_SECURITY_INFORMATION, null, null, null, acl, descriptor) as number
  if (code !== 0) throw new Win32CallError('GetNamedSecurityInfoW', code)
  try {
    if (acl[0] === null) return undefined
    return aclIntegrityLevel(nativeBytes(win, acl[0], win.koffi.decode(acl[0], 2, 'uint16') as number))
  } finally {
    if (descriptor[0] !== null) win.api.LocalFree(descriptor[0])
  }
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

/** With these Chromium arguments the GPU process needs no sandbox, the part a Low integrity launch cannot create. */
const GPU_SANDBOX_OFF = new Set(['--no-sandbox', '--disable-gpu-sandbox'])

/** A launch below Medium integrity, which cannot start Chromium's GPU process (#1564). */
export interface LowIntegrityLaunch {
  readonly executable: string
  /**
   * Set when the executable carries a label below Medium: the highest folder above it that carries one
   * too, where the label it inherits comes from, or its own folder.
   */
  readonly labeled?: string
}

/** The injectable environment of {@link lowIntegrityAtStartup}. */
export interface LowIntegrityOptions {
  readonly platform: NodeJS.Platform
  /** Full `process.argv`. */
  readonly argv: readonly string[]
  readonly executable: string
  readonly integrity?: () => number
  readonly fileIntegrity?: (path: string) => number | undefined
}

/**
 * Recognize a Windows launch below Medium integrity before Chromium starts any child. A level that cannot
 * be read lets the launch go on.
 * @param options - process facts and, in tests, Win32 replacements.
 * @returns what to explain, or undefined for a launch that can start.
 */
export function lowIntegrityAtStartup(options: LowIntegrityOptions): LowIntegrityLaunch | undefined {
  // The installer's quit handoff ends at once and must not wait on a message box.
  if (options.platform !== 'win32' || isDesktopInstallerQuitRequest(options.argv, options.platform)
    || options.argv.some(argument => GPU_SANDBOX_OFF.has(argument))) return undefined
  let level: number
  try { level = (options.integrity ?? windowsIntegrityLevel)() } catch { return undefined }
  if (level >= MEDIUM_INTEGRITY) return undefined
  const fileLevel = options.fileIntegrity ?? fileIntegrityLevel
  const lowered = (path: string): boolean => {
    try { return (fileLevel(path) ?? MEDIUM_INTEGRITY) < MEDIUM_INTEGRITY } catch { return false }
  }
  if (!lowered(options.executable)) return { executable: options.executable }
  let folder = windowsPath.dirname(options.executable)
  for (let parent = windowsPath.dirname(folder); parent !== folder && lowered(parent); parent = windowsPath.dirname(folder)) folder = parent
  return { executable: options.executable, labeled: folder }
}
