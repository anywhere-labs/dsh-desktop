import { describe, expect, it, vi } from 'vitest'
import {
  createWorkspaceRootSelection,
  createWorkspaceSourcesQueue,
  workspaceRootForPath,
} from '../src/client/workspace-root-selection.ts'
import type { WorkspaceSourcesResponse } from '../src/client/workspace-sources-api.ts'

describe('Workspace root selection', () => {

  it('persists Host authorization before switching the file tree and publishes only after success', async () => {
    const before: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work' }
    const selected: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work/docs' }
    const order: string[] = []
    const read = vi.fn(async (_workspacePath: string) => {
      order.push('read')
      return before
    })
    const update = vi.fn(async (_action: 'remove' | 'select', _workspacePath: string, _root: string) => {
      order.push('persist')
      return selected
    })
    const select = createWorkspaceRootSelection(read, update)

    await select('/work', '/work/docs', async (root) => { order.push(`tree:${root}`) }, () => { order.push('publish') })

    expect(order).toEqual(['read', 'persist', 'tree:/work/docs', 'publish'])
  })

  it('restores the prior Host selection and file-tree root when the new tree fails', async () => {
    const before: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work' }
    const selected: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work/docs' }
    const updates = [selected, before]
    const update = vi.fn(async (_action: 'remove' | 'select', _workspacePath: string, _root: string) => updates.shift() ?? before)
    const roots: string[] = []
    const published: WorkspaceSourcesResponse[] = []
    const select = createWorkspaceRootSelection(async () => before, update)

    await expect(select('/work', '/work/docs', async (root) => {
      roots.push(root)
      if (root === '/work/docs') throw new Error('listing denied')
    }, snapshot => { published.push(snapshot) })).rejects.toThrow('listing denied')

    expect(update.mock.calls.map(([, , root]) => root)).toEqual(['/work/docs', '/work'])
    expect(roots).toEqual(['/work/docs', '/work'])
    expect(published).toEqual([before])
  })

  it('keeps the tree aligned with Host authorization when rollback persistence fails', async () => {
    const before: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work' }
    const selected: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work/docs' }
    const update = vi.fn(async (_action: 'remove' | 'select', _workspacePath: string, root: string) => {
      if (root === '/work') throw new Error('rollback denied')
      return selected
    })
    const roots: string[] = []
    const published: WorkspaceSourcesResponse[] = []
    const select = createWorkspaceRootSelection(async () => before, update)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})

    await expect(select('/work', '/work/docs', async root => {
      roots.push(root)
      if (roots.length === 1) throw new Error('tree unavailable')
    }, snapshot => { published.push(snapshot) })).rejects.toThrow('tree unavailable')

    expect(update.mock.calls.map(([, , root]) => root)).toEqual(['/work/docs', '/work'])
    expect(roots).toEqual(['/work/docs', '/work/docs'])
    expect(published).toEqual([selected])
    error.mockRestore()
  })

  it('serializes reads and mutations so an older GET cannot become the final snapshot', async () => {
    const queue = createWorkspaceSourcesQueue()
    const oldSnapshot: WorkspaceSourcesResponse = { sources: [], selectedRoot: '/work' }
    const newSnapshot: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work' }
    const published: WorkspaceSourcesResponse[] = []
    let finishRead!: () => void
    const gate = new Promise<void>(resolve => { finishRead = resolve })
    const read = queue('/work', async () => {
      await gate
      published.push(oldSnapshot)
    })
    const mutation = queue('/work', async () => {
      published.push(newSnapshot)
    })

    finishRead()
    await Promise.all([read, mutation])

    expect(published).toEqual([oldSnapshot, newSnapshot])
    expect(published.at(-1)).toEqual(newSnapshot)
  })

  it('switches the current Files tab when another tab already persisted the same root', async () => {
    const snapshot: WorkspaceSourcesResponse = { sources: ['/work/docs'], selectedRoot: '/work/docs' }
    const update = vi.fn()
    const onRootChange = vi.fn(async (_root: string) => {})
    const select = createWorkspaceRootSelection(async () => snapshot, update)

    await select('/work', '/work/docs', onRootChange, () => {})

    expect(update).not.toHaveBeenCalled()
    expect(onRootChange).toHaveBeenCalledWith('/work/docs')
  })

  it('matches the deepest root without confusing sibling prefixes', () => {
    expect(workspaceRootForPath('/workspace/docs/file.txt', ['/workspace', '/workspace/docs'], 'linux'))
      .toBe('/workspace/docs')
    expect(workspaceRootForPath('/workspace/document/file.txt', ['/workspace', '/workspace/docs'], 'linux'))
      .toBe('/workspace')
    expect(workspaceRootForPath('/tmp/file.txt', ['/'], 'linux')).toBe('/')
  })

  it('normalizes Windows separators and case while preserving the configured root', () => {
    expect(workspaceRootForPath('C:\\WORK\\Docs\\file.txt', ['c:\\work', 'C:\\work\\docs'], 'win32'))
      .toBe('C:\\work\\docs')
  })
})
