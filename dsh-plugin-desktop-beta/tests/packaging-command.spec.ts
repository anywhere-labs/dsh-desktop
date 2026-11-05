import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { runNextPackagingCommand } from '../scripts/packaging-command.ts'

vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }))
const spawn = vi.mocked(spawnSync)
afterEach(() => spawn.mockReset())
const succeeded: ReturnType<typeof spawnSync> = { status: 0, output: [], pid: 1, signal: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }

it('routes the root check gate directly to Next package preflight and honours DSH_PACKAGE_CHECK_ALREADY_RAN', () => {
  const env = { PATH: '/test/bin' }
  spawn.mockReturnValue(succeeded)
  runNextPackagingCommand('yarn', ['run', 'check'], '/workspace', env, '/workspace')
  expect(spawn.mock.calls.map(call => call[1])).toEqual([['workspace', 'dsh-plugin-desktop-beta', 'check:mac-package']])
  expect(spawn.mock.calls.every(call => call[2]?.env === env)).toBe(true)
  spawn.mockReset()
  runNextPackagingCommand('yarn', ['run', 'check'], '/workspace', { ...env, DSH_PACKAGE_CHECK_ALREADY_RAN: '1' }, '/workspace')
  expect(spawn).not.toHaveBeenCalled()
  spawn.mockReset().mockReturnValue({ ...succeeded, status: 1 })
  expect(() => runNextPackagingCommand('yarn', ['run', 'check'], '/workspace', env, '/workspace')).toThrow('Packaging command failed')
  expect(spawn).toHaveBeenCalledOnce()
})

it('routes the shared Windows package gate to Next without adding unrelated commands', () => {
  spawn.mockReturnValue(succeeded)
  runNextPackagingCommand('cmd.exe', ['/d', '/s', '/c', 'corepack yarn workspace dsh-plugin-desktop check:win-package'], '/workspace', {}, '/workspace')
  expect(spawn).toHaveBeenCalledOnce()
  expect(spawn.mock.calls[0]?.[1]).toContain('corepack yarn workspace dsh-plugin-desktop-beta check:win-package')
  spawn.mockReset().mockReturnValue(succeeded)
  const betaScript = `/workspace/dsh-plugin-desktop${'-beta'}/scripts/verify-mac-smoke.ts`
  runNextPackagingCommand('node', ['/workspace/dsh-plugin-desktop-beta/scripts/verify-mac-smoke.ts', betaScript], '/workspace', {}, '/workspace')
  expect(spawn.mock.calls[0]?.[1]).toEqual(['/workspace/dsh-plugin-desktop-beta/scripts/verify-mac-smoke.ts', betaScript])
})
