// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { AdvancedFrame, type AdvancedFrameProps } from '../src/client/AdvancedFrame.tsx'
import { DesktopFrameTitlebarView } from '../src/client/DesktopFrameTitlebarView.tsx'
import { zh } from '../src/client/desktop-settings-locales.ts'
import type { DesktopClientEnvironment } from '../src/client/environment.ts'
import { ExtendedFrame } from '../src/client/ExtendedFrame.tsx'
import { DesktopLayoutState } from '../src/client/layout-state.ts'

// Desktop replaces the upstream Web frame, so `@deepseek-ai/dsh-client-ui-layout`
// is absent from the client boot graph and its `<hash>_sidebarCol` column class
// never exists. This is the selector third-party plugins use to find the sidebar;
// when it resolves to nothing they mount nothing, silently.
const PLUGIN_SIDEBAR_SELECTOR = '[data-pane="sidebar"], [class*="sidebarCol"]'

function renderFrame(Frame: typeof AdvancedFrame): HTMLElement {
  const layout = new DesktopLayoutState()
  const props = {
    layout,
    platform: 'win32',
    renderSlot: vi.fn((name: string) => createElement('span', { 'data-slot': name })),
    usePanelInfo: (select: (info: PanelInfo) => unknown) => select(layout.getPanelInfo()),
  } as unknown as AdvancedFrameProps
  document.body.innerHTML = renderToStaticMarkup(createElement(Frame, props))
  return document.body
}

describe('desktop sidebar DOM anchor', () => {
  it.each([
    ['advanced', AdvancedFrame],
    ['extended', ExtendedFrame],
  ] as const)('resolves the Web sidebar-column selector in %s mode', (_mode, Frame) => {
    const body = renderFrame(Frame)

    const column = body.querySelector(PLUGIN_SIDEBAR_SELECTOR)
    expect(column).not.toBeNull()
    // The anchor belongs on the element that directly wraps the sidebar slot —
    // the structural peer of the upstream column, not the outer desktop chrome.
    expect(column?.querySelector('[data-slot="sidebar"]')).not.toBeNull()
    expect(column?.className).toContain('dshDesktopUpstreamSidebar')
  })

  it.each([
    ['advanced', AdvancedFrame],
    ['extended', ExtendedFrame],
  ] as const)('points both anchors at one element in %s mode', (_mode, Frame) => {
    const body = renderFrame(Frame)

    expect(body.querySelectorAll('[data-pane="sidebar"]')).toHaveLength(1)
    expect(body.querySelectorAll('[class*="sidebarCol"]')).toHaveLength(1)
    expect(body.querySelector('[data-pane="sidebar"]'))
      .toBe(body.querySelector('[class*="sidebarCol"]'))
  })

  it('keeps the compatibility class spelled the way attribute selectors match', () => {
    // `class` attribute matching is case-sensitive in standards mode, so the
    // upstream substring has to survive verbatim.
    const source = renderFrame(AdvancedFrame).innerHTML
    expect(source).toContain('sidebarCol')
    expect(source).not.toContain('sidebarcol')
  })
})

describe('desktop titlebar remote-control pill', () => {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  afterEach(async () => {
    await act(async () => root?.unmount())
    root = undefined
    container?.remove()
    vi.unstubAllGlobals()
  })

  it('shows the remote-control pill before native actions and removes its dot after viewing', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const open = vi.fn(async () => {})
    const noop = async () => {}
    const props = {
      api: { openTerminal: noop, restart: noop, restartToRecovery: noop, reloadRenderer: noop, toggleDeveloperTools: noop, checkForUpdates: noop },
      setMode: noop,
      t: (key: keyof typeof zh) => zh[key],
      environment: { mode: 'extended', platform: 'darwin', version: '2.0.8', material: 'transparent' } as DesktopClientEnvironment,
    }
    await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, { ...props, remoteControl: { seen: false, open } })) })
    const button = container.querySelector<HTMLButtonElement>('.dshDesktopRemoteControl')!
    expect(button.textContent).toContain('远程控制')
    expect(button.querySelector('[aria-label="新功能"]')).not.toBeNull()
    expect(button.nextElementSibling?.className).toContain('dshDesktopNativeActions')
    await act(async () => { button.click() })
    expect(open).toHaveBeenCalledTimes(1)
    await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, { ...props, remoteControl: { seen: true, open } })) })
    expect(container.querySelector('.dshDesktopRemoteControlDot')).toBeNull()
    expect(container.querySelector('.dshDesktopRemoteControl')).not.toBeNull()
    await act(async () => { root!.render(createElement(DesktopFrameTitlebarView, props)) })
    expect(container.querySelector('.dshDesktopRemoteControl')).toBeNull()
  })
})
