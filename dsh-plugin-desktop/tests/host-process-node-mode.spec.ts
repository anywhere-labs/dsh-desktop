import { fork } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

// Electron's utilityProcess.fork is the only spawner that publishes process.parentPort, and the
// Host entry now talks to its supervisor over it. A plain fork of the same entry — including one
// that runs the Electron binary with ELECTRON_RUN_AS_NODE — must refuse to boot rather than serve
// an unsupervised Host.
it('refuses to serve Host RPC outside an Electron utility process', async () => {
  const entry = process.env.DSH_TEST_HOST_ENTRY ?? fileURLToPath(new URL('../lib/host-process-entry.js', import.meta.url))
  if (!existsSync(entry)) throw new Error('Build the Desktop Host entry before this integration test')
  const electron = process.env.DSH_TEST_ELECTRON ?? createRequire(import.meta.url)('electron') as string
  const child = fork(entry, [], {
    execPath: electron, execArgv: [],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'], serialization: 'json',
  })
  let stderr = ''
  child.stderr?.on('data', data => { stderr = (stderr + String(data)).slice(-4096) })
  child.once('error', error => { stderr += error.message })
  const [code, signal] = await once(child, 'exit')
  child.stdout?.destroy()
  child.stderr?.destroy()

  expect([code, signal]).toEqual([1, null])
  expect(stderr).toContain('DSH Host must be started by the Desktop supervisor')
}, 15_000)
