// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { AdvancedFrame, type AdvancedFrameProps } from '../src/client/AdvancedFrame.tsx'
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
