/**
 * The launcher's wait for a DSH it started: it keeps trying until the plugin in that DSH
 * publishes its endpoint, then connects as to any running DSH.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { waitForDsh } from '../../src/autostart.js'
import { connectDsh, DshAcpError, type DshConnection } from '../../src/client.js'
import { startHost } from '../fixtures/host.js'

test('the launcher connects once the DSH it started has loaded the plugin', { timeout: 60_000 }, async () => {
  const failures: string[] = []
  let waiting: Promise<DshConnection> | undefined
  const host = await startHost({
    prepare: async acpHome => {
      waiting = waitForDsh(async () => {
        try {
          return await connectDsh({ home: acpHome })
        } catch (error) {
          if (error instanceof DshAcpError) failures.push(error.code)
          throw error
        }
      }, error => error instanceof DshAcpError, { timeoutMs: 30_000, intervalMs: 20 })
      // The plugin starts only after the launcher has looked and found no DSH.
      while (!failures.length) await new Promise(resolve => setTimeout(resolve, 10))
    },
  })
  try {
    const connection = await waiting!
    try {
      assert.equal(failures[0], 'no-instance')
      assert.equal(typeof connection.info.bridgeVersion, 'string')
    } finally {
      await connection.close()
    }
  } finally {
    await host.close()
  }
})
