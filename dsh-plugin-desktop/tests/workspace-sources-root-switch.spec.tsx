// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceSourcesRootAction } from '../src/client/WorkspaceSources.tsx'
import type { WorkspaceSourcesRootActionProps } from '../src/client/WorkspaceSources.tsx'
import type { WorkspaceSourcesState } from '../src/client/workspace-sources-store.ts'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { DesktopLayoutState } from '../src/client/layout-state.ts'
import { en, type DesktopSettingsLocaleKey } from '../src/client/desktop-settings-locales.ts'
import type { WorkspaceSourcesResponse } from '../src/client/workspace-sources-api.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconCloseOutlineRegular: () => null,
  IconFolderOpenOutlineRegular: () => null,
  IconPlusOutlineRegular: () => null,
}))

const WORKSPACE = '/work/project'
const ATTACHED = '/work/shared'
const t = ((key: DesktopSettingsLocaleKey) => en[key]) as WorkspaceSourcesRootActionProps['t']

function useStoreFor(key: string, value: WorkspaceSourcesResponse) {
  return <S,>(selector: (state: WorkspaceSourcesState) => S): S => selector({ [key]: value })
}

const useSessions = vi.fn() as WorkspaceSourcesRootActionProps['useSessions']
const useSessionStatus = vi.fn() as WorkspaceSourcesRootActionProps['useSessionStatus']
const useSessionRetainInfo = vi.fn() as WorkspaceSourcesRootActionProps['useSessionRetainInfo']
const useWorkspaces = vi.fn() as WorkspaceSourcesRootActionProps['useWorkspaces']
const layout = new DesktopLayoutState()
const usePanelInfo = <S,>(select: (info: PanelInfo) => S): S => select(layout.getPanelInfo())
const useRemoteAccess = (() => true) as WorkspaceSourcesRootActionProps['useRemoteAccess']
const useSessionAccess = (() => true) as WorkspaceSourcesRootActionProps['useSessionAccess']
const useWorkspaceAccess = (() => true) as WorkspaceSourcesRootActionProps['useWorkspaceAccess']
const useContextMenu = vi.fn() as WorkspaceSourcesRootActionProps['useContextMenu']
const useAccess = vi.fn() as WorkspaceSourcesRootActionProps['useAccess']
const useConversation = vi.fn() as WorkspaceSourcesRootActionProps['useConversation']
const useInput = vi.fn() as WorkspaceSourcesRootActionProps['useInput']
const inputActions = {} as WorkspaceSourcesRootActionProps['inputActions']

let root: Root | undefined
let container: HTMLDivElement | undefined

async function render(props: WorkspaceSourcesRootActionProps): Promise<HTMLSelectElement> {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => { root!.render(createElement(WorkspaceSourcesRootAction, props)) })
  return container.querySelector('select')!
}

async function choose(select: HTMLSelectElement, value: string): Promise<void> {
  await act(async () => {
    select.value = value
    select.dispatchEvent(new Event('change', { bubbles: true }))
  })
}

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  container?.remove()
  container = undefined
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

describe('Workspace source root switching', () => {
  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  })

  it('switches only the Files tree root, re-lists it, and never moves the Session cwd', async () => {
    const reload = vi.fn()
    const selectRoot = vi.fn(async (
      _workspacePath: string,
      _root: string,
      change: (path: string) => Promise<void>,
      _publish: (value: WorkspaceSourcesResponse) => void,
    ) => { await change(ATTACHED) })
    const select = await render({
      absolutePath: WORKSPACE,
      reload,
      useSessions,
      useSessionStatus,
      useSessionRetainInfo,
      useWorkspaces,
      useRemoteAccess,
      useSessionAccess,
      useWorkspaceAccess,
      usePanelInfo,
      useContextMenu,
      useAccess,
      useConversation,
      useInput,
      inputActions,
      t,
      actions: { publish: vi.fn() },
      useStore: useStoreFor(WORKSPACE, { sources: [ATTACHED], selectedRoot: WORKSPACE }),
      platform: 'linux',
      load: vi.fn(async () => {}),
      selectRoot: selectRoot as WorkspaceSourcesRootActionProps['selectRoot'],
    })

    await choose(select, ATTACHED)

    expect(selectRoot).toHaveBeenCalledWith(WORKSPACE, ATTACHED, expect.any(Function), expect.any(Function))
    const [keyedWorkspace, keyedRoot] = selectRoot.mock.calls[0]!
    expect(keyedWorkspace).toBe(WORKSPACE)
    expect(keyedRoot).toBe(ATTACHED)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('keys the selection by the tree root after that root moved to an attached source', async () => {
    const selectRoot = vi.fn(async (
      _workspacePath: string,
      _root: string,
      _change: (path: string) => Promise<void>,
      _publish: (value: WorkspaceSourcesResponse) => void,
    ) => {})
    const select = await render({
      absolutePath: ATTACHED,
      reload: vi.fn(),
      useSessions,
      useSessionStatus,
      useSessionRetainInfo,
      useWorkspaces,
      useRemoteAccess,
      useSessionAccess,
      useWorkspaceAccess,
      usePanelInfo,
      useContextMenu,
      useAccess,
      useConversation,
      useInput,
      inputActions,
      t,
      actions: { publish: vi.fn() },
      useStore: useStoreFor(ATTACHED, { sources: [WORKSPACE], selectedRoot: WORKSPACE }),
      platform: 'linux',
      load: vi.fn(async () => {}),
      selectRoot: selectRoot as WorkspaceSourcesRootActionProps['selectRoot'],
    })

    expect(select.value).toBe(WORKSPACE)

    await choose(select, ATTACHED)

    expect(selectRoot.mock.calls[0]?.[0]).toBe(ATTACHED)
    expect(selectRoot.mock.calls[0]?.[1]).toBe(ATTACHED)
  })
})
