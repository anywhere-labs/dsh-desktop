/** Windows elevation decisions and Win32 declarations, checked without starting a process. */
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { DE_ELEVATED_ARGUMENT } from '../src/relaunch.ts'
import {
  aclIntegrityLevel, deElevateAtStartup, ERROR_ELEVATION_REQUIRED, fileIntegrityLevel, KEEP_ELEVATED_ARGUMENT, lowIntegrityAtStartup, mandatoryLabelLevel, MEDIUM_INTEGRITY,
  quoteWindowsArgument, Win32CallError, win32Signatures, windowsElevation, windowsIntegrityLevel,
  type LowIntegrityOptions, type StartupElevationOptions, type WindowsElevation,
} from '../src/windows-elevation.ts'

const EXECUTABLE = 'C:\\Program Files\\DSH NEXT\\DSH NEXT.exe'
const FULL: WindowsElevation = { elevated: true, type: 'full' }

function startup(overrides: Partial<StartupElevationOptions> = {}) {
  const launch = vi.fn((_file: string, _commandLine: string) => ({ launched: true as const, pid: 4242 }))
  const elevation = vi.fn(() => FULL)
  const result = deElevateAtStartup({ platform: 'win32', packaged: true, argv: [EXECUTABLE], executable: EXECUTABLE, elevation, launch, ...overrides })
  return { result, launch, elevation }
}

describe('quoteWindowsArgument', () => {
  it('leaves plain arguments alone and quotes the rest for CommandLineToArgvW', () => {
    expect(quoteWindowsArgument('--next-safe-mode')).toBe('--next-safe-mode')
    expect(quoteWindowsArgument('C:\\path\\file')).toBe('C:\\path\\file')
    expect(quoteWindowsArgument('')).toBe('""')
    expect(quoteWindowsArgument(EXECUTABLE)).toBe(`"${EXECUTABLE}"`)
    expect(quoteWindowsArgument('say "hi"')).toBe('"say \\"hi\\""')
    // Backslashes double only before a quote, including the closing one.
    expect(quoteWindowsArgument('C:\\with space\\')).toBe('"C:\\with space\\\\"')
    expect(quoteWindowsArgument('a\\"b c')).toBe('"a\\\\\\"b c"')
    expect(quoteWindowsArgument('tab\there')).toBe('"tab\there"')
  })
})

describe('deElevateAtStartup', () => {
  it('does nothing outside Windows, without reading a token', () => {
    const { result, launch, elevation } = startup({ platform: 'darwin' })
    expect(result).toEqual({ relaunched: false, state: {} })
    expect(elevation).not.toHaveBeenCalled()
    expect(launch).not.toHaveBeenCalled()
  })

  it('restarts the elevated half of a split token with its arguments and a one-shot marker', () => {
    const { result, launch } = startup({ argv: [EXECUTABLE, '--next-safe-mode', 'with space'] })
    expect(result).toEqual({ relaunched: true })
    expect(launch).toHaveBeenCalledWith(EXECUTABLE, `"${EXECUTABLE}" --next-safe-mode "with space" ${DE_ELEVATED_ARGUMENT}`)
  })

  it('keeps tokens that have no normal token to return to', () => {
    for (const elevation of [{ elevated: false, type: 'limited' }, { elevated: true, type: 'default' }, { elevated: false, type: 'default' }] as const) {
      const { result, launch } = startup({ elevation: () => elevation })
      expect(result).toEqual({ relaunched: false, state: { elevation } })
      expect(launch).not.toHaveBeenCalled()
    }
  })

  it('records why an elevated launch keeps running elevated', () => {
    const cases: Array<[Partial<StartupElevationOptions>, string]> = [
      [{ packaged: false }, 'development'],
      [{ argv: [EXECUTABLE, KEEP_ELEVATED_ARGUMENT] }, 'requested'],
      [{ argv: [EXECUTABLE, DE_ELEVATED_ARGUMENT] }, 'restarted'],
      [{ argv: [EXECUTABLE, '--dsh-installer-quit'] }, 'installer'],
      [{ argv: [EXECUTABLE, '--remote-debugging-port=9222'] }, 'automation'],
      [{ argv: [EXECUTABLE, '--remote-debugging-pipe'] }, 'automation'],
      [{ argv: [EXECUTABLE, '--enable-automation'] }, 'automation'],
    ]
    for (const [overrides, kept] of cases) {
      const { result, launch } = startup(overrides)
      expect(result).toEqual({ relaunched: false, state: { elevation: FULL, kept } })
      expect(launch).not.toHaveBeenCalled()
    }
  })

  it('continues elevated when the shell has no normal token of this user', () => {
    const { result } = startup({ launch: () => ({ launched: false, reason: 'shell-other-user' }) })
    expect(result).toEqual({ relaunched: false, state: { elevation: FULL, kept: 'shell-other-user' } })
  })

  it('continues elevated with the Win32 code when the restart fails', () => {
    const { result } = startup({ launch: () => { throw new Win32CallError('CreateProcessWithTokenW', ERROR_ELEVATION_REQUIRED) } })
    expect(result).toEqual({ relaunched: false, state: { elevation: FULL, error: 'Win32CallError: CreateProcessWithTokenW failed (Win32 740)', win32Code: 740 } })
  })

  it('continues when the token cannot be read', () => {
    const { result, launch } = startup({ elevation: () => { throw new Error('koffi unavailable') } })
    expect(result).toEqual({ relaunched: false, state: { error: 'Error: koffi unavailable' } })
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('win32Signatures', () => {
  const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi').default
  const signatures = win32Signatures(koffi)

  it('lays out the 64-bit Windows structs', () => {
    expect(koffi.sizeof(signatures.types.STARTUPINFOW)).toBe(104)
    expect(koffi.sizeof(signatures.types.PROCESS_INFORMATION)).toBe(24)
    expect(koffi.sizeof(signatures.types.LUID)).toBe(8)
    expect(koffi.sizeof(signatures.types.TOKEN_PRIVILEGES)).toBe(16)
    expect(koffi.offsetof(signatures.types.TOKEN_PRIVILEGES, 'Attributes')).toBe(12)
  })

  it('declares every function as a valid __stdcall prototype', () => {
    const names: string[] = []
    for (const functions of Object.values(signatures.libraries)) {
      for (const [name, [result, parameters]] of Object.entries(functions)) {
        expect(() => koffi.proto('__stdcall', name, result, [...parameters]), name).not.toThrow()
        names.push(name)
      }
    }
    expect(names).toEqual(expect.arrayContaining(['GetTokenInformation', 'DuplicateTokenEx', 'CreateProcessWithTokenW', 'GetShellWindow', 'AllowSetForegroundWindow', 'GetNamedSecurityInfoW', 'LocalFree']))
  })

  it.runIf(process.platform === 'win32')('reads this process token on Windows', () => {
    const elevation = windowsElevation()
    expect(typeof elevation.elevated).toBe('boolean')
    expect(['default', 'full', 'limited']).toContain(elevation.type)
  })

  it.runIf(process.platform === 'win32')('reads the integrity levels of this process and its executable on Windows', () => {
    expect(windowsIntegrityLevel()).toBeGreaterThanOrEqual(MEDIUM_INTEGRITY)
    expect(fileIntegrityLevel(process.execPath) ?? MEDIUM_INTEGRITY).toBeGreaterThanOrEqual(MEDIUM_INTEGRITY)
  })
})

/** The mandatory label SID S-1-16-<level>. */
function labelSid(level: number): Buffer {
  const sid = Buffer.alloc(12)
  sid.writeUInt8(1, 0)
  sid.writeUInt8(1, 1)
  sid.writeUInt8(16, 7)
  sid.writeUInt32LE(level, 8)
  return sid
}

function ace(type: number, flags: number, sid: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt8(type, 0)
  header.writeUInt8(flags, 1)
  header.writeUInt16LE(8 + sid.length, 2)
  // SYSTEM_MANDATORY_LABEL_NO_WRITE_UP
  header.writeUInt32LE(1, 4)
  return Buffer.concat([header, sid])
}

function acl(...aces: Buffer[]): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt8(2, 0)
  header.writeUInt16LE(8 + aces.reduce((size, entry) => size + entry.length, 0), 2)
  header.writeUInt16LE(aces.length, 4)
  return Buffer.concat([header, ...aces])
}

describe('integrity labels', () => {
  it('reads the level of a mandatory label SID and refuses every other SID', () => {
    expect(mandatoryLabelLevel(labelSid(0x1000))).toBe(0x1000)
    expect(mandatoryLabelLevel(labelSid(0x2000))).toBe(0x2000)
    // S-1-5-18, LocalSystem: one sub-authority under another authority.
    const system = labelSid(18)
    system.writeUInt8(5, 7)
    expect(() => mandatoryLabelLevel(system)).toThrow(RangeError)
    // Five sub-authorities: no label SID, whatever the authority.
    const user = Buffer.alloc(8 + 4 * 5)
    user.writeUInt8(1, 0)
    user.writeUInt8(5, 1)
    user.writeUInt8(16, 7)
    expect(() => mandatoryLabelLevel(user)).toThrow(RangeError)
    // Misread memory must not count as level 0.
    expect(() => mandatoryLabelLevel(Buffer.alloc(12))).toThrow(RangeError)
    expect(() => mandatoryLabelLevel(labelSid(0x1000).subarray(0, 10))).toThrow(RangeError)
  })

  it('takes the first label that applies to the object itself', () => {
    expect(aclIntegrityLevel(acl())).toBeUndefined()
    // An inherited Low label, which icacls shows as (I).
    expect(aclIntegrityLevel(acl(ace(0x11, 0x10, labelSid(0x1000))))).toBe(0x1000)
    // An access ACE is no label, and an inherit-only label applies to children alone.
    expect(aclIntegrityLevel(acl(ace(0x00, 0, labelSid(0x3000)), ace(0x11, 0x0b, labelSid(0x1000)), ace(0x11, 0x03, labelSid(0x2000))))).toBe(0x2000)
    expect(() => aclIntegrityLevel(acl(ace(0x11, 0, labelSid(0x1000))).subarray(0, 14))).toThrow(RangeError)
    expect(() => aclIntegrityLevel(acl(ace(0x11, 0, Buffer.alloc(12))))).toThrow(RangeError)
  })
})

describe('lowIntegrityAtStartup', () => {
  const FOLDER = 'C:\\Users\\Zhou\\AppData\\Local\\Programs\\DSH NEXT'
  const FILE = `${FOLDER}\\DSH NEXT.exe`
  const low = (...paths: string[]) => (path: string): number | undefined => paths.includes(path) ? 0x1000 : undefined
  const check = (overrides: Partial<LowIntegrityOptions> = {}) =>
    lowIntegrityAtStartup({ platform: 'win32', argv: [FILE], executable: FILE, integrity: () => 0x1000, fileIntegrity: low(), ...overrides })

  it('lets other platforms, the installer handoff and launches at Medium integrity or above go on', () => {
    const integrity = vi.fn(() => 0x1000)
    expect(check({ platform: 'darwin', integrity })).toBeUndefined()
    expect(check({ argv: [FILE, '--dsh-installer-quit'], integrity })).toBeUndefined()
    // Without the GPU sandbox the launch can start, and these remain a way around a wrong reading.
    expect(check({ argv: [FILE, '--no-sandbox'], integrity })).toBeUndefined()
    expect(check({ argv: [FILE, '--disable-gpu-sandbox'], integrity })).toBeUndefined()
    expect(integrity).not.toHaveBeenCalled()
    expect(check({ integrity: () => MEDIUM_INTEGRITY })).toBeUndefined()
    expect(check({ integrity: () => 0x3000 })).toBeUndefined()
    expect(check({ integrity: () => { throw new Error('koffi unavailable') } })).toBeUndefined()
  })

  it('finds the highest folder whose Low label the executable inherits', () => {
    const programs = 'C:\\Users\\Zhou\\AppData\\Local\\Programs'
    expect(check({ fileIntegrity: low(FILE, FOLDER) })).toEqual({ executable: FILE, labeled: FOLDER })
    expect(check({ fileIntegrity: low(FILE, FOLDER, programs) })).toEqual({ executable: FILE, labeled: programs })
    // A label on the file alone is cleared from its own folder.
    expect(check({ fileIntegrity: low(FILE) })).toEqual({ executable: FILE, labeled: FOLDER })
    const drive = 'D:\\DSH\\DSH NEXT.exe'
    expect(check({ executable: drive, argv: [drive], fileIntegrity: low(drive, 'D:\\DSH', 'D:\\') })).toEqual({ executable: drive, labeled: 'D:\\' })
  })

  it('blames the starting process when the executable carries no label or it cannot be read', () => {
    expect(check()).toEqual({ executable: FILE })
    expect(check({ fileIntegrity: () => { throw new Win32CallError('GetNamedSecurityInfoW', 5) } })).toEqual({ executable: FILE })
  })
})
