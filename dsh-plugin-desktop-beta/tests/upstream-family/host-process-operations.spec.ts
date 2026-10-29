import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopHostProcess, type DesktopHostObserver } from '../../src/host-process.ts'
import { DesktopOperationHistory } from '../../src/upstream-family/desktop-operation-history.ts'

const roots: string[] = []
const hosts: DesktopHostProcess[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

const runId = 'c254ab28-97c9-4382-95e6-2db9c66f98c8'
const record = { runId, transportDropped: 0, pluginCommand: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca',
  time: '2026-10-19T00:00:01.000Z', action: 'add', target: 'dsh-foo', version: '1.2.3', phase: 'started' } }

/** A Host that sends `messages` before it reports readiness, as the Desktop Host announces its run first. */
function hostSending(messages: readonly unknown[]): string {
  const runtime = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-operations-'))
  roots.push(runtime)
  const packageRoot = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), `
for (const message of ${JSON.stringify(messages)}) process.send(message)
process.send({ type: 'ready', url: 'http://127.0.0.1:9/?token=fixture' })
process.on('message', message => {
  if (message.type === 'shutdown') process.send({ type: 'shutdown-complete' }, () => process.disconnect())
})
`)
  return runtime
}

function host(runtime: string, observer?: DesktopHostObserver): DesktopHostProcess {
  const process_ = new DesktopHostProcess(process.execPath, runtime, runtime, undefined, process.env, undefined,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, observer)
  hosts.push(process_)
  return process_
}

it('takes the run announcement and records out of the Host events and journals the announced run', async () => {
  const runtime = hostSending([{ type: 'starting', runId }, { type: 'plugin-operation', record },
    { type: 'plugin-operation', record: 'malformed' }])
  const history = new DesktopOperationHistory(join(runtime, 'plugin-operations'))
  const operation = vi.fn(history.host())
  await expect(host(runtime, { operation }).start()).resolves.toMatchObject({ url: 'http://127.0.0.1:9/?token=fixture' })
  expect(operation).toHaveBeenCalledWith({ type: 'starting', runId })
  expect(history.runId).toBe(runId)
  await history.close()
  expect(JSON.parse(await readFile(join(runtime, 'plugin-operations', 'operations.jsonl'), 'utf8'))).toEqual(record)
})

it('fails a Host whose announcement has no run identity', async () => {
  const runtime = hostSending([{ type: 'starting' }])
  const history = new DesktopOperationHistory(join(runtime, 'plugin-operations'))
  await expect(host(runtime, { operation: history.host() }).start()).rejects.toThrow('invalid IPC event')
  await expect(host(hostSending([{ type: 'starting', runId: 'run-1' }])).start()).rejects.toThrow('invalid IPC event')
})

it('drops operation evidence in a shell that keeps no history, as the verification scripts start the Host', async () => {
  const runtime = hostSending([{ type: 'starting', runId }, { type: 'plugin-operation', record }, { type: 'plugin-operation' }])
  await expect(host(runtime).start()).resolves.toMatchObject({ url: 'http://127.0.0.1:9/?token=fixture' })
})
