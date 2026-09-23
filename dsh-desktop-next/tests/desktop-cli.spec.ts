import { expect, it, vi } from 'vitest'
import { runDesktopDshCli, withDefaultDesktopProfile } from '../src/desktop-cli.ts'
import { supportsMica, windowMaterial } from '../src/window-material.ts'
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
  expect(environment).toEqual({ DSH_HOME: '/next/home' })
  expect(runCli).toHaveBeenCalledWith({ allowDesktopProfile: true })
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

it('preserves removed-Acrylic fallback and gates Mica on supported Windows builds', () => {
  expect(parsePreferences({ windowsMaterial: 'acrylic' }).windowsMaterial).toBe('off')
  expect(supportsMica('10.0.22000')).toBe(false)
  expect(supportsMica('10.0.22621')).toBe(true)
  expect(supportsMica('invalid')).toBe(false)
  expect(windowMaterial({ ...DEFAULT_PREFERENCES, windowsMaterial: 'mica' }, 'linux')).toBe('off')
  expect(windowMaterial({ ...DEFAULT_PREFERENCES }, 'darwin')).toBe('transparent')
})
