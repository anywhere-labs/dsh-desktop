/**
 * Registering the app, so that connections can prefer it and editors can start it, is an extra on top of
 * serving ACP: whatever goes wrong with it, the clients of this DSH still connect.
 */

import assert from 'node:assert/strict'
import { mkdir, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { applications } from '../../src/applications.js'
import { readRecords } from '../../src/endpoint.js'
import { readStartup } from '../../src/startup-settings.js'
import { startHost, type Host } from '../fixtures/host.js'

/** A Host inside DSH Desktop, Electron in Node mode: the only kind that registers an app. */
async function desktopHost(prepare: (acpHome: string) => Promise<void>): Promise<Host> {
  const versions = Object.getOwnPropertyDescriptor(process, 'versions')!
  const mode = process.env.ELECTRON_RUN_AS_NODE
  try {
    return await startHost({
      prepare: async acpHome => {
        await mkdir(acpHome, { recursive: true, mode: 0o700 })
        await prepare(acpHome)
        Object.defineProperty(process, 'versions', { ...versions, value: { ...process.versions, electron: '44.0.0' } })
        process.env.ELECTRON_RUN_AS_NODE = '1'
      },
    })
  } finally {
    Object.defineProperty(process, 'versions', versions)
    if (mode === undefined) delete process.env.ELECTRON_RUN_AS_NODE
    else process.env.ELECTRON_RUN_AS_NODE = mode
  }
}

test('a lock a killed process left empty neither stops the endpoint nor the registration', { timeout: 60_000 }, async () => {
  const host = await desktopHost(acpHome => writeFile(join(acpHome, 'applications.lock'), ''))
  try {
    const [stored] = await readRecords(host.acpHome)
    const [registered] = await applications(host.acpHome)
    assert.ok(registered)
    assert.equal(stored?.record.application?.id, registered.id)
    assert.equal((await readStartup(host.acpHome)).defaultApp, registered.id, 'the first registration is the default app')
  } finally {
    await host.close()
  }
})

test('an app that cannot be registered still serves ACP', { timeout: 60_000 }, async () => {
  // A file where the registrations belong: nothing can be written there.
  const host = await desktopHost(acpHome => writeFile(join(acpHome, 'apps'), ''))
  try {
    assert.deepEqual(await applications(host.acpHome), [])
    const [stored] = await readRecords(host.acpHome)
    assert.equal(stored?.record.application?.profileDirectory, await realpath(process.cwd()),
      'the record still says which app this is, so a registration from before keeps its preference')
  } finally {
    await host.close()
  }
})
