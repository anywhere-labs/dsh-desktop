/** File drag authorization through a real Host child: answers, cancellation, invalid answers and Host exit. */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DesktopHostProcess } from '../../src/host-process.ts'

const roots: string[] = []
const hosts: DesktopHostProcess[] = []
afterEach(async () => {
  await Promise.all(hosts.splice(0).map(host => host.stop()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

/**
 * A Host that answers drag requests by address: `ok` lends a file, `nonlocal` lends none, `fails` reports the Host's
 * generic error, `malformed` answers outside the protocol, `exit` ends the process, and anything else stays unanswered
 * until cancelled. It records every cancel it receives in `cancelled.json`.
 */
function dragHost(): string {
  const runtime = mkdtempSync(join(tmpdir(), 'dsh-desktop-host-drag-'))
  roots.push(runtime)
  const packageRoot = join(runtime, 'node_modules', '@deepseek-ai', 'dsh-desktop-host')
  mkdirSync(join(packageRoot, 'lib'), { recursive: true })
  writeFileSync(join(packageRoot, 'package.json'), '{"name":"@deepseek-ai/dsh-desktop-host","type":"module"}\n')
  writeFileSync(join(packageRoot, 'lib', 'index.js'), `
import { writeFileSync } from 'node:fs'
const cancelled = []
process.send({ type: 'ready', url: 'http://127.0.0.1:9/?token=fixture' })
process.on('message', message => {
  if (message.type === 'shutdown') process.send({ type: 'shutdown-complete' }, () => process.disconnect())
  if (message.type === 'file-drag-cancel') {
    cancelled.push(message.requestId)
    writeFileSync(${JSON.stringify(join(runtime, 'cancelled.json'))}, JSON.stringify(cancelled))
  }
  if (message.type !== 'file-drag-resource') return
  const { requestId, address } = message
  if (address === 'ok') process.send({ type: 'file-drag-resource', requestId, resource: { path: '/workspace/a.png', sha256: '${'b'.repeat(64)}', size: 3 } })
  if (address === 'nonlocal') process.send({ type: 'file-drag-resource', requestId, resource: null })
  if (address === 'fails') process.send({ type: 'file-drag-resource', requestId, resource: null, error: 'File drag resource unavailable' })
  if (address === 'malformed') process.send({ type: 'file-drag-resource', requestId, resource: { path: '/workspace/a.png' } })
  if (address === 'exit') process.exit(3)
})
`)
  return runtime
}

function host(runtime: string, onFailure?: (error: Error) => void): DesktopHostProcess {
  const process_ = new DesktopHostProcess(process.execPath, runtime, runtime, undefined, process.env, onFailure)
  hosts.push(process_)
  return process_
}

it('authorizes through the running Host and settles each request with its own answer', async () => {
  const process_ = host(dragHost())
  await process_.start()
  const resources = process_.dragResources!
  const signal = new AbortController().signal
  const [lent, nonlocal, failed] = await Promise.allSettled([resources.resolve('ok', signal), resources.resolve('nonlocal', signal), resources.resolve('fails', signal)])
  expect(lent).toEqual({ status: 'fulfilled', value: { path: '/workspace/a.png', sha256: 'b'.repeat(64), size: 3 } })
  expect(nonlocal).toEqual({ status: 'fulfilled', value: null })
  expect(failed).toMatchObject({ status: 'rejected', reason: new Error('File drag resource unavailable') })
})

it('sends the Host a cancel for an abandoned request', async () => {
  const runtime = dragHost()
  const process_ = host(runtime)
  await process_.start()
  const abort = new AbortController()
  const pending = process_.dragResources!.resolve('slow', abort.signal)
  abort.abort(new Error('File preparation cancelled'))
  await expect(pending).rejects.toThrow('File preparation cancelled')
  await vi.waitFor(() => { expect(JSON.parse(readFileSync(join(runtime, 'cancelled.json'), 'utf8'))).toEqual([1]) })
})

it('fails a Host that answers outside the protocol, and rejects its open requests', async () => {
  const onFailure = vi.fn()
  const process_ = host(dragHost(), onFailure)
  await process_.start()
  const signal = new AbortController().signal
  const waiting = process_.dragResources!.resolve('slow', signal)
  await expect(process_.dragResources!.resolve('malformed', signal)).rejects.toThrow('invalid IPC event')
  await expect(waiting).rejects.toThrow('invalid IPC event')
  expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ message: 'dsh desktop host sent an invalid IPC event' }))
  await expect(process_.dragResources!.resolve('ok', signal)).rejects.toThrow('Next Host is unavailable')
})

it('rejects requests when the Host exits or before it starts', async () => {
  const process_ = host(dragHost(), vi.fn())
  const signal = new AbortController().signal
  await expect(process_.dragResources!.resolve('ok', signal)).rejects.toThrow('Next Host is unavailable')
  await process_.start()
  await expect(process_.dragResources!.resolve('exit', signal)).rejects.toThrow('exited with code 3')
})
