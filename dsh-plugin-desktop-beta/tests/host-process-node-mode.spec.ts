import { fork, type Serializable } from 'node:child_process'
import { once } from 'node:events'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'

it('serves Host RPC in a real Electron Node-mode child without starting a GUI', async () => {
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
  const rpc = new HostRpc({
    send: message => child.send(message as Serializable),
    listen: receive => { child.on('message', receive); return () => child.off('message', receive) },
  }, 5_000)
  child.once('error', error => rpc.close(error.message))
  child.once('exit', (code, signal) => rpc.close(`Node-mode Host exited (${String(code)}, ${String(signal)}): ${stderr}`))
  try {
    const status = await rpc.call<{ pid: number; services: { aaRuntime: boolean; aaOnboarding: boolean } }>('status')
    expect(status).toEqual({ pid: child.pid, services: { aaRuntime: false, aaOnboarding: false } })
    await rpc.call('stop')
    const exited = once(child, 'exit')
    child.disconnect()
    const [code, signal] = await exited
    expect([code, signal]).toEqual([1, null])
  } finally {
    rpc.close()
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit')
      child.kill()
      await exited
    }
    child.stdout?.destroy()
    child.stderr?.destroy()
  }
}, 15_000)
