/**
 * The launcher outlives DSH but not the plugin: it stays when DSH stops, so an editor can start DSH
 * again, and leaves when the plugin unloads while DSH runs on, unless another running DSH serves the
 * plugin and takes it over.
 */

import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { execFile as execFileCallback } from 'node:child_process'
import { createRequire } from 'node:module'
import { promisify } from 'node:util'
import { readRecords } from '../../src/endpoint.js'
import { launchInfoPath, launcherPath } from '../../src/paths.js'
import { stdioScript } from '../fixtures/client.js'
import { startHost } from '../fixtures/host.js'

const execFile = promisify(execFileCallback)

async function launchInfo(acpHome: string): Promise<{ version: number, command: string, args: string[], env: Record<string, string> }> {
  return JSON.parse(await readFile(launchInfoPath(acpHome), 'utf8'))
}

test('the launcher reports its version without reaching DSH', async () => {
  const { version } = createRequire(import.meta.url)('../../package.json') as { version: string }
  const result = await execFile(process.execPath, [stdioScript, '--version', '--home', '/nonexistent'])
  assert.equal(result.stdout, `${version}\n`, 'one line, the plugin version, as ACP agents answer `--version`')
})

test('the launch description follows the launcher', { timeout: 60_000 }, async () => {
  const host = await startHost()
  try {
    const [stored] = await readRecords(host.acpHome)
    assert.ok(stored?.record.launcher)
    const { launcher } = stored.record
    assert.deepEqual(await launchInfo(host.acpHome), { version: 1, command: launcher.runtime, args: [launcher.script, '--home', host.acpHome],
      env: { DSH_HOME: launcher.dshHome, ...(launcher.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}) } })
    const described = await launchInfo(host.acpHome)
    const checked = await execFile(described.command, [...described.args, '--check'],
      { env: { ...process.env, ...described.env } })
    assert.equal(JSON.parse(checked.stdout).instanceId, stored.record.instanceId, 'starting what it describes reaches this DSH')
    await host.dispose()
    assert.ok(existsSync(launchInfoPath(host.acpHome)), 'kept with the launcher when DSH stops')
  } finally {
    await host.close()
  }
})

test('the launcher stays when DSH stops and leaves when only the plugin unloads', { timeout: 60_000 }, async () => {
  const stopping = await startHost()
  try {
    const launcher = launcherPath(stopping.acpHome)
    const written = await readFile(launcher, 'utf8')
    await stopping.dispose()
    assert.deepEqual(await readRecords(stopping.acpHome), [])
    assert.equal(await readFile(launcher, 'utf8'), written, 'an editor can still start DSH with it')
  } finally {
    await stopping.close()
  }

  const unloading = await startHost()
  try {
    await unloading.unload()
    assert.equal(existsSync(launcherPath(unloading.acpHome)), false, 'a disabled or uninstalled plugin leaves no launcher behind')
    assert.equal(existsSync(launchInfoPath(unloading.acpHome)), false, 'nor its launch description')
    assert.equal(existsSync(unloading.acpHome), false, 'nor the empty directories it made')
  } finally {
    await unloading.close()
  }
})

test('another running DSH that serves the plugin takes the launcher over', { timeout: 60_000 }, async () => {
  const acpHome = join(await mkdtemp(join(tmpdir(), 'aa-dsh-acp-shared-')), 'acp')
  const first = await startHost({ acpHome })
  const second = await startHost({ acpHome })
  try {
    assert.equal((await readRecords(acpHome)).length, 2, 'both instances are ready before either unloads')
    await first.unload()
    const [remaining] = await readRecords(acpHome)
    assert.ok(remaining?.record.launcher, 'records carry what their launcher runs')
    assert.ok((await readFile(launcherPath(acpHome), 'utf8')).includes(remaining.record.launcher.script),
      'the launcher now belongs to the DSH that still serves the plugin')
    assert.deepEqual((await launchInfo(acpHome)).args, [remaining.record.launcher.script, '--home', acpHome], 'and so does its launch description')
    await second.unload()
    assert.equal(existsSync(launcherPath(acpHome)), false)
    assert.equal(existsSync(launchInfoPath(acpHome)), false)
  } finally {
    await first.close()
    await second.close()
    await rm(dirname(acpHome), { recursive: true, force: true })
  }
})
