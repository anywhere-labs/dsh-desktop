import { mkdtemp, mkdir, writeFile, realpath, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { launchDirectory, forwardedWorkspaceArguments, WorkspaceLaunchQueue } from '../src/workspace-launch.ts'

const roots: string[] = []
const queues: WorkspaceLaunchQueue[] = []
afterEach(async () => {
  for (const queue of queues.splice(0)) queue.dispose()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(allowed = true) {
  const root = await mkdtemp(join(tmpdir(), 'desktop-launch-')); roots.push(root)
  const path = join(root, '中文 project'); await mkdir(path)
  const report = vi.fn(); const show = vi.fn(); const validate = vi.fn(async () => allowed)
  const queue = new WorkspaceLaunchQueue(validate, report, show); queues.push(queue)
  return { root, path: await realpath(path), report, show, validate, queue }
}
function next(queue: WorkspaceLaunchQueue) { return queue.next(AbortSignal.timeout(2000)) }

describe('workspace launch delivery', () => {
  it('accepts the explicit second-instance payload without Chromium argv parsing', () => {
    expect(forwardedWorkspaceArguments({ workspaceLaunchArgs: ['中文 project'] })).toEqual(['中文 project'])
    expect(forwardedWorkspaceArguments(undefined)).toBeUndefined()
    expect(forwardedWorkspaceArguments({ workspaceLaunchArgs: [42] })).toBeUndefined()
    expect(forwardedWorkspaceArguments({ workspaceLaunchArgs: Array(33).fill('x') })).toBeUndefined()
  })
  it('parses a single directory and preserves existing option boundaries', () => {
    expect(launchDirectory([])).toBeUndefined()
    expect(launchDirectory(['中文 project'])).toBe('中文 project')
    expect(launchDirectory(['--', '-project'])).toBe('-project')
    expect(() => launchDirectory(['one', 'two'])).toThrow()
    expect(() => launchDirectory(['--port', '3000'])).toThrow()
  })
  it('resolves against the submitting process cwd and keeps requests until acknowledged', async () => {
    const f = await fixture(); f.queue.submit(['中文 project'], f.root)
    const first = await next(f.queue)
    expect(first?.path).toBe(f.path)
    expect(f.validate).toHaveBeenCalledWith(f.path)
    expect(await next(f.queue)).toEqual(first)
    expect(f.queue.complete('wrong-id')).toBe(false)
    expect(f.show).not.toHaveBeenCalled()
    expect(f.queue.complete(first!.id)).toBe(true)
    expect(f.show).toHaveBeenCalledOnce()
  })
  it('delivers requests submitted while a renderer is already waiting', async () => {
    const f = await fixture(); const pending = next(f.queue)
    f.queue.submit([f.path], f.root)
    expect((await pending)?.path).toBe(f.path)
  })
  it('rejects missing paths, regular files, and denied volumes before delivery', async () => {
    const f = await fixture(false)
    await writeFile(join(f.root, 'file'), 'test')
    f.queue.submit(['missing'], f.root); f.queue.submit(['file'], f.root); f.queue.submit([f.path], f.root)
    await vi.waitFor(() => expect(f.validate).toHaveBeenCalledOnce())
    expect(f.report).toHaveBeenCalledTimes(2)
    expect(await f.queue.next(AbortSignal.timeout(20))).toBeNull()
    expect(f.show).not.toHaveBeenCalled()
  })
  it('deduplicates canonical pending paths and reports client failures without focusing', async () => {
    const f = await fixture()
    await symlink(f.path, join(f.root, 'alias'), process.platform === 'win32' ? 'junction' : 'dir')
    f.queue.submit([f.path], f.root); f.queue.submit(['alias'], f.root)
    const first = await next(f.queue)
    await vi.waitFor(() => expect(f.validate).toHaveBeenCalledTimes(2))
    f.queue.complete(first!.id, 'Workspace registration failed')
    expect(f.report).toHaveBeenCalledWith('Workspace registration failed')
    expect(f.show).not.toHaveBeenCalled()
    expect(await f.queue.next(AbortSignal.timeout(20))).toBeNull()
  })
  it('cancels disconnected polls and releases waiting clients on disposal', async () => {
    const f = await fixture(); const abort = new AbortController()
    const waiting = f.queue.next(abort.signal); abort.abort()
    expect(await waiting).toBeNull()
    const second = next(f.queue); f.queue.dispose(); expect(await second).toBeNull()
  })
  it('bounds requests even before filesystem validation completes', async () => {
    const f = await fixture()
    for (let i = 0; i < 17; i++) f.queue.submit([f.path], f.root)
    expect(f.report).toHaveBeenCalledWith('Too many pending workspace requests.')
  })
})
