import { Buffer } from 'node:buffer'
import type {
  SubprocessHandle,
  SubprocessSpawnSpec,
  SubprocessTerminalSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import { LocalSubprocessRuntime } from '@deepseek-ai/dsh-subprocess-local'
import { describe, expect, it, vi } from 'vitest'
import {
  adaptWindowsPackagedExecutableSpawn,
  adaptWindowsAclTerminalSpawn,
  DesktopWindowsSubprocess,
  desktopWindowsCommandPath,
  isOfficialWindowsPowerShell51Terminal,
  type WindowsAclTerminalAdaptation,
} from '../src/windows-subprocess.ts'
import {
  decodeWindowsAclRelay,
  encodeWindowsAclRelay,
  quotedWindowsRelayPath,
  removeWindowsAclRelayEnvironment,
  WINDOWS_ACL_RELAY_ELECTRON,
  WINDOWS_ACL_RELAY_PAYLOAD,
  WINDOWS_ACL_RELAY_TRAMPOLINE,
} from '../src/windows-acl-relay.ts'

const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const EXECUTION_POLICY = 'PSExecutionPolicyPreference'
const commandPath = 'C:\\Windows\\System32\\cmd.exe'
const windowsPowerShell = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'
const adaptation: WindowsAclTerminalAdaptation = {
  platform: 'win32',
  electron: true,
  execPath: 'C:\\Program Files\\DSH Desktop\\DSH Desktop.exe',
  upstreamRunner: 'C:\\Program Files\\DSH Desktop\\resources\\app.asar\\runner.js',
  trampoline: 'C:\\Program Files\\DSH Desktop\\resources\\app.asar\\windows-acl-runner.js',
  env: { SystemRoot: 'C:\\Windows' },
  isFile: path => path === commandPath,
}

function terminalSpec(argv: readonly string[], env?: Record<string, string>): SubprocessTerminalSpawnSpec {
  return {
    argv,
    cwd: 'C:\\工作区 & 100%!',
    env: env ?? { KEEP: 'value', electron_run_as_node: 'stale' },
    rows: 24,
    cols: 80,
    graceMs: 1_000,
  }
}

const desktopResourcesPath = 'C:\\Program Files\\DSH Desktop\\resources'
const packagedRipgrep = `${desktopResourcesPath}\\app.asar\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`
const unpackedRipgrep = `${desktopResourcesPath}\\app.asar.unpacked\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`

function ordinarySpec(argv: readonly string[]): SubprocessSpawnSpec {
  return {
    argv,
    cwd: 'C:\\workspace',
    stdio: {
      stdin: 'ignore',
      stdout: { maxBytes: 16_384 },
      stderr: { maxBytes: 16_384 },
    },
    graceMs: 2_000,
    signal: new AbortController().signal,
    env: { KEEP: 'value' },
  }
}

describe('Windows packaged ordinary subprocess paths (#660)', () => {
  it('maps only argv[0] from the real app.asar into its physical unpacked tree', () => {
    const spec = ordinarySpec([packagedRipgrep, '--glob', packagedRipgrep])

    const result = adaptWindowsPackagedExecutableSpawn(spec, 'win32', desktopResourcesPath)

    expect(result).not.toBe(spec)
    expect(result.argv).toEqual([unpackedRipgrep, '--glob', packagedRipgrep])
    expect(result.argv).not.toBe(spec.argv)
    expect(result.cwd).toBe(spec.cwd)
    expect(result.stdio).toBe(spec.stdio)
    expect(result.graceMs).toBe(spec.graceMs)
    expect(result.signal).toBe(spec.signal)
    expect(result.env).toBe(spec.env)
    expect(spec.argv).toEqual([packagedRipgrep, '--glob', packagedRipgrep])
  })

  it('anchors the real archive even when an installation parent is also named app.asar', () => {
    const resourcesPath = 'C:\\app.asar\\DSH Desktop\\resources'
    const executable = `${resourcesPath}\\app.asar\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`

    const result = adaptWindowsPackagedExecutableSpawn(
      ordinarySpec([executable]),
      'win32',
      resourcesPath,
    )

    expect(result.argv[0]).toBe(
      `${resourcesPath}\\app.asar.unpacked\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`,
    )
  })

  it('matches the anchored archive case-insensitively', () => {
    const executable = 'c:\\program files\\dsh desktop\\RESOURCES\\APP.ASAR\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe'

    const result = adaptWindowsPackagedExecutableSpawn(
      ordinarySpec([executable]),
      'win32',
      desktopResourcesPath,
    )

    expect(result.argv[0]).toBe(unpackedRipgrep)
  })

  it('maps a fully qualified UNC executable on the same share', () => {
    const resourcesPath = '\\\\build-server\\dsh-share\\DSH Desktop\\resources'
    const executable = `${resourcesPath}\\app.asar\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`

    const result = adaptWindowsPackagedExecutableSpawn(
      ordinarySpec([executable]),
      'win32',
      resourcesPath,
    )

    expect(result.argv[0]).toBe(
      `${resourcesPath}\\app.asar.unpacked\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`,
    )
  })

  it.each([
    ['already unpacked', unpackedRipgrep, 'win32' as const],
    ['archive backup', `${desktopResourcesPath}\\app.asar.backup\\node_modules\\rg.exe`, 'win32' as const],
    ['lookalike archive', `${desktopResourcesPath}\\my-app.asar\\node_modules\\rg.exe`, 'win32' as const],
    ['unrelated archive', 'D:\\other\\app.asar\\node_modules\\rg.exe', 'win32' as const],
    ['plain executable', 'C:\\tools\\rg.exe', 'win32' as const],
    ['bare relative executable', 'resources\\app.asar\\node_modules\\rg.exe', 'win32' as const],
    ['drive-relative executable', 'C:resources\\app.asar\\node_modules\\rg.exe', 'win32' as const],
    ['root-relative executable', '\\Program Files\\DSH Desktop\\resources\\app.asar\\node_modules\\rg.exe', 'win32' as const],
    ['archive escape', `${desktopResourcesPath}\\app.asar\\..\\outside\\rg.exe`, 'win32' as const],
    ['non-Windows', packagedRipgrep, 'darwin' as const],
  ])('leaves %s unchanged by identity', (_label, executable, platform) => {
    const spec = ordinarySpec([executable, '--files'])

    const result = adaptWindowsPackagedExecutableSpawn(spec, platform, desktopResourcesPath)

    expect(result).toBe(spec)
  })

  it.each([
    ['extended device', '\\\\?\\C:\\Program Files\\DSH Desktop\\resources'],
    ['local device', '\\\\.\\C:\\Program Files\\DSH Desktop\\resources'],
  ])('leaves a %s namespace unchanged by identity', (_label, resourcesPath) => {
    const executable = `${resourcesPath}\\app.asar\\node_modules\\@vscode\\ripgrep\\bin\\rg.exe`
    const spec = ordinarySpec([executable, '--files'])

    const result = adaptWindowsPackagedExecutableSpawn(spec, 'win32', resourcesPath)

    expect(result).toBe(spec)
  })

  it('leaves an empty argv unchanged', () => {
    const spec = ordinarySpec([])
    expect(adaptWindowsPackagedExecutableSpawn(spec, 'win32', desktopResourcesPath)).toBe(spec)
  })

  it('routes the class spawn override through the packaged-path adapter', () => {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')
    const resourcesDescriptor = Object.getOwnPropertyDescriptor(process, 'resourcesPath')
    const handle = {} as SubprocessHandle
    const baseSpawn = vi.spyOn(LocalSubprocessRuntime.prototype, 'spawn').mockReturnValue(handle)
    try {
      Object.defineProperty(process, 'platform', { configurable: true, value: 'win32' })
      Object.defineProperty(process, 'resourcesPath', { configurable: true, value: desktopResourcesPath })
      const runtime = Object.create(DesktopWindowsSubprocess.prototype) as DesktopWindowsSubprocess
      const spec = ordinarySpec([packagedRipgrep, '--files'])

      expect(runtime.spawn(spec)).toBe(handle)
      expect(baseSpawn).toHaveBeenCalledOnce()
      expect(baseSpawn.mock.calls[0]?.[0].argv).toEqual([unpackedRipgrep, '--files'])
    } finally {
      baseSpawn.mockRestore()
      if (platformDescriptor !== undefined) Object.defineProperty(process, 'platform', platformDescriptor)
      if (resourcesDescriptor !== undefined) {
        Object.defineProperty(process, 'resourcesPath', resourcesDescriptor)
      } else {
        Reflect.deleteProperty(process, 'resourcesPath')
      }
    }
  })
})

describe('Windows Electron persistent-terminal relay', () => {
  it('routes only the exact ACL runner through a cmd-owned ConPTY', () => {
    const args = [
      '--workspace',
      'C:\\工作区 & 100%!',
      '--',
      'C:\\Program Files\\PowerShell\\7\\pwsh.exe',
      '-NoLogo',
    ]
    const spec = terminalSpec([adaptation.execPath, adaptation.upstreamRunner, ...args])

    const result = adaptWindowsAclTerminalSpawn(spec, adaptation)

    expect(result).not.toBe(spec)
    expect(result.argv).toEqual([
      commandPath,
      '/d',
      '/q',
      '/v:off',
      '/s',
      '/c',
      `%${WINDOWS_ACL_RELAY_ELECTRON}%`,
      `%${WINDOWS_ACL_RELAY_TRAMPOLINE}%`,
    ])
    expect(result.argv.join(' ')).not.toContain('工作区')
    expect(result.argv.join(' ')).not.toContain('PowerShell')
    expect(result.env).toEqual(expect.objectContaining({
      KEEP: 'value',
      [RUN_AS_NODE]: '1',
      [WINDOWS_ACL_RELAY_ELECTRON]: `"${adaptation.execPath}"`,
      [WINDOWS_ACL_RELAY_TRAMPOLINE]: `"${adaptation.trampoline}"`,
    }))
    expect(result.env).not.toHaveProperty('electron_run_as_node')
    expect(decodeWindowsAclRelay(result.env?.[WINDOWS_ACL_RELAY_PAYLOAD] as string)).toEqual({
      version: 1,
      runner: adaptation.upstreamRunner,
      args,
    })
    expect(result.cwd).toBe(spec.cwd)
    expect(result.rows).toBe(spec.rows)
    expect(result.cols).toBe(spec.cols)
    expect(result.graceMs).toBe(spec.graceMs)
    expect(spec.env).toEqual({ KEEP: 'value', electron_run_as_node: 'stale' })
  })

  it.each([
    ['plain Node', { electron: false }, undefined],
    ['non-Windows', { platform: 'darwin' as const }, undefined],
    ['different Electron', { execPath: 'C:\\other\\electron.exe' }, undefined],
    ['different runner', { upstreamRunner: 'C:\\other\\runner.js' }, undefined],
    ['direct PowerShell', {}, ['powershell.exe', '-NoLogo']],
  ])('leaves a %s terminal spec unchanged', (_label, override, argv) => {
    const spec = terminalSpec(argv ?? [adaptation.execPath, adaptation.upstreamRunner, '--'])

    const result = adaptWindowsAclTerminalSpawn(spec, { ...adaptation, ...override })

    expect(result).toBe(spec)
  })

  it('removes inherited relay values case-insensitively before installing its own payload', () => {
    const spec = terminalSpec([adaptation.execPath, adaptation.upstreamRunner, '--', 'powershell.exe'], {
      dsh_desktop_acl_relay_v1: 'forged',
      Dsh_Desktop_Acl_Electron: 'forged',
      dsh_desktop_acl_trampoline: 'forged',
      electron_run_as_node: 'forged',
    })

    const result = adaptWindowsAclTerminalSpawn(spec, adaptation)

    expect(result.env).not.toHaveProperty('dsh_desktop_acl_relay_v1')
    expect(result.env).not.toHaveProperty('Dsh_Desktop_Acl_Electron')
    expect(result.env).not.toHaveProperty('dsh_desktop_acl_trampoline')
    expect(result.env).not.toHaveProperty('electron_run_as_node')
    expect(result.env?.[RUN_AS_NODE]).toBe('1')
    expect(decodeWindowsAclRelay(result.env?.[WINDOWS_ACL_RELAY_PAYLOAD] as string).args)
      .toEqual(['--', 'powershell.exe'])
  })

  it('sets process-scope Bypass only for the exact official Windows PowerShell 5.1 terminal', () => {
    const args = [
      '--workspace',
      'C:\\workspace',
      '--mode',
      'read-only',
      '--',
      windowsPowerShell,
      '-NoLogo',
      '-NoProfile',
    ]
    const spec = terminalSpec([adaptation.execPath, adaptation.upstreamRunner, ...args], {
      psExecutionPolicyPreference: 'RemoteSigned',
      KEEP: 'value',
    })

    const result = adaptWindowsAclTerminalSpawn(spec, adaptation)

    expect(result.env).not.toHaveProperty('psExecutionPolicyPreference')
    expect(result.env?.[EXECUTION_POLICY]).toBe('Bypass')
    expect(decodeWindowsAclRelay(result.env?.[WINDOWS_ACL_RELAY_PAYLOAD] as string).args).toEqual(args)
    expect(spec.env).toEqual({ psExecutionPolicyPreference: 'RemoteSigned', KEEP: 'value' })
  })

  it.each([
    ['PowerShell 7', ['--', 'C:\\Program Files\\PowerShell\\7\\pwsh.exe', '-NoLogo', '-NoProfile']],
    ['custom argument', ['--', windowsPowerShell, '-NoLogo', '-NoProfile', '-NoExit']],
    ['missing argument', ['--', windowsPowerShell, '-NoLogo']],
    ['relative executable', ['--', 'powershell.exe', '-NoLogo', '-NoProfile']],
    ['no runner separator', [windowsPowerShell, '-NoLogo', '-NoProfile']],
  ])('does not change execution policy for %s', (_label, args) => {
    const spec = terminalSpec([adaptation.execPath, adaptation.upstreamRunner, ...args], {
      [EXECUTION_POLICY]: 'RemoteSigned',
    })

    const result = adaptWindowsAclTerminalSpawn(spec, adaptation)

    expect(result.env?.[EXECUTION_POLICY]).toBe('RemoteSigned')
  })
})

describe('Windows PowerShell 5.1 terminal recognition', () => {
  it('uses Windows path semantics and a case-insensitive SystemRoot key', () => {
    expect(isOfficialWindowsPowerShell51Terminal(
      ['--workspace', 'C:\\workspace', '--', 'c:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe', '-NoLogo', '-NoProfile'],
      { systemroot: 'C:\\Windows' },
    )).toBe(true)
  })

  it('fails closed without SystemRoot', () => {
    expect(isOfficialWindowsPowerShell51Terminal(
      ['--', windowsPowerShell, '-NoLogo', '-NoProfile'],
      {},
    )).toBe(false)
  })
})

describe('Windows ACL relay protocol', () => {
  it('round-trips Unicode and shell metacharacters without command interpolation', () => {
    const encoded = encodeWindowsAclRelay('C:\\程序\\runner.js', [
      'C:\\space & percent% bang! caret^\\目录',
      'single\'quote',
      '',
    ])

    expect(encoded).toMatch(/^[A-Za-z0-9_-]+$/u)
    expect(decodeWindowsAclRelay(encoded)).toEqual({
      version: 1,
      runner: 'C:\\程序\\runner.js',
      args: ['C:\\space & percent% bang! caret^\\目录', 'single\'quote', ''],
    })
  })

  it.each([
    ['', 'canonical Base64URL'],
    ['***', 'canonical Base64URL'],
    [Buffer.from('{', 'utf8').toString('base64url'), 'valid JSON'],
    [Buffer.from(JSON.stringify({ version: 2, runner: 'runner.js', args: [] }), 'utf8').toString('base64url'), 'unsupported shape or version'],
    [Buffer.from(JSON.stringify({ version: 1, runner: '', args: [] }), 'utf8').toString('base64url'), 'non-empty NUL-free string'],
    [Buffer.from(JSON.stringify({ version: 1, runner: 'runner.js', args: [1] }), 'utf8').toString('base64url'), 'NUL-free string'],
  ])('rejects invalid payload %#', (encoded, message) => {
    expect(() => decodeWindowsAclRelay(encoded)).toThrow(message)
  })

  it('validates relay paths before quoting them', () => {
    expect(quotedWindowsRelayPath('C:\\Program Files\\DSH\\app.exe', 'app'))
      .toBe('"C:\\Program Files\\DSH\\app.exe"')
    expect(() => quotedWindowsRelayPath('relative\\app.exe', 'app')).toThrow('absolute Windows path')
    expect(() => quotedWindowsRelayPath('C:\\bad"path\\app.exe', 'app')).toThrow('without quotes')
    expect(() => quotedWindowsRelayPath('C:\\bad\npath\\app.exe', 'app')).toThrow('control characters')
  })

  it('removes every relay environment key case-insensitively', () => {
    const env = {
      dsh_desktop_acl_relay_v1: 'payload',
      Dsh_Desktop_Acl_Electron: 'electron',
      dsh_desktop_acl_trampoline: 'trampoline',
      KEEP: 'value',
    }

    removeWindowsAclRelayEnvironment(env)

    expect(env).toEqual({ KEEP: 'value' })
  })
})

describe('Windows cmd.exe resolution', () => {
  it('resolves only the regular System32 command interpreter', () => {
    expect(desktopWindowsCommandPath({ systemroot: 'C:\\Windows', ComSpec: 'D:\\fake.cmd' }, 'win32', path => path === commandPath))
      .toBe(commandPath)
  })

  it('does not resolve cmd.exe off Windows', () => {
    expect(desktopWindowsCommandPath({}, 'darwin', () => true)).toBeUndefined()
  })

  it.each([
    [{}, 'requires SystemRoot'],
    [{ SystemRoot: 'relative' }, 'absolute Windows path'],
    [{ SystemRoot: 'C:\\bad"root' }, 'without quotes'],
    [{ SystemRoot: 'C:\\missing' }, 'not a regular file'],
  ])('fails closed for an invalid system root %#', (env, message) => {
    expect(() => desktopWindowsCommandPath(env, 'win32', () => false)).toThrow(message)
  })
})
