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
import { readRecords } from '../../src/endpoint.js'
import { launcherPath } from '../../src/paths.js'
import { startHost } from '../fixtures/host.js'

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
    await second.unload()
    assert.equal(existsSync(launcherPath(acpHome)), false)
  } finally {
    await first.close()
    await second.close()
    await rm(dirname(acpHome), { recursive: true, force: true })
  }
})
