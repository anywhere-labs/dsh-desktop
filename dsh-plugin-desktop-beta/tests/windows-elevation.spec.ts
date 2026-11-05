/** Windows elevation decisions and Win32 declarations, checked without starting a process. */
import { createRequire } from 'node:module'
import { describe, expect, it, vi } from 'vitest'
import { DE_ELEVATED_ARGUMENT } from '../src/relaunch.ts'
import {
  deElevateAtStartup, ERROR_ELEVATION_REQUIRED, KEEP_ELEVATED_ARGUMENT, quoteWindowsArgument, Win32CallError, win32Signatures, windowsElevation,
  type StartupElevationOptions, type WindowsElevation,
} from '../src/windows-elevation.ts'

const EXECUTABLE = 'C:\\Program Files\\DSH Desktop Beta\\DSH Desktop Beta.exe'
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
    expect(names).toEqual(expect.arrayContaining(['GetTokenInformation', 'DuplicateTokenEx', 'CreateProcessWithTokenW', 'GetShellWindow', 'AllowSetForegroundWindow']))
  })

  it.runIf(process.platform === 'win32')('reads this process token on Windows', () => {
    const elevation = windowsElevation()
    expect(typeof elevation.elevated).toBe('boolean')
    expect(['default', 'full', 'limited']).toContain(elevation.type)
  })
})
