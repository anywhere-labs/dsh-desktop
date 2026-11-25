import assert from 'node:assert/strict'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { EventEmitter } from 'node:events'
import test from 'node:test'
import { appBundle, BACKGROUND_ARGUMENT, desktopLaunch, launchEnvironment, startDesktop, waitForDsh, windowsPowerShell,
  type DesktopLaunch, type RunPowerShell, type ScriptResult, type Spawn } from '../../src/autostart.js'

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

test('an app is started with its window shown; only a process without windows hides its console', async () => {
  const direct = fakeSpawn(child => child.emit('spawn'))
  await startDesktop(desktopLaunch('C:\\DSH NEXT\\DSH NEXT.exe', 'win32', true)!, { spawn: direct.spawn, env: {} })
  // Hidden, Next/Beta started in the background would swallow the window of the first tray click.
  assert.equal(direct.calls[0]?.options.windowsHide, false)
  const node = fakeSpawn(child => child.emit('spawn'))
  await startDesktop({ ...desktopLaunch('C:\\DSH\\DSH.exe', 'win32', true)!, windowsHide: true }, { spawn: node.spawn, env: {} })
  assert.equal(node.calls[0]?.options.windowsHide, true)
})

function fakePowerShell(result: ScriptResult): { powershell: RunPowerShell, scripts: Array<{ script: string, env: NodeJS.ProcessEnv }> } {
  const scripts: Array<{ script: string, env: NodeJS.ProcessEnv }> = []
  return { scripts, powershell: async (script, env) => { scripts.push({ script, env }); return result } }
}

test('explorer starts an app without a background start hidden, and the app is started directly when it cannot', async () => {
  const home = 'C:\\Users\\张三\\.dsh'
  const launch: DesktopLaunch = { name: 'DeepSeek Harness', command: 'C:\\Users\\张三\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe',
    args: [], waitForExit: false, environment: { DSH_HOME: home }, hiddenStart: { dshHome: home } }
  const direct = fakeSpawn(child => child.emit('spawn'))
  const explorer = fakePowerShell({ code: 0, stdout: 'started\r\n', stderr: '' })
  assert.deepEqual(await startDesktop(launch, { spawn: direct.spawn, env: { SystemRoot: 'C:\\Windows', ELECTRON_RUN_AS_NODE: '1' }, powershell: explorer.powershell }), {})
  assert.equal(direct.calls.length, 0, 'explorer started the app, so it has no right to the editor\'s foreground')
  const { script, env } = explorer.scripts[0]!
  assert.match(script, /ShellExecute\(\$env:DSH_ACP_START_FILE, '', \$env:DSH_ACP_START_DIRECTORY, 'open', 0\)/u, 'show command SW_HIDE')
  const homeCheck = script.indexOf('DSH_ACP_START_HOME')
  assert.ok(homeCheck > 0 && homeCheck < script.indexOf('ShellExecute'), 'the data directory is checked before the start')
  assert.doesNotMatch(script, /张三|DeepSeek Harness/u, 'paths travel as environment variables, never inside the script')
  assert.deepEqual([env.DSH_ACP_START_FILE, env.DSH_ACP_START_DIRECTORY, env.DSH_ACP_START_HOME, env.ELECTRON_RUN_AS_NODE],
    [launch.command, 'C:\\Users\\张三\\AppData\\Local\\Programs\\DeepSeek Harness', home, undefined])

  const failures: Array<[ScriptResult, RegExp]> = [
    [{ code: 3, stdout: '', stderr: '' }, /数据目录不是 C:\\Users\\张三\\\.dsh$/u],
    [{ code: 4, stdout: '', stderr: '' }, /^没有找到资源管理器的桌面$/u],
    [{ code: 1, stdout: '', stderr: 'New-Object : Cannot create the COM object\r\nAt line:1 char:1' }, /以 1 退出：New-Object : Cannot create the COM object$/u],
    [{ code: null, stdout: '', stderr: 'spawn C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe ENOENT' }, /^无法运行 Windows PowerShell：spawn /u],
    [{ code: 0, stdout: '', stderr: '' }, /以 0 退出$/u],
  ]
  for (const [result, reason] of failures) {
    const fallback = fakeSpawn(child => child.emit('spawn'))
    const started = await startDesktop(launch, { spawn: fallback.spawn, env: {}, powershell: fakePowerShell(result).powershell })
    assert.match(started.notHidden ?? '', reason)
    assert.equal(fallback.calls.length, 1, 'without explorer the app is started directly')
    assert.equal(started.child, fallback.calls[0]?.child)
    assert.equal(fallback.calls[0]?.options.windowsHide, false, 'its window shows rather than taking focus unseen')
    assert.equal(fallback.calls[0]?.options.env?.DSH_HOME, home, 'a direct start passes the data directory itself')
  }
})

test('Windows PowerShell is found by path, never through PATH', () => {
  assert.equal(windowsPowerShell({ SystemRoot: 'D:\\WINDOWS', PATH: 'C:\\evil' }), 'D:\\WINDOWS\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(windowsPowerShell({ SYSTEMROOT: 'E:\\Win' }), 'E:\\Win\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
  assert.equal(windowsPowerShell({}), 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
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
