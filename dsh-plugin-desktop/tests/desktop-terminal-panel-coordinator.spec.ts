import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { TerminalView } from '@deepseek-ai/dsh-api-terminal-controller/client'
import type { DesktopTerminalPanelSnapshot, DesktopTerminalViewSource } from '../src/client/desktop-terminal-panel-coordinator.ts'
import {
  DesktopTerminalPanelCoordinator,
  resolveActiveTerminalTab,
  visibleTerminalTabs,
} from '../src/client/desktop-terminal-panel-coordinator.ts'

// Minimal snapshot-store double: draft updates through structuredClone, plus a
// synchronous listener fan-out, so the coordinator's reactive surface is real.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  createSnapshotStore: <T,>(initial: T) => {
    let state = initial
    const listeners = new Set<() => void>()
    return {
      getSnapshot: () => state,
      subscribe: (listener: () => void) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      update: (mutator: (draft: T) => void) => {
        const draft = structuredClone(state)
        mutator(draft)
        state = draft
        for (const listener of listeners) listener()
      },
      set: (next: T) => { state = next },
    }
  },
}))

const SESSION_A = 'session-a' as SessionId
const SESSION_B = 'session-b' as SessionId

function makeView(): TerminalView {
  return { write: vi.fn(), state: { getSnapshot: () => ({ phase: 'idle', writable: false }) } } as unknown as TerminalView
}

function makeSource() {
  const views = new Map<string, TerminalView>()
  const source: DesktopTerminalViewSource = {
    view: vi.fn((_sessionId: SessionId, key: string) => {
      const view = makeView()
      views.set(key, view)
      return view
    }),
    close: vi.fn(),
    launchShells: vi.fn(),
    retainTabs: vi.fn(),
  }
  return { source, views }
}

function makeLocalStorage() {
  const data = new Map<string, string>()
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value) },
    removeItem: (key: string) => { data.delete(key) },
    data,
  }
}

/** Every coordinator a case builds, so no debounced write reaches the next case's storage. */
const coordinators: DesktopTerminalPanelCoordinator[] = []

function createCoordinator(source: DesktopTerminalViewSource): DesktopTerminalPanelCoordinator {
  const coordinator = new DesktopTerminalPanelCoordinator(source)
  coordinators.push(coordinator)
  return coordinator
}

afterEach(() => {
  for (const coordinator of coordinators.splice(0)) coordinator.dispose()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('DesktopTerminalPanelCoordinator', () => {
  it('opens, toggles, and closes the drawer with clamped height', () => {
    const coordinator = createCoordinator(makeSource().source)
    const read = (): DesktopTerminalPanelSnapshot => coordinator.snapshot.getSnapshot()
    expect(read().open).toBe(false)
    coordinator.toggle()
    expect(read().open).toBe(true)
    coordinator.close()
    expect(read().open).toBe(false)
    coordinator.setHeight(40)
    expect(read().height).toBe(200)
    coordinator.setHeight(5000)
    expect(read().height).toBe(800)
    coordinator.toggleHistoryRail()
    expect(read().historyRailOpen).toBe(false)
  })

  it('opens tabs, activates the newest, and creates one view per tab', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    coordinator.openTab(SESSION_A)
    coordinator.openTab(SESSION_B)
    const snapshot = coordinator.snapshot.getSnapshot()
    const bucketA = snapshot.tabsBySession[SESSION_A as string]
    expect(bucketA?.tabs).toHaveLength(2)
    expect(bucketA?.activeKey).toBe(bucketA?.tabs[1]?.key)
    expect(snapshot.tabsBySession[SESSION_B as string]?.tabs).toHaveLength(1)
    expect(source.view).toHaveBeenCalledTimes(3)
    coordinator.focusTab(bucketA?.tabs[0]?.key ?? '')
    const after = coordinator.snapshot.getSnapshot()
    expect(after.tabsBySession[SESSION_A as string]?.activeKey).toBe(bucketA?.tabs[0]?.key)
    expect(after.focusedKey).toBe(bucketA?.tabs[0]?.key)
  })

  it('pins tabs across sessions and resolves the strip per visible Session', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    coordinator.openTab(SESSION_B)
    const keyA = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.tabs[0]?.key ?? ''
    const keyB = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_B as string]?.tabs[0]?.key ?? ''
    coordinator.togglePin(keyA)
    coordinator.focusTab(keyA)

    // On Session B's strip the pinned foreign tab leads, followed by B's own.
    let snapshot = coordinator.snapshot.getSnapshot()
    let visible = visibleTerminalTabs(snapshot, SESSION_B)
    expect(visible.map(item => item.tab.key)).toEqual([keyA, keyB])
    expect(visible[0]?.pinned).toBe(true)
    expect(visible[1]?.pinned).toBe(false)
    // The pinned tab keeps panel focus across the switch.
    expect(resolveActiveTerminalTab(snapshot, SESSION_B, visible)).toBe(keyA)
    // The owner lookup still routes closes and writes to the terminal's Session.
    expect(coordinator.ownerOf(keyA)).toBe(SESSION_A)

    // Unpinning the focused foreign tab releases it back to its own Session's strip.
    coordinator.togglePin(keyA)
    snapshot = coordinator.snapshot.getSnapshot()
    visible = visibleTerminalTabs(snapshot, SESSION_B)
    expect(visible.map(item => item.tab.key)).toEqual([keyB])
    expect(resolveActiveTerminalTab(snapshot, SESSION_B, visible)).toBe(keyB)
    // Session A's strip still shows it.
    expect(visibleTerminalTabs(snapshot, SESSION_A).map(item => item.tab.key)).toEqual([keyA])
  })

  it('closeTab strips pin and focus membership of the closed tab', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    coordinator.openTab(SESSION_B)
    const keyA = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.tabs[0]?.key ?? ''
    coordinator.togglePin(keyA)
    coordinator.focusTab(keyA)
    coordinator.closeTab(SESSION_A, keyA)
    const snapshot = coordinator.snapshot.getSnapshot()
    expect(snapshot.pinnedKeys).toEqual([])
    expect(snapshot.focusedKey).toBeUndefined()
    expect(snapshot.tabsBySession[SESSION_A as string]).toBeUndefined()
  })

  it('clamps the shared font size and persists it with pins', async () => {
    const storage = makeLocalStorage()
    vi.stubGlobal('localStorage', storage)
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.setFontSize(4)
    expect(coordinator.snapshot.getSnapshot().fontSize).toBe(10)
    coordinator.setFontSize(99)
    expect(coordinator.snapshot.getSnapshot().fontSize).toBe(24)
    coordinator.setFontSize(16)
    coordinator.openTab(SESSION_A)
    const keyA = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.tabs[0]?.key ?? ''
    coordinator.togglePin(keyA)
    await vi.waitFor(() => { expect(storage.data.size).toBeGreaterThan(0) })
    const restored = createCoordinator(source)
    expect(restored.snapshot.getSnapshot().fontSize).toBe(16)
    expect(restored.snapshot.getSnapshot().pinnedKeys).toEqual([keyA])
  })

  it('ensureViews reattaches restored tabs exactly once', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    const key = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.tabs[0]?.key ?? ''
    coordinator.ensureViews(SESSION_A)
    coordinator.ensureViews(SESSION_A)
    expect(source.view).toHaveBeenCalledTimes(1)
    expect(coordinator.viewFor(key)).toBeDefined()
  })

  it('closeTab terminates the process, drops the bucket, and fixes the active key', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    coordinator.openTab(SESSION_A)
    const bucket = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]
    const [first, second] = bucket?.tabs ?? []
    coordinator.closeTab(SESSION_A, second?.key ?? '')
    expect(source.close).toHaveBeenCalledWith(SESSION_A, second?.key, second?.contentId)
    expect(coordinator.viewFor(second?.key ?? '')).toBeUndefined()
    expect(coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.activeKey).toBe(first?.key)
    coordinator.closeTab(SESSION_A, first?.key ?? '')
    expect(coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]).toBeUndefined()
  })

  it('insertCommand writes text, appending Enter only when run is set', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    const key = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.tabs[0]?.key ?? ''
    const view = coordinator.viewFor(key)
    coordinator.insertCommand(key, 'ls -la', false)
    expect(view?.write).toHaveBeenCalledWith('ls -la')
    coordinator.insertCommand(key, 'pwd', true)
    expect(view?.write).toHaveBeenCalledWith('pwd\r')
  })

  it('persists the tab layout and restores it in a new coordinator', async () => {
    const storage = makeLocalStorage()
    vi.stubGlobal('localStorage', storage)
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.toggle()
    coordinator.openTab(SESSION_A)
    const created = coordinator.snapshot.getSnapshot().tabsBySession[SESSION_A as string]?.tabs[0]
    // Persistence is debounced; the write lands within a few hundred ms.
    await vi.waitFor(() => { expect(storage.data.size).toBeGreaterThan(0) })

    const restored = createCoordinator(source)
    const bucket = restored.snapshot.getSnapshot().tabsBySession[SESSION_A as string]
    expect(restored.snapshot.getSnapshot().open).toBe(true)
    expect(bucket?.tabs).toHaveLength(1)
    expect(bucket?.tabs[0]?.contentId).toBe(created?.contentId)
    // Restoration reattaches through the same content identity.
    restored.ensureViews(SESSION_A)
    expect(source.view).toHaveBeenLastCalledWith(SESSION_A, created?.key, created?.contentId)
  })

  it('reports every live tab in the hold inventory', () => {
    const { source } = makeSource()
    const coordinator = createCoordinator(source)
    coordinator.openTab(SESSION_A)
    coordinator.openTab(SESSION_B)
    const inventory = coordinator.holdInventory()
    expect(inventory).toHaveLength(2)
    expect(inventory.map(item => item.sessionId).sort()).toEqual([SESSION_A, SESSION_B].sort())
    for (const item of inventory) {
      expect(item.tabId).toBeTruthy()
      expect(item.contentId).toBeTruthy()
    }
  })
})
