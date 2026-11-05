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

function useStoreFor(value: WorkspaceSourcesResponse) {
  return <S,>(selector: (state: WorkspaceSourcesState) => S): S => selector({ [WORKSPACE]: value })
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

  it('moves the Files tree through the owner callback when the selection changes', async () => {
    const onRootChange = vi.fn(async (_path: string) => {})
    const selectRoot = vi.fn(async (
      _workspacePath: string,
      _root: string,
      change: (path: string) => Promise<void>,
      _publish: (value: WorkspaceSourcesResponse) => void,
    ) => { await change(ATTACHED) })
    const select = await render({
      absolutePath: WORKSPACE,
      workspacePath: WORKSPACE,
      onRootChange,
      useSessions,
      useSessionStatus,
      useSessionRetainInfo,
      useWorkspaces,
      useRemoteAccess,
      useSessionAccess,
      useWorkspaceAccess,
      usePanelInfo,
      t,
      actions: { publish: vi.fn() },
      useStore: useStoreFor({ sources: [ATTACHED], selectedRoot: WORKSPACE }),
      platform: 'linux',
      load: vi.fn(async () => {}),
      selectRoot: selectRoot as WorkspaceSourcesRootActionProps['selectRoot'],
    })

    await choose(select, ATTACHED)

    expect(selectRoot).toHaveBeenCalledWith(WORKSPACE, ATTACHED, expect.any(Function), expect.any(Function))
    expect(onRootChange).toHaveBeenCalledWith(ATTACHED)
  })

  it('keys the selection by the Session cwd after the tree moved to an attached root', async () => {
    const selectRoot = vi.fn(async (
      _workspacePath: string,
      _root: string,
      _change: (path: string) => Promise<void>,
      _publish: (value: WorkspaceSourcesResponse) => void,
    ) => {})
    const select = await render({
      absolutePath: ATTACHED,
      workspacePath: WORKSPACE,
      onRootChange: vi.fn(async (_path: string) => {}),
      useSessions,
      useSessionStatus,
      useSessionRetainInfo,
      useWorkspaces,
      useRemoteAccess,
      useSessionAccess,
      useWorkspaceAccess,
      usePanelInfo,
      t,
      actions: { publish: vi.fn() },
      useStore: useStoreFor({ sources: [ATTACHED], selectedRoot: ATTACHED }),
      platform: 'linux',
      load: vi.fn(async () => {}),
      selectRoot: selectRoot as WorkspaceSourcesRootActionProps['selectRoot'],
    })

    await choose(select, WORKSPACE)

    expect(selectRoot.mock.calls[0]?.[0]).toBe(WORKSPACE)
    expect(selectRoot.mock.calls[0]?.[1]).toBe(WORKSPACE)
  })
})
