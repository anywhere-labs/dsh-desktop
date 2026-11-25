import assert from 'node:assert/strict'
import test from 'node:test'
import { copyFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { applicationId, applications, registerApplication, unregisterApplication, defaultApplication, selectApplication, orderedInstances, applicationLaunch, type Application } from '../../src/applications.js'
import { readStartup, writeStartup } from '../../src/startup-settings.js'
import type { EndpointRecord } from '../../src/endpoint.js'
function app(kind: Application['kind'], root = '/apps'): Application {
  const runtime = `${root}/${kind}.app/Contents/MacOS/DSH`
  const dshHome = kind === 'beta' ? '/data/beta' : '/data/shared'
  const profileDirectory = `${dshHome}/profiles/desktop`
  return { id: applicationId(runtime, dshHome, profileDirectory), kind, name: kind, bundleId: `test.${kind}`, version: '1', bridgeVersion: '1',
    dshHome, profileDirectory, profile: 'desktop', background: kind === 'next' || kind === 'beta', registeredAt: '2026-11-20T00:00:00Z',
    launcher: { runtime, script: `${root}/${kind}.js`, electron: true, dshHome } }
}
const next = app('next'), beta = app('beta'), official = app('official')
const record = (a: Application, startedAt = '') => ({ application: a, instanceId: a.id, profileDirectory: a.profileDirectory, startedAt }) as EndpointRecord

test('selection is independent of launch order; same Profile fallback precedes another home; pinning never falls back', () => {
  for (const apps of [[next, beta, official], [official, next, beta], [beta, official, next]]) {
    assert.equal(selectApplication(apps, undefined, next.id)?.id, next.id)
    assert.deepEqual(orderedInstances(apps.map(a => record(a)), next).map(r => r.application?.kind), ['next', 'official', 'beta'])
    assert.deepEqual(orderedInstances(apps.map(a => record(a)), beta, true).map(r => r.application?.kind), ['beta'])
  }
  assert.equal(orderedInstances([record(beta), record(official)], next)[0]?.application?.kind, 'official')
  assert.equal(orderedInstances([record(beta)], next, true).length, 0)
  assert.throws(() => selectApplication([next, { ...next, id: 'another' }], 'next'), /multiple installations/u)
  assert.throws(() => selectApplication([next], 'official'), /not registered/u)
})
test('official launch does not force a second instance or pass Next flags; each app supplies its own home', () => {
  const o = applicationLaunch(official, 'darwin')!
  assert.ok(!o.args.includes('-n')); assert.ok(!o.args.includes('--next-background'))
  assert.ok(o.args.includes(`DSH_HOME=${official.dshHome}`))
  const b = applicationLaunch(beta, 'darwin')!
  assert.ok(b.args.includes('--next-background'))
  assert.ok(b.args.includes(`DSH_HOME=${beta.dshHome}`))
  assert.deepEqual(applicationLaunch(official, 'win32')?.args, [])
  assert.deepEqual(applicationLaunch(official, 'win32')?.hiddenStart, { dshHome: official.dshHome }, 'on Windows explorer starts it hidden')
  assert.equal(applicationLaunch(official, 'darwin')?.hiddenStart, undefined)
  for (const background of [next, beta]) {
    const launch = applicationLaunch(background, 'win32')!
    assert.deepEqual([launch.args, launch.hiddenStart, launch.windowsHide], [['--next-background'], undefined, undefined],
      'Next/Beta start without a window by themselves')
  }
})
test('Windows process rows survive non-ASCII paths and a single process', async () => {
  const { windowsProcessRows, applicationsInProcesses } = await import('../../src/applications.js')
  const runtime = 'C:\\Users\\张三\\AppData\\Local\\Programs\\DeepSeek Harness\\DeepSeek Harness.exe'
  const encode = (value: unknown) => `${Buffer.from(JSON.stringify(value), 'utf8').toString('base64')}\r\n`
  const rows = windowsProcessRows(encode([{ ProcessId: 7, CommandLine: `"${runtime}" ` }, { ProcessId: 8, CommandLine: null }]))
  assert.deepEqual(rows, [{ pid: 7, command: `"${runtime}" ` }, { pid: 8, command: '' }])
  const installed = { ...official, launcher: { ...official.launcher, runtime } }
  assert.deepEqual(applicationsInProcesses([installed], rows, 99).map(a => a.kind), ['official'])
  assert.deepEqual(windowsProcessRows(encode({ ProcessId: 9, CommandLine: runtime })), [{ pid: 9, command: runtime }])
})
test('Windows finds a registered executable by name then distinguishes its installation path', { skip: process.platform !== 'win32' }, async () => {
  const { runningApplications } = await import('../../src/applications.js')
  const root = await mkdtemp(join(tmpdir(), 'acp-process-'))
  const name = `ACP 测试 ${process.pid}.exe`
  const runtime = join(root, name)
  const target = { ...official, launcher: { ...official.launcher, runtime } }
  const other = { ...next, launcher: { ...next.launcher, runtime: join(root, 'other', name) } }
  try {
    await copyFile(join(process.env.SystemRoot!, 'System32', 'cmd.exe'), runtime)
    assert.deepEqual(await runningApplications([target]), [])
    const child = spawn(runtime, ['/d', '/q'], { windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] })
    await once(child, 'spawn')
    const exited = once(child, 'exit')
    try {
      assert.deepEqual(await runningApplications([other, target]), [target])
    } finally {
      child.kill()
      await exited
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
test('first registration remains default across restarts and concurrent registrations; uninstall falls back to Next/Beta', async () => {
  const home = await mkdtemp(join(tmpdir(), 'acp-apps-'))
  try {
    const apps = [app('official', home), app('next', home), app('beta', home)]
    for (const a of apps) {
      await mkdir(join(a.launcher.runtime, '..'), { recursive: true }); await writeFile(a.launcher.runtime, '')
      await writeFile(a.launcher.script, '')
    }
    await registerApplication(home, apps[0]!)
    await Promise.all(apps.slice(1).map(a => registerApplication(home, a)))
    assert.equal((await readStartup(home)).defaultApp, apps[0]!.id)
    await registerApplication(home, { ...apps[2]!, registeredAt: '2099-01-01T00:00:00Z' })
    assert.equal((await readStartup(home)).defaultApp, apps[0]!.id)
    await unregisterApplication(home, apps[0]!.id)
    const remaining = await applications(home)
    assert.equal(remaining.length, 2)
    assert.ok(defaultApplication(remaining, apps[0]!.id)?.background)
    const settings = await readStartup(home)
    await writeStartup(home, { ...settings, defaultApp: apps[1]!.id, applications: {
      [apps[1]!.id]: { mode: 'cli', profile: 'work', dshHome: '/data/shared' },
      [apps[2]!.id]: { mode: 'cli', profile: 'work', dshHome: '/data/beta' },
    } })
    await registerApplication(home, apps[2]!)
    assert.equal((await readStartup(home)).applications?.[apps[1]!.id]?.dshHome, '/data/shared')
    assert.equal((await readStartup(home)).applications?.[apps[2]!.id]?.dshHome, '/data/beta')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('process inspection recognizes a pending app but excludes Node-mode launchers and helper processes', async () => {
  const { applicationsInProcesses, parseApplication } = await import('../../src/applications.js')
  const rows = [
    { pid: 10, command: `${next.launcher.runtime} /plugin/stdio.js` },
    { pid: 11, command: `${beta.launcher.runtime} --expose-internals /host/index.js` },
    { pid: 12, command: `${official.launcher.runtime} --type=renderer` },
    // The Windows launcher, dsh-acp.cmd, quotes the script path: another editor's launcher is not the app running.
    { pid: 14, command: `"${official.launcher.runtime}" "C:\\Users\\张三\\dsh-acp-bridge\\lib\\stdio.js" --home "C:\\Users\\张三\\.agents-anywhere\\dsh-acp"` },
  ]
  assert.deepEqual(applicationsInProcesses([next, beta, official], rows, 99), [])
  rows.push({ pid: 13, command: `"${official.launcher.runtime}"` })
  assert.deepEqual(applicationsInProcesses([next, beta, official], rows, 99).map(a => a.kind), ['official'])
  assert.deepEqual(applicationsInProcesses([next, beta, official], rows, 13), [])
  assert.equal(parseApplication({ ...next, id: 42 }), undefined)
  assert.equal(parseApplication({ ...next, launcher: null }), undefined)
})
