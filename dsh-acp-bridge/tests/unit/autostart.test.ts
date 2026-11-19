import assert from 'node:assert/strict'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { appBundle, BACKGROUND_ARGUMENT, desktopLaunch, launchEnvironment, startDesktop, waitForDsh, type Spawn } from '../../src/autostart.js'

test('the launcher starts the DSH Desktop whose executable runs it, in the background', () => {
  assert.deepEqual(desktopLaunch('/Applications/DSH NEXT.app/Contents/MacOS/DSH NEXT', 'darwin', true), {
    name: 'DSH NEXT', command: 'open', args: ['-n', '-g', '/Applications/DSH NEXT.app', '--args', BACKGROUND_ARGUMENT], waitForExit: true,
  }, 'macOS starts the bundle through LaunchServices')
  assert.deepEqual(desktopLaunch('C:\\Program Files\\DSH NEXT\\DSH NEXT.EXE', 'win32', true), {
    name: 'DSH NEXT', command: 'C:\\Program Files\\DSH NEXT\\DSH NEXT.EXE', args: [BACKGROUND_ARGUMENT], waitForExit: false,
  })
  assert.deepEqual(desktopLaunch('/opt/DSH NEXT/dsh-desktop-next', 'linux', true), {
    name: 'dsh-desktop-next', command: '/opt/DSH NEXT/dsh-desktop-next', args: [BACKGROUND_ARGUMENT], waitForExit: false,
  })
  assert.equal(desktopLaunch('/usr/local/bin/node', 'linux', false), undefined, 'a launcher on Node.js has no app to start')
  assert.equal(desktopLaunch('/opt/electron/electron', 'darwin', true), undefined, 'an executable outside an app bundle is not started')
  assert.equal(appBundle('/Applications/A.app/Contents/Resources/A'), undefined)
})

test('a directly started app leaves the Node mode of the launcher behind', () => {
  assert.deepEqual(launchEnvironment({
    PATH: '/bin', ELECTRON_RUN_AS_NODE: '1', electron_run_as_node: '1', ELECTRON_NO_ATTACH_CONSOLE: '1', NODE_OPTIONS: '--require /x.js',
    ELECTRON_OZONE_PLATFORM_HINT: 'wayland',
  }), { PATH: '/bin', ELECTRON_OZONE_PLATFORM_HINT: 'wayland' })
})

type FakeChild = EventEmitter & { unrefed: boolean, unref(): void }

function fakeSpawn(behave: (child: FakeChild) => void): { spawn: Spawn, calls: Array<{ command: string, args: readonly string[], options: SpawnOptions, child: FakeChild }> } {
  const calls: Array<{ command: string, args: readonly string[], options: SpawnOptions, child: FakeChild }> = []
  const spawn: Spawn = (command, args, options) => {
    const child: FakeChild = Object.assign(new EventEmitter(), { unrefed: false, unref() { child.unrefed = true } })
    calls.push({ command, args, options, child })
    queueMicrotask(() => behave(child))
    return child as unknown as ChildProcess
  }
  return { spawn, calls }
}

test('`open` is waited for; a directly started app is handed off', async () => {
  const mac = desktopLaunch('/Applications/D.app/Contents/MacOS/D', 'darwin', true)!
  const opened = fakeSpawn(child => child.emit('exit', 0, null))
  await startDesktop(mac, { spawn: opened.spawn, env: { HOME: '/h', ELECTRON_RUN_AS_NODE: '1' } })
  assert.equal(opened.calls[0]?.command, 'open')
  assert.equal(opened.calls[0]?.options.detached, false)
  assert.deepEqual(opened.calls[0]?.options.env, { HOME: '/h' })
  await assert.rejects(startDesktop(mac, { spawn: fakeSpawn(child => child.emit('exit', 1, null)).spawn, env: {} }), /open 以 1 退出/u)

  const linux = desktopLaunch('/opt/d/d', 'linux', true)!
  const direct = fakeSpawn(child => child.emit('spawn'))
  await startDesktop(linux, { spawn: direct.spawn, env: {} })
  assert.equal(direct.calls[0]?.options.detached, true)
  assert.equal(direct.calls[0]?.child.unrefed, true, 'the launcher does not wait for the app it started')
  const missing = Object.assign(new Error('spawn /opt/d/d ENOENT'), { code: 'ENOENT' })
  await assert.rejects(startDesktop(linux, { spawn: fakeSpawn(child => child.emit('error', missing)).spawn, env: {} }), /ENOENT/u)
})

class NotYet extends Error {}

test('waiting retries until DSH answers and gives up with the last failure', async () => {
  let attempts = 0
  assert.equal(await waitForDsh(async () => {
    if (++attempts < 3) throw new NotYet('not yet')
    return 'connected'
  }, error => error instanceof NotYet, { timeoutMs: 5_000, intervalMs: 5 }), 'connected')
  assert.equal(attempts, 3)
  await assert.rejects(waitForDsh(async () => { throw new NotYet('still nothing') }, error => error instanceof NotYet,
    { timeoutMs: 60, intervalMs: 5 }), /still nothing/u)
  let other = 0
  await assert.rejects(waitForDsh(async () => { other++; throw new Error('refused') }, error => error instanceof NotYet,
    { timeoutMs: 5_000, intervalMs: 5 }), /refused/u)
  assert.equal(other, 1, 'a failure that waiting cannot fix is not retried')
})
