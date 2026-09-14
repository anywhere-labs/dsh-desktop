import { MessageChannel } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { HostRpc } from '../src/host-rpc.ts'
import { WorkspaceLaunchQueue } from '../src/workspace-launch.ts'
import { bindWorkspaceLaunches, createHostWorkspaceLaunches } from '../src/workspace-launch-host-bridge.ts'

const cleanup: (() => void)[] = []
afterEach(() => cleanup.splice(0).forEach(close => close()))
function pair(queue: WorkspaceLaunchQueue) {
  const { port1, port2 } = new MessageChannel()
  const [parent, child] = [port1, port2].map(port => new HostRpc({
    send: message => port.postMessage(message),
    listen: receive => { port.on('message', receive); return () => { port.off('message', receive) } },
  }, 2000)) as [HostRpc, HostRpc]
  const release = bindWorkspaceLaunches(parent, queue)
  const close = () => { release(); parent.close(); child.close(); port1.close(); port2.close() }
  cleanup.push(close)
  return { parent, child, close, remote: createHostWorkspaceLaunches(child) }
}

it('keeps unacknowledged requests in the parent across a Host channel replacement', async () => {
  const report = vi.fn(); const show = vi.fn()
  const queue = new WorkspaceLaunchQueue(async () => true, report, show)
  cleanup.push(() => queue.dispose())
  queue.submit(['.'], process.cwd())
  const firstHost = pair(queue)
  const first = await firstHost.remote.next(new AbortController().signal)
  expect(first).not.toBeNull()
  firstHost.close()
  const secondHost = pair(queue)
  expect(await secondHost.remote.next(new AbortController().signal)).toEqual(first)
  expect(await secondHost.remote.complete('wrong')).toBe(false)
  expect(show).not.toHaveBeenCalled()
  expect(await secondHost.remote.complete(first!.id, 'Workspace could not be registered')).toBe(true)
  expect(report).toHaveBeenCalledWith('Workspace could not be registered')
  expect(show).not.toHaveBeenCalled()
  expect(await secondHost.remote.complete(first!.id)).toBe(false)
})

it('cancels a disconnected renderer long poll in the parent without disposing the queue', async () => {
  const queue = new WorkspaceLaunchQueue(async () => true, vi.fn(), vi.fn())
  cleanup.push(() => queue.dispose())
  const next = vi.spyOn(queue, 'next')
  const host = pair(queue)
  const abort = new AbortController()
  const pending = host.remote.next(abort.signal)
  const rejected = expect(pending).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
  const parentSignal = next.mock.calls[0]![0]
  abort.abort()
  await rejected
  await vi.waitFor(() => expect(parentSignal.aborted).toBe(true))
  queue.submit(['.'], process.cwd())
  expect(await host.remote.next(new AbortController().signal)).not.toBeNull()
})

it('aborts waiting delivery when the Host exits and rejects malformed acknowledgements', async () => {
  const queue = new WorkspaceLaunchQueue(async () => true, vi.fn(), vi.fn())
  cleanup.push(() => queue.dispose())
  const next = vi.spyOn(queue, 'next')
  const host = pair(queue)
  await expect(host.child.call('workspace-launch:complete', [42])).rejects.toThrow('Invalid workspace')
  const pending = host.remote.next(new AbortController().signal)
  const rejected = expect(pending).rejects.toThrow('closed')
  await vi.waitFor(() => expect(next).toHaveBeenCalledOnce())
  host.close()
  await rejected
  expect(next.mock.calls[0]![0].aborted).toBe(true)
})
