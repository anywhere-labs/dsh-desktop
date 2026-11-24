import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { RPC_SERVICE } from '../../src/contract.js'
import type { EndpointRecord } from '../../src/endpoint.js'
import { launchInfo, launcherScript, launcherSuccession, type LauncherTarget } from '../../src/launcher.js'

test('the launch description lets programs that cannot run the script start the bridge themselves', () => {
  // Windows programs that start processes without a shell cannot run `dsh-acp.cmd`.
  assert.deepEqual(launchInfo({ runtime: 'C:\\Program Files\\DSH NEXT\\DSH NEXT.exe', electron: true, script: 'C:\\p\\lib\\stdio.js' }),
    { version: 1, command: 'C:\\Program Files\\DSH NEXT\\DSH NEXT.exe', args: ['C:\\p\\lib\\stdio.js'], env: { ELECTRON_RUN_AS_NODE: '1' } })
  assert.deepEqual(launchInfo({ runtime: 'node', electron: false, script: '/p/lib/stdio.js' }),
    { version: 1, command: 'node', args: ['/p/lib/stdio.js'], env: {} })
  // What the launcher passes on: its ACP directory and the data directory of the app it belongs to.
  const runtime = '/Applications/DSH NEXT.app/Contents/MacOS/DSH NEXT'
  assert.deepEqual(launchInfo({ runtime, electron: true, script: '/p/lib/stdio.js', home: '/h/acp', dshHome: '/h/.dsh' }),
    { version: 1, command: runtime, args: ['/p/lib/stdio.js', '--home', '/h/acp'], env: { DSH_HOME: '/h/.dsh', ELECTRON_RUN_AS_NODE: '1' } })
})

test('the launcher names a missing plugin or DSH instead of failing inside the runtime', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-launcher-'))
  try {
    const script = join(directory, 'stdio.js')
    const launcher = join(directory, 'dsh-acp')
    const run = (target: LauncherTarget) => {
      writeFileSync(launcher, launcherScript(target), { mode: 0o700 })
      return spawnSync('/bin/sh', [launcher, '--check', 'a b'], { encoding: 'utf8' })
    }
    let result = run({ runtime: process.execPath, electron: false, script })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /找不到插件文件 .*stdio\.js：插件可能已从 DSH 中移除。请在 DSH 中重新安装并启用插件/u)
    writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)))')
    result = run({ runtime: join(directory, 'gone', 'DSH'), electron: true, script })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /找不到 DSH 程序 .*gone\/DSH：DSH 可能已卸载或移动/u)
    result = run({ runtime: process.execPath, electron: false, script })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), ['--check', 'a b'])
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('an AppImage launcher asks for DSH to run; a command from PATH is left to the shell', () => {
  assert.match(launcherScript({ runtime: '/tmp/.mount_DSH_NEabc123/dsh-desktop-next', electron: true, script: '/home/me/.dsh/stdio.js' }, 'linux'),
    /AppImage 版的 DSH 运行时才能使用这个启动脚本，请先打开 DSH/u)
  assert.doesNotMatch(launcherScript({ runtime: 'node', electron: false, script: '/s.js' }, 'linux'), /-x/u)
})

test('the Windows launcher checks both paths and reads its messages as UTF-8', () => {
  const lines = launcherScript({ runtime: 'C:\\Program Files\\DSH & Co\\DSH.exe', electron: true, script: 'C:\\Users\\a%b\\stdio.js' }, 'win32').split('\r\n')
  assert.ok(lines.includes('if not exist "C:\\Users\\a%%b\\stdio.js" goto missing_plugin'))
  assert.ok(lines.includes('if not exist "C:\\Program Files\\DSH & Co\\DSH.exe" goto missing_runtime'))
  assert.ok(lines.includes('"C:\\Program Files\\DSH & Co\\DSH.exe" "C:\\Users\\a%%b\\stdio.js" %*'))
  assert.equal(lines[lines.indexOf('"C:\\Program Files\\DSH & Co\\DSH.exe" "C:\\Users\\a%%b\\stdio.js" %*') + 1], 'exit /b %ERRORLEVEL%')
  const plugin = lines.findIndex(line => line.startsWith('>&2 echo dsh-acp-bridge: 找不到插件文件'))
  const runtime = lines.findIndex(line => line.startsWith('>&2 echo dsh-acp-bridge: 找不到 DSH 程序'))
  assert.equal(lines[plugin - 1], 'chcp 65001 >nul', 'cmd switches to UTF-8 before it reads the message')
  assert.equal(lines[runtime - 1], 'chcp 65001 >nul')
  assert.match(lines[plugin]!, /a%%b\\stdio\.js：/u)
  assert.match(lines[runtime]!, /DSH \^& Co/u, 'echo text escapes the batch operators')
})

function record(instanceId: string, launcher?: LauncherTarget): EndpointRecord {
  return { version: 1, protocol: 'meshcall', service: RPC_SERVICE, instanceId, pid: 1, startedAt: '2026-11-19T00:00:00.000Z',
    endpoint: { unixPath: `/s/${instanceId}.sock` }, token: 't'.repeat(43), bridgeVersion: '1.0.0', ...(launcher ? { launcher } : {}) }
}

test('a plugin that unloads hands its launcher to another running DSH serving the plugin, or removes it', () => {
  const own: LauncherTarget = { runtime: '/Applications/A.app/Contents/MacOS/A', electron: true, script: '/a/lib/stdio.js' }
  const written = launcherScript(own, 'darwin')
  const exists = (path: string) => !path.includes('gone')
  assert.deepEqual(launcherSuccession(own, undefined, [], exists, 'darwin'), { action: 'keep' }, 'nothing is left to withdraw')
  assert.deepEqual(launcherSuccession(own, launcherScript({ ...own, script: '/b/lib/stdio.js' }, 'darwin'), [], exists, 'darwin'),
    { action: 'keep' }, 'another DSH wrote it since: it belongs to that one')
  assert.deepEqual(launcherSuccession(own, written, [record('older')], exists, 'darwin'), { action: 'remove' },
    'a DSH whose plugin records no launcher cannot take it over')
  const next: LauncherTarget = { runtime: '/Applications/B.app/Contents/MacOS/B', electron: true, script: '/b/lib/stdio.js' }
  assert.deepEqual(launcherSuccession(own, written, [
    record('removed', { ...next, script: '/gone/lib/stdio.js' }),
    record('moved', { ...next, runtime: '/gone/B' }),
    record('next', next),
    record('cli', { runtime: 'node', electron: false, script: '/c/lib/stdio.js' }),
  ], exists, 'darwin'), { action: 'write', target: next }, 'the newest DSH whose plugin and program still exist takes it over')
})

test('the launcher keeps custom ACP and DSH homes, including shell metacharacters', { skip: process.platform === 'win32' }, () => {
  const directory = mkdtempSync(join(tmpdir(), 'dsh-acp-home-'))
  try {
    const script = join(directory, 'stdio.js')
    const launcher = join(directory, 'launcher')
    writeFileSync(script, 'process.stdout.write(JSON.stringify({ home: process.env.DSH_HOME, args: process.argv.slice(2) }))')
    const home = join(directory, "my home ' $()"); const dshHome = join(directory, "DSH ' $HOME")
    writeFileSync(launcher, launcherScript({ runtime: process.execPath, electron: false, script, home, dshHome }))
    const result = spawnSync('/bin/sh', [launcher, '--check'], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.deepEqual(JSON.parse(result.stdout), { home: dshHome, args: ['--home', home, '--check'] })
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
