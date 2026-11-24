import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DEFAULT_STARTUP } from '../../src/management-contract.js'
import { parseStartup, readStartup, writeStartup } from '../../src/startup-settings.js'
import { checkProfile, cliLaunch, bundledCli, BRIDGE_PACKAGE } from '../../src/cli-launch.js'

test('startup preferences survive process restart and reject malformed configuration without enabling startup', async () => {
  const home = await mkdtemp(join(tmpdir(), 'acp-settings-'))
  try {
    assert.deepEqual(await readStartup(home), DEFAULT_STARTUP)
    const settings = { enabled: false, mode: 'desktop', timeoutSeconds: 15, profile: '' }
    await writeStartup(home, settings)
    assert.deepEqual(await readStartup(home), settings)
    if (process.platform !== 'win32') assert.equal((await stat(join(home, 'startup.json'))).mode & 0o777, 0o600)
    await assert.rejects(writeStartup(home, { ...settings, timeoutSeconds: 0 }))
    assert.deepEqual(await readStartup(home), settings, 'invalid save preserves the previous settings')
    for (const profile of ['desktop', '../web', '/web', '']) assert.throws(() => parseStartup({ ...settings, mode: 'cli', profile }))
    await writeFile(join(home, 'startup.json'), '{broken')
    await assert.rejects(readStartup(home), /Cannot read/u)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('CLI launch uses the selected existing Web Profile and the installed runtime without creating a Profile', async () => {
  const root = await mkdtemp(join(tmpdir(), 'acp-profile-'))
  try {
    const directory = join(root, 'profiles', 'work')
    await mkdir(directory, { recursive: true })
    assert.equal((await checkProfile(root, 'missing')).valid, false)
    assert.equal((await checkProfile(root, 'desktop')).valid, false)
    const pkg = { dependencies: { [BRIDGE_PACKAGE]: '1.0.0' }, dsh: { profile: { bundles: ['@deepseek-ai/dsh-web-app', BRIDGE_PACKAGE] } } }
    await writeFile(join(directory, 'package.json'), JSON.stringify(pkg))
    assert.equal((await checkProfile(root, 'work')).valid, true)
    const executable = join(root, 'DSH.app', 'Contents', 'MacOS', 'DSH')
    const entry = bundledCli(executable, 'darwin')!
    await mkdir(join(entry, '..'), { recursive: true }); await writeFile(entry, '')
    const launch = await cliLaunch(executable, 'darwin', root, 'work')
    assert.deepEqual(launch.args.slice(-6), [entry, '--profile', 'work', '--no-open', '--port', '0'])
    assert.equal(launch.environment?.ELECTRON_RUN_AS_NODE, '1')
    assert.equal(launch.environment?.DSH_HOME, root)
    assert.equal(launch.cwd, directory)
    assert.deepEqual(JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')), pkg)
    pkg.dsh.profile.bundles.pop()
    await writeFile(join(directory, 'package.json'), JSON.stringify(pkg))
    assert.equal((await checkProfile(root, 'work')).valid, false)
    await assert.rejects(cliLaunch(executable, 'darwin', root, 'work'), /Enable ACP/u)
    if (process.platform !== 'win32') {
      await symlink(root, join(root, 'profiles', 'outside'))
      assert.equal((await checkProfile(root, 'outside')).valid, false)
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('concurrent editors serialize startup and a failed operation releases its lock', async () => {
  const { withStartupLock } = await import('../../src/startup-lock.js')
  const home = await mkdtemp(join(tmpdir(), 'acp-start-lock-'))
  const events: string[] = []
  try {
    await Promise.all([1, 2, 3].map(n => withStartupLock(home, 3_000, async () => {
      events.push(`start${n}`)
      await new Promise(resolve => setTimeout(resolve, 20))
      events.push(`end${n}`)
    })))
    for (let i = 0; i < events.length; i += 2) assert.equal(events[i + 1], events[i]?.replace('start', 'end'))
    await assert.rejects(withStartupLock(home, 1_000, async () => { throw new Error('failed') }))
    assert.equal(await withStartupLock(home, 1_000, async () => 7), 7)
  } finally { await rm(home, { recursive: true, force: true }) }
})
