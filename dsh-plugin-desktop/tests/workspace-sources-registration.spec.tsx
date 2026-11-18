// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { applyDesktopWorkspaceSources } from '../src/client/WorkspaceSources.tsx'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconCloseOutlineRegular: () => null,
  IconFolderOpenOutlineRegular: () => null,
  IconPlusOutlineRegular: () => null,
  PathLabel: () => null,
}))

const declareSeats = (core: SlotCore) => {
  core.register({
    name: 'root',
    children: {
      'sidebar.workspaces.workspace.edit': { kind: 'single', scope: 'root' },
      'sidebar.right.tab.files.actions': { kind: 'list', scope: 'session' },
      'sidebar.right.tab.files.path': { kind: 'single', scope: 'session' },
    },
    // Erased like the upstream registry fixtures: this spec drives registration, not rendering.
  }, (() => null) as never)
}

const createCtx = (core: SlotCore) => ({
  effect: (run: () => (() => void) | void) => { run() },
  slots: {
    inject: (_name: string, run: () => (() => void) | void) => { run() },
    register: (options: never, component: never) => core.register(options, component),
  },
})

describe('Desktop Workspace Sources registration', () => {
  let core: SlotCore

  beforeEach(() => {
    core = new SlotCore()
    declareSeats(core)
  })

  it('mounts every seat without pinning one store handle to two scopes', () => {
    expect(() => applyDesktopWorkspaceSources(createCtx(core) as never, 'linux')).not.toThrow()
    expect(core.entries('sidebar.workspaces.workspace.edit')).toHaveLength(1)
    expect(core.entries('sidebar.right.tab.files.actions').map(entry => entry.options.id))
      .toContain('desktop-workspace-sources')
    expect(core.entries('sidebar.right.tab.files.path')).toHaveLength(1)
  })

  it('shadows the upstream default path drawing instead of clashing with it', () => {
    core.register({ name: 'sidebar.right.tab.files.path' }, (() => null) as never)
    applyDesktopWorkspaceSources(createCtx(core) as never, 'linux')
    const drawn = core.entriesOfSlot('sidebar.right.tab.files.path')
    expect(drawn).toHaveLength(1)
    expect(drawn[0]?.options.priority).toBe(-1)
  })
})
