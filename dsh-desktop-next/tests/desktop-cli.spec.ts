import { delimiter, dirname, join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { desktopCliPackageManager, runDesktopDshCli, withDefaultDesktopProfile } from '../src/desktop-cli.ts'
import { bundledPnpmEntry } from '../src/bundled-pnpm.ts'
import { NEXT_PACKAGE } from '../src/profiles.ts'
import { PNPM_IGNORE_MINIMUM_RELEASE_AGE } from '../src/pnpm-policy.ts'
import { windowMaterial } from '../src/window-material.ts'
import { DEFAULT_PREFERENCES } from '../src/desktop-contract.ts'
import { parsePreferences } from '../src/desktop-preferences.ts'

it('keeps CLI commands on the selected Next Profile without overriding an explicit Profile', async () => {
  expect(withDefaultDesktopProfile(['plugin', 'list'], 'work')).toEqual(['plugin', '--profile', 'work', 'list'])
  expect(withDefaultDesktopProfile(['--profile', 'personal'], 'work')).toEqual(['--profile', 'personal'])
  expect(withDefaultDesktopProfile(['--version'], 'work')).toEqual(['--version'])
  expect(() => withDefaultDesktopProfile([], '../escape')).toThrow()
  const environment = { ELECTRON_RUN_AS_NODE: '1', DSH_DESKTOP_DEFAULT_PROFILE: 'work', DSH_HOME: '/next/home' }
  const argv = ['node', '/next/desktop-cli.js', 'plugin', 'list']
  const runCli = vi.fn(async () => {})
  await runDesktopDshCli(environment, async () => ({ runCli }), argv)
  expect(argv.slice(2)).toEqual(['plugin', '--profile', 'work', 'list'])
  expect(environment).toEqual({ DSH_HOME: '/next/home',
    pnpm_config_minimum_release_age: '0', pnpm_config_update_notifier: 'false', YARN_NPM_MINIMAL_AGE_GATE: '0' })
  expect(runCli).toHaveBeenCalledWith({ manageDesktopProfile: true, packageManager: desktopCliPackageManager() })
})

it('runs terminal package operations with the bundled pnpm and Electron native-module settings', () => {
  const invocation = desktopCliPackageManager('44.7.0')
  expect(invocation.command).toBe(process.execPath)
  expect(invocation.args).toEqual(['--expose-internals', bundledPnpmEntry(NEXT_PACKAGE), PNPM_IGNORE_MINIMUM_RELEASE_AGE])
  expect(invocation.env).toMatchObject({
    DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
    npm_config_runtime: 'electron',
    npm_config_target: '44.7.0',
    npm_config_disturl: 'https://electronjs.org/headers',
  })
  expect(invocation.env.PATH?.split(delimiter)[0]).toBe(join(dirname(NEXT_PACKAGE), 'scripts', 'node-bin'))
  expect(desktopCliPackageManager(undefined).env).not.toHaveProperty('npm_config_runtime')
})

it('reads user files physically before the unpacked CLI starts', async () => {
  const asarProcess: { noAsar?: boolean } = {}
  const load = vi.fn(async () => {
    expect(asarProcess.noAsar).toBe(true)
    return { runCli: async () => {} }
  })
  await runDesktopDshCli({}, load, ['node', '/next/desktop-cli.js', '--version'], asarProcess)
  expect(load).toHaveBeenCalledOnce()
})

it('reads removed Windows Acrylic and Mica preferences as an opaque window', () => {
  expect(parsePreferences({ windowsMaterial: 'acrylic' }).windowsMaterial).toBe('off')
  expect(parsePreferences({ windowsMaterial: 'mica' }).windowsMaterial).toBe('off')
  expect(windowMaterial({ ...DEFAULT_PREFERENCES }, 'win32')).toBe('off')
  expect(windowMaterial({ ...DEFAULT_PREFERENCES }, 'linux')).toBe('off')
  expect(windowMaterial({ ...DEFAULT_PREFERENCES }, 'darwin')).toBe('transparent')
  expect(windowMaterial({ ...DEFAULT_PREFERENCES, macosMaterial: 'off' }, 'darwin')).toBe('off')
})
