import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import {
  WorkspaceSourcesEditor,
  WorkspaceSourcesRootAction,
} from '../src/client/WorkspaceSources.tsx'
import type {
  WorkspaceSourcesEditorProps,
  WorkspaceSourcesRootActionProps,
} from '../src/client/WorkspaceSources.tsx'
import type { WorkspaceSourcesState } from '../src/client/workspace-sources-store.ts'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { DesktopLayoutState } from '../src/client/layout-state.ts'
import { en, type DesktopSettingsLocaleKey } from '../src/client/desktop-settings-locales.ts'
import type { WorkspaceSourcesResponse } from '../src/client/workspace-sources-api.ts'
import { installWorkspaceSourcesStyles } from '../src/client/workspace-sources-styles.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconCloseOutlineRegular: () => null,
  IconFolderOpenOutlineRegular: () => null,
  IconPlusOutlineRegular: () => null,
}))

const WORKSPACE = '/work/project'
const ATTACHED = '/work/shared'
const snapshot: WorkspaceSourcesResponse = { sources: [ATTACHED], selectedRoot: ATTACHED }
const t = ((key: DesktopSettingsLocaleKey) => en[key]) as WorkspaceSourcesEditorProps['t']

function useStore<Value>(selector: (state: WorkspaceSourcesState) => Value): Value {
  return selector({ [WORKSPACE]: snapshot })
}

const publish = vi.fn()
const load = vi.fn(async (_path: string, _publish: WorkspaceSourcesEditorProps['actions']['publish']) => {})
const add = vi.fn(async (_path: string, _publish: WorkspaceSourcesEditorProps['actions']['publish']) => {})
const remove = vi.fn(async (
  _path: string,
  _source: string | undefined,
  _publish: WorkspaceSourcesEditorProps['actions']['publish'],
) => {})
const useSessions = vi.fn() as WorkspaceSourcesRootActionProps['useSessions']
const useSessionStatus = vi.fn() as WorkspaceSourcesRootActionProps['useSessionStatus']
const useSessionRetainInfo = vi.fn() as WorkspaceSourcesRootActionProps['useSessionRetainInfo']
const useWorkspaces = vi.fn() as WorkspaceSourcesRootActionProps['useWorkspaces']
const layout = new DesktopLayoutState()
const usePanelInfo = <S,>(select: (info: PanelInfo) => S): S => select(layout.getPanelInfo())
const useRemoteAccess = () => true
const useSessionAccess = () => true
const useWorkspaceAccess = () => true

function editorProps(platform = 'linux'): WorkspaceSourcesEditorProps {
  return {
    workspaceId: 'workspace:test' as WorkspaceSourcesEditorProps['workspaceId'],
    path: WORKSPACE,
    title: 'Project',
    useRemoteAccess,
    useSessionAccess,
    useWorkspaceAccess,
    useSessions,
    useSessionStatus,
    useSessionRetainInfo,
    useWorkspaces,
    usePanelInfo,
    t,
    actions: { publish },
    useStore,
    platform,
    load,
    add,
    remove,
  }
}

function rootActionProps(platform = 'linux'): WorkspaceSourcesRootActionProps {
  return {
    absolutePath: WORKSPACE,
    workspacePath: WORKSPACE,
    onRootChange: vi.fn(async (_path: string) => {}),
    useRemoteAccess,
    useSessionAccess,
    useWorkspaceAccess,
    useSessions,
    useSessionStatus,
    useSessionRetainInfo,
    useWorkspaces,
    usePanelInfo,
    t,
    actions: { publish },
    useStore,
    platform,
    load,
    selectRoot: vi.fn(async () => {}),
  }
}

describe('Workspace source UI', () => {
  it('installs Workspace Edit styles outside the onboarding-only CSS scope', () => {
    const style = { id: '', dataset: {} as Record<string, string>, textContent: '', remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      getElementById: () => null,
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installWorkspaceSourcesStyles('dsh-plugin-desktop')
      expect(style.dataset).toMatchObject({ plugin: 'dsh-plugin-desktop', pluginCss: 'dsh-plugin-desktop/workspace-sources' })
      expect(style.textContent).toContain('.dshWorkspaceSourcesEditor{')
      expect(style.textContent).toContain('.dshWorkspaceSourcesFolderRow{')
      expect(style.textContent).toContain('.dshWorkspaceSourcesAttachedRow{')
      expect(style.textContent).not.toContain('@scope')
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(style.remove).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('renders accessible Add and Detach controls in Workspace Edit', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceSourcesEditor, editorProps()))

    expect(markup).toContain(`aria-label="${en.workspaceSources}"`)
    expect(markup).toContain(`>${en.workspaceSourcesAdd}</span>`)
    expect(markup).toContain(`aria-label="${en.workspaceSourcesDetach}: ${ATTACHED}"`)
    expect(markup).toContain(WORKSPACE)
    expect(markup).toContain(ATTACHED)
    expect(markup).toContain('class="dshWorkspaceSourcesFolderRow dshWorkspaceSourcesAttachedRow"')
  })

  it('hides Add on Windows and explains unsupported attached folders', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceSourcesEditor, editorProps('win32')))

    expect(markup).toContain(en.workspaceSourcesWindowsNote)
    expect(markup).not.toContain(`>${en.workspaceSourcesAdd}</span>`)
  })

  it('exposes the saved Workspace root through an accessible, styled Files selector', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceSourcesRootAction, rootActionProps()))

    expect(markup).toContain(`<select`)
    expect(markup).toContain(`aria-label="${en.workspaceSourcesBrowse}"`)
    expect(markup).toMatch(new RegExp(`<option value="${ATTACHED}" selected="">`, 'u'))
    expect(markup).toContain('class="dshWorkspaceSourcesRootSelect"')
    expect(markup).toContain(`>${en.workspaceSourcesPrimary} · project</option>`)
    expect(markup).toContain(`>${en.workspaceSourcesAttached} · shared</option>`)
  })

  it('limits Windows Files browsing to the primary root', () => {
    const markup = renderToStaticMarkup(createElement(WorkspaceSourcesRootAction, rootActionProps('win32')))

    expect(markup).toMatch(new RegExp(`<option value="${WORKSPACE}" selected="">`, 'u'))
    expect(markup).not.toContain(ATTACHED)
  })
})
