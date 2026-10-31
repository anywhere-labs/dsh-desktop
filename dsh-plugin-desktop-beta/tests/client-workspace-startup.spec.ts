import { describe, expect, it, vi } from 'vitest'
import { installWorkspaceStartup, type WorkspaceStartupTarget } from '../src/client/workspace-startup.ts'
import type { DesktopWorkspaceLaunch, DesktopWorkspaceLaunchBridge } from '../src/workspace-startup.ts'

const settle = async () => { await new Promise(resolve => setTimeout(resolve, 0)) }
function setup(roots = ['/primary', '/other']) {
  const order: string[] = []
  let listener: (() => void) | undefined
  const requests: DesktopWorkspaceLaunch[] = [{ id: 1, paths: roots }]
  const bridge = {
    take: vi.fn(async () => requests.shift() ?? null), complete: vi.fn(async () => {}), reportError: vi.fn(async () => {}),
    onAvailable: vi.fn((receive: () => void) => { listener = receive; return () => { listener = undefined } }),
  } satisfies DesktopWorkspaceLaunchBridge
  const target = {
    ready: vi.fn(async () => { order.push('ready') }),
    create: vi.fn(async () => { order.push('create'); return 'workspace' }),
    setRoots: vi.fn(async () => { order.push('roots') }),
    open: vi.fn(async () => { order.push('open') }),
  } satisfies WorkspaceStartupTarget
  return { target, bridge, order, notify: () => listener?.() }
}

describe('native multi-folder startup', () => {
  it('waits for stores before create, roots, open and acknowledges only after opening', async () => {
    const { target, bridge, order, notify } = setup()
    const dispose = installWorkspaceStartup(target, bridge)
    notify(); notify()
    await settle()
    expect(order.slice(0, 4)).toEqual(['ready', 'create', 'roots', 'open'])
    expect(target.create).toHaveBeenCalledExactlyOnceWith('/primary')
    expect(target.setRoots).toHaveBeenCalledExactlyOnceWith('workspace', ['/primary', '/other'])
    expect(bridge.complete).toHaveBeenCalledExactlyOnceWith(1)
    dispose()
  })

  it('surfaces a roots refusal instead of silently opening just the primary folder', async () => {
    const { target, bridge } = setup()
    target.setRoots.mockRejectedValue(new Error('workspace/roots-in-use'))
    const dispose = installWorkspaceStartup(target, bridge)
    await settle()
    expect(bridge.reportError).toHaveBeenCalledExactlyOnceWith('workspace/roots-in-use')
    expect(target.open).not.toHaveBeenCalled()
    expect(bridge.complete).toHaveBeenCalledExactlyOnceWith(1)
    dispose()
  })

  it('preserves single-folder startup without a roots mutation', async () => {
    const { target, bridge } = setup(['/primary'])
    const dispose = installWorkspaceStartup(target, bridge)
    await settle()
    expect(target.setRoots).not.toHaveBeenCalled()
    expect(target.open).toHaveBeenCalledExactlyOnceWith('workspace')
    dispose()
  })

  it('does not persist a request if its document unmounts while waiting for readiness', async () => {
    const { target, bridge } = setup()
    let ready!: () => void
    target.ready.mockImplementation(() => new Promise(resolve => { ready = resolve }))
    const dispose = installWorkspaceStartup(target, bridge)
    dispose(); ready()
    await settle()
    expect(bridge.take).not.toHaveBeenCalled()
    expect(target.create).not.toHaveBeenCalled()
    expect(bridge.complete).not.toHaveBeenCalled()
  })

  it('stops before setRoots/open and leaves replay available after document disposal', async () => {
    const { target, bridge } = setup()
    let created!: (id: string) => void
    target.create.mockImplementation(() => new Promise(resolve => { created = resolve }))
    const dispose = installWorkspaceStartup(target, bridge)
    await settle()
    dispose(); created('workspace')
    await settle()
    expect(target.setRoots).not.toHaveBeenCalled()
    expect(target.open).not.toHaveBeenCalled()
    expect(bridge.complete).not.toHaveBeenCalled()
  })
})
