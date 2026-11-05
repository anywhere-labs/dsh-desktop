import { join } from 'node:path'
import { expect, it } from 'vitest'
import { dshCommandArguments, dshCommandInvocation } from '../src/dsh-command.ts'

const executable = '/opt/app/desktop'

it('reads `<app> dsh …` on Linux, including behind the --no-sandbox an AppImage AppRun inserts', () => {
  expect(dshCommandArguments([executable, 'dsh', 'plugin', 'list'], 'linux', false)).toEqual(['plugin', 'list'])
  expect(dshCommandArguments([executable, '--no-sandbox', 'dsh', '--version'], 'linux', false)).toEqual(['--version'])
  expect(dshCommandArguments([executable, 'dsh'], 'linux', false)).toEqual([])
  // A development run passes the application directory first.
  expect(dshCommandArguments(['/repo/node_modules/electron/dist/electron', '/repo/dsh-plugin-desktop-beta', 'dsh', 'web'], 'linux', true)).toEqual(['web'])
})

it('leaves every other launch to the desktop', () => {
  expect(dshCommandArguments([executable], 'linux', false)).toBeUndefined()
  expect(dshCommandArguments([executable, '--no-sandbox'], 'linux', false)).toBeUndefined()
  expect(dshCommandArguments([executable, '--next-safe-mode', 'dsh'], 'linux', false)).toBeUndefined()
  expect(dshCommandArguments([executable, 'dsh-app://app/'], 'linux', false)).toBeUndefined()
  expect(dshCommandArguments(['/repo/node_modules/electron/dist/electron', '/repo/dsh-plugin-desktop-beta'], 'linux', true)).toBeUndefined()
  expect(dshCommandArguments(['/Applications/DSH Desktop Beta.app/Contents/MacOS/DSH Desktop Beta', 'dsh'], 'darwin', false)).toBeUndefined()
  expect(dshCommandArguments(['C:\\Program Files\\DSH Desktop Beta\\DSH Desktop Beta.exe', 'dsh'], 'win32', false)).toBeUndefined()
})

it('runs the packaged CLI in Node mode on the desktop data directory and selected Profile', () => {
  const environment = { PATH: '/usr/bin', DSH_HOME: '/home/user/.dsh', DSH_DESKTOP_DEFAULT_PROFILE: 'stale' }
  const command = dshCommandInvocation({ executable, root: '/opt/app/resources/app.asar', args: ['plugin', 'list'],
    home: '/home/user/desktop-data', profile: 'work', environment })
  expect(command).toEqual({
    file: executable,
    args: [executable, '--expose-internals', join('/opt/app/resources/app.asar', 'lib', 'desktop-cli.js'), 'plugin', 'list'],
    env: { PATH: '/usr/bin', ELECTRON_RUN_AS_NODE: '1', DSH_HOME: '/home/user/desktop-data', DSH_DESKTOP_DEFAULT_PROFILE: 'work' },
  })
  expect(environment).toEqual({ PATH: '/usr/bin', DSH_HOME: '/home/user/.dsh', DSH_DESKTOP_DEFAULT_PROFILE: 'stale' })
  // Without a readable selection, an inherited default must not pick the Profile either.
  expect(dshCommandInvocation({ executable, root: '/opt/app', args: [], home: '/home/user/desktop-data', profile: undefined, environment }).env)
    .not.toHaveProperty('DSH_DESKTOP_DEFAULT_PROFILE')
})
