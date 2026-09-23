import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import AdmZip from 'adm-zip'
import {
  defaultDesktopUserDataDirectory,
  DESKTOP_CLI_HELP,
  parseDesktopCli,
  parseDesktopCliRequest,
  runDesktopCli,
} from '../src/bin.ts'

vi.mock('electron', () => ({ default: undefined }))

describe('desktop npm launcher', () => {
  it('launches with no arguments', () => {
    expect(parseDesktopCli([])).toBe('launch')
  })

  it.each([
    ['--help', 'help'],
    ['-h', 'help'],
    ['--version', 'version'],
    ['-V', 'version'],
    ['--export-diagnostics', 'export-diagnostics'],
  ] as const)('parses %s', (argument, action) => {
    expect(parseDesktopCli([argument])).toBe(action)
  })

  it('rejects arguments that belong to the profile app', () => {
    expect(() => parseDesktopCli(['--port', '3000'])).toThrow('unknown arguments')
  })

  it('takes one folder to register and open', () => {
    expect(parseDesktopCli(['C:\\Work'])).toBe('launch')
    expect(parseDesktopCliRequest([])).toEqual({ action: 'launch' })
    const cwd = mkdtempSync(join(tmpdir(), 'dsh-cli-workspace-'))
    expect(parseDesktopCliRequest(['work'], cwd))
      .toEqual({ action: 'launch', workspacePath: resolve(cwd, 'work') })
    expect(parseDesktopCliRequest([resolve(cwd, 'work')], cwd))
      .toEqual({ action: 'launch', workspacePath: resolve(cwd, 'work') })
    expect(parseDesktopCliRequest(['--help'])).toEqual({ action: 'help' })
  })

  it('names the installed product and selected profile behavior', () => {
    expect(DESKTOP_CLI_HELP).toContain('DSH Desktop')
    expect(DESKTOP_CLI_HELP).toContain('[folder]')
    expect(DESKTOP_CLI_HELP).toContain('register the folder as a workspace')
    expect(DESKTOP_CLI_HELP).toContain('selected Web-capable profile')
    expect(DESKTOP_CLI_HELP).toContain('--export-diagnostics')
  })

  it('resolves the packaged Desktop user-data directory without Electron', () => {
    expect(defaultDesktopUserDataDirectory('win32', { APPDATA: 'C:\\Users\\Example\\AppData\\Roaming' }, 'ignored'))
      .toBe('C:\\Users\\Example\\AppData\\Roaming\\DSH Desktop')
    expect(defaultDesktopUserDataDirectory('darwin', {}, '/Users/example'))
      .toBe('/Users/example/Library/Application Support/DSH Desktop')
  })

  it('exports diagnostics without launching Electron', async () => {
    const userDataDir = mkdtempSync(join(tmpdir(), 'dsh-cli-diagnostics-'))
    const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
    try {
      await expect(runDesktopCli(['--export-diagnostics'], { userDataDir })).resolves.toBe(0)
      const output = String(write.mock.calls.at(-1)?.[0]).trim()
      expect(existsSync(output)).toBe(true)
      expect(new AdmZip(output).readAsText('system-info.txt')).toMatch(/desktop-version: \d/u)
    } finally {
      write.mockRestore()
    }
  })

  it('reports a clear message when electron is missing', async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    try {
      const code = await runDesktopCli([])
      expect(code).toBe(1)
      expect(write).toHaveBeenCalledWith(expect.stringContaining('electron is not available'))
      expect(write).toHaveBeenCalledWith(expect.stringContaining('npm install -g dsh-plugin-desktop'))
    } finally {
      write.mockRestore()
    }
  })
})
