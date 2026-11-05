import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import {
  DESKTOP_OPEN_WORKSPACE_GLOBAL,
  DESKTOP_PENDING_WORKSPACE_GLOBAL,
  desktopOpenWorkspaceScript,
} from '../src/launch-workspace-contract.ts'
import {
  installDesktopLaunchWorkspaceBridge,
  openDesktopLaunchWorkspace,
  type DesktopLaunchWorkspaceTarget,
  type DesktopLaunchWorkspaceWindow,
} from '../src/client/launch-workspace.ts'

/** Evaluate the delivery script against one stand-in page object. */
function runOpenWorkspaceScript(path: string, page: Record<string, unknown>): unknown {
  return new Function('window', `return ${desktopOpenWorkspaceScript(path)}`)(page) as unknown
}

/** Build a target whose every seam is observable and individually overridable. */
function target(overrides: Partial<DesktopLaunchWorkspaceTarget> = {}): {
  readonly target: DesktopLaunchWorkspaceTarget
  readonly order: string[]
  readonly errors: string[]
} {
  const order: string[] = []
  const errors: string[] = []
  const base: DesktopLaunchWorkspaceTarget = {
    ready: async () => { order.push('ready') },
    create: async path => {
      order.push(`create:${path}`)
      return 'workspace-1' as WorkspaceId
    },
    open: async workspaceId => { order.push(`open:${workspaceId}`) },
    reportError: message => { errors.push(message) },
  }
  return { target: { ...base, ...overrides }, order, errors }
}

describe('Desktop open workspace script', () => {
  it('names both page seams', () => {
    expect(DESKTOP_OPEN_WORKSPACE_GLOBAL).toBe('__DSH_DESKTOP_OPEN_WORKSPACE__')
    expect(DESKTOP_PENDING_WORKSPACE_GLOBAL).toBe('__DSH_DESKTOP_PENDING_WORKSPACE__')
    const source = desktopOpenWorkspaceScript('C:\\Work')
    expect(source).toContain(DESKTOP_OPEN_WORKSPACE_GLOBAL)
    expect(source).toContain(DESKTOP_PENDING_WORKSPACE_GLOBAL)
  })

  it('calls the installed seam and reports the delivery', () => {
    const taken: string[] = []
    const page = { [DESKTOP_OPEN_WORKSPACE_GLOBAL]: (path: string) => { taken.push(path) } }
    expect(runOpenWorkspaceScript('C:\\Work\\repo', page)).toBe('delivered')
    expect(taken).toEqual(['C:\\Work\\repo'])
    expect(page).not.toHaveProperty(DESKTOP_PENDING_WORKSPACE_GLOBAL)
  })

  it('parks the folder when the seam is not installed yet', () => {
    const page: Record<string, unknown> = {}
    expect(runOpenWorkspaceScript('/home/anna/work', page)).toBe('pending')
    expect(page[DESKTOP_PENDING_WORKSPACE_GLOBAL]).toBe('/home/anna/work')
  })

  it('encodes every path through JSON so nothing can escape the string', () => {
    for (const path of [
      'C:\\Work\\repo',
      'C:\\a"quote\\repo',
      "/home/anna/it's here",
      '/home/anna/line\nbreak',
      '/home/anna/</script><script>x=1</script>',
      '/home/anna/back\\slash',
    ]) {
      const page: Record<string, unknown> = {}
      expect(runOpenWorkspaceScript(path, page)).toBe('pending')
      expect(page[DESKTOP_PENDING_WORKSPACE_GLOBAL]).toBe(path)
    }
  })
})

describe('Desktop launch workspace client bridge', () => {
  it('registers and opens one folder in order', async () => {
    const seam = target()
    await openDesktopLaunchWorkspace(seam.target, '/home/anna/work')
    expect(seam.order).toEqual(['ready', 'create:/home/anna/work', 'open:workspace-1'])
    expect(seam.errors).toEqual([])
  })

  it('never opens when registration fails, and says why', async () => {
    const seam = target({ create: async () => { throw new Error('unknown workspace') } })
    await openDesktopLaunchWorkspace(seam.target, '/home/anna/work')
    expect(seam.order).toEqual(['ready'])
    expect(seam.errors).toHaveLength(1)
    expect(seam.errors[0]).toContain('/home/anna/work')
    expect(seam.errors[0]).toContain('unknown workspace')
  })

  it('does nothing at all while the Host lists have not arrived', async () => {
    const seam = target({ ready: async () => await new Promise<void>(() => {}) })
    const settled = vi.fn()
    void openDesktopLaunchWorkspace(seam.target, '/home/anna/work').then(settled)
    await Promise.resolve()
    await Promise.resolve()
    expect(seam.order).toEqual([])
    expect(settled).not.toHaveBeenCalled()
  })

  it('publishes the seam and restores whatever held it before', () => {
    const previous = (): void => {}
    const page: DesktopLaunchWorkspaceWindow = { [DESKTOP_OPEN_WORKSPACE_GLOBAL]: previous }
    const dispose = installDesktopLaunchWorkspaceBridge(target().target, page)
    expect(page[DESKTOP_OPEN_WORKSPACE_GLOBAL]).not.toBe(previous)
    dispose()
    expect(page[DESKTOP_OPEN_WORKSPACE_GLOBAL]).toBe(previous)
  })

  it('removes a seam it introduced rather than leaving an empty one behind', () => {
    const page: DesktopLaunchWorkspaceWindow = {}
    installDesktopLaunchWorkspaceBridge(target().target, page)()
    expect(page).not.toHaveProperty(DESKTOP_OPEN_WORKSPACE_GLOBAL)
  })

  it('leaves a newer seam alone when disposed out of order', () => {
    const page: DesktopLaunchWorkspaceWindow = {}
    const dispose = installDesktopLaunchWorkspaceBridge(target().target, page)
    const newer = (): void => {}
    page[DESKTOP_OPEN_WORKSPACE_GLOBAL] = newer
    dispose()
    expect(page[DESKTOP_OPEN_WORKSPACE_GLOBAL]).toBe(newer)
  })

  it('drains a folder that arrived before the seam existed, exactly once', async () => {
    const seam = target()
    const page: DesktopLaunchWorkspaceWindow = {
      [DESKTOP_PENDING_WORKSPACE_GLOBAL]: '/home/anna/parked',
    }
    installDesktopLaunchWorkspaceBridge(seam.target, page)
    expect(page).not.toHaveProperty(DESKTOP_PENDING_WORKSPACE_GLOBAL)
    await vi.waitFor(() => {
      expect(seam.order).toEqual(['ready', 'create:/home/anna/parked', 'open:workspace-1'])
    })
  })

  it('takes a folder delivered after install through the published seam', async () => {
    const seam = target()
    const page: DesktopLaunchWorkspaceWindow = {}
    installDesktopLaunchWorkspaceBridge(seam.target, page)
    page[DESKTOP_OPEN_WORKSPACE_GLOBAL]?.('/home/anna/later')
    await vi.waitFor(() => {
      expect(seam.order).toEqual(['ready', 'create:/home/anna/later', 'open:workspace-1'])
    })
    expect(seam.errors).toEqual([])
  })
})
