/**
 * Behaviour tests for the Desktop browser panel's column.
 *
 * The panel draws its own layer over the right track instead of taking the
 * shipped right Sidebar's seat, so these tests drive the layout state, the frame
 * that renders the layer, and the registration that claims the column.
 */

import { createElement, type ReactNode } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PanelInfo } from '@deepseek-ai/dsh-client-ui-layout/client'
import { AdvancedFrame, type AdvancedFrameProps } from '../src/client/AdvancedFrame.tsx'
import { applyDesktopBrowser, DESKTOP_BROWSER_LOCALE_NAMESPACE } from '../src/client/browser.ts'
import type { DesktopBrowserPanelController } from '../src/client/browser-panel.ts'
import { DesktopLayoutState } from '../src/client/layout-state.ts'

/** The slot the panel draws into; the shipped Sidebar keeps `rightbar`. */
const COLUMN_SLOT = 'desktop.browser.column'

/** A client context carrying the frame's layout service, with no React. */
function fakeClient() {
  const registrations: { name?: string; locale?: string; inject?: () => unknown; priority?: number }[] = []
  const disposers: (() => void)[] = []
  const layout = new DesktopLayoutState()
  const slots = {
    inject: vi.fn((_name: string, factory: () => unknown) => {
      const dispose = factory()
      return typeof dispose === 'function' ? dispose : () => {}
    }),
    register: vi.fn((options: { name?: string; locale?: string; inject?: () => unknown }) => {
      registrations.push(options)
      const dispose = vi.fn()
      disposers.push(dispose)
      return dispose
    }),
  }
  const ctx = {
    reflect: { provide: vi.fn(), get: vi.fn() },
    effect: vi.fn((factory: () => unknown) => { factory() }),
    get: vi.fn((name: string) => (name === 'layout' ? layout : undefined)),
    locale: { register: vi.fn(), bind: vi.fn(() => (key: string) => key) },
    slots,
  }
  const indexOf = (name: string): number => registrations.findIndex(entry => entry.name === name)
  return {
    ctx,
    layout,
    slots,
    registrations,
    /** Every registration of one slot, in order. */
    named: (name: string) => registrations.filter(entry => entry.name === name),
    /** The disposer of one slot's registration. */
    disposerOf: (name: string) => disposers[indexOf(name)],
    /** The controller factory the panel's own registration carries. */
    controller: (): ((sessionId: string) => DesktopBrowserPanelController) => {
      // The header toggle carries the same factory, so a panel can be driven
      // before its own layer is registered.
      const entry = registrations.find(candidate => candidate.name === COLUMN_SLOT)
        ?? registrations.find(candidate => typeof candidate.inject === 'function')
      const injected = entry?.inject?.() as { controller: (sessionId: string) => DesktopBrowserPanelController } | undefined
      if (injected === undefined) throw new Error('the panel layer registered no controller factory')
      return injected.controller
    },
  }
}

/** Answer every Host channel exchange, so a panel's poll settles. */
function scriptHost(): void {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
    ok: true,
    state: { activeId: null, tabs: [], canGoBack: false, canGoForward: false, viewport: { width: 800, height: 600 }, visible: true, layout: 'fit', zoom: 1 },
    panel: { visible: false, epoch: 1 },
  }), { headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
}

beforeEach(() => {
  scriptHost()
  // The panel installs its own stylesheet on apply; this suite has no DOM.
  vi.stubGlobal('document', {
    createElement: () => ({ dataset: {} as Record<string, string>, textContent: '', remove(): void {} }),
    head: { appendChild(): void {} },
  })
  globalThis.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    callback(0)
    return 1
  }) as typeof requestAnimationFrame
  globalThis.cancelAnimationFrame = (() => {}) as typeof cancelAnimationFrame
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('right column presentation', () => {
  it('lays the column out for the surface that is showing', () => {
    const layout = new DesktopLayoutState()
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false })

    // The shipped Sidebar reports its own panel.
    layout.openRightbar(true, false)
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false })

    // A browser panel claim outranks that report while it lasts.
    layout.showBrowserColumn(true, true)
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: true })

    // Releasing the claim falls back to the Sidebar's own report, not to nothing.
    layout.hideBrowserColumn()
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false })

    layout.closeRightbar()
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false })
  })

  it('reports a Sidebar panel that rises while the browser holds the column', () => {
    const layout = new DesktopLayoutState()
    layout.showBrowserColumn(true, false)
    expect(layout.getSnapshot().sidebarTakeover).toBe(false)

    layout.openRightbar(true, false)
    expect(layout.getSnapshot().sidebarTakeover).toBe(true)

    // The flag clears with the claim it interrupted, so the next panel opens clean.
    layout.hideBrowserColumn()
    expect(layout.getSnapshot().sidebarTakeover).toBe(false)
    layout.showBrowserColumn(true, false)
    expect(layout.getSnapshot()).toMatchObject({ sidebarTakeover: false, rightbarFullscreen: false })
  })

  it('does not report a takeover for a Sidebar that was already showing', () => {
    const layout = new DesktopLayoutState()
    layout.openRightbar(true, false)
    layout.showBrowserColumn(true, false)

    // A re-report of the same presentation, and a change of track, are not raises.
    layout.openRightbar(true, false)
    layout.openRightbar(false, true)
    expect(layout.getSnapshot().sidebarTakeover).toBe(false)
  })

  it('reports what the panel claims, and keeps the claim out of the Sidebar path', () => {
    const layout = new DesktopLayoutState()
    layout.showBrowserColumn(true, false)
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false })
    layout.showBrowserColumn(true, true)
    expect(layout.getSnapshot()).toMatchObject({ rightbarFullscreen: true })
    layout.hideBrowserColumn()
    expect(layout.getSnapshot()).toMatchObject({ rightbarShown: false, rightbarTrack: false, rightbarFullscreen: false })
  })
})

describe('browser column frame', () => {
  it('reports the takeover to the layer it draws over the track', () => {
    vi.stubGlobal('window', { innerWidth: 1440 })
    const layout = new DesktopLayoutState()
    const renderSlot = vi.fn((name: string) => createElement('span', { 'data-slot': name }))
    const props = {
      layout,
      platform: 'darwin',
      renderSlot,
      usePanelInfo: (select: (info: PanelInfo) => unknown) => select(layout.getPanelInfo()),
      SessionProvider: ({ children }: { children: ReactNode }) => children,
    } as unknown as AdvancedFrameProps

    try {
      renderToStaticMarkup(createElement(AdvancedFrame, props))
      expect(renderSlot).toHaveBeenCalledWith(COLUMN_SLOT, { sidebarTakeover: false })

      layout.showBrowserColumn(true, false)
      layout.openRightbar(true, false)
      layout.setRightbar(510, 1440)
      const markup = renderToStaticMarkup(createElement(AdvancedFrame, props))
      expect(renderSlot).toHaveBeenCalledWith(COLUMN_SLOT, { sidebarTakeover: true })
      // The column itself stays laid out for the surface that is showing.
      expect(markup).toContain('grid-template-columns:280px minmax(0, 1fr) 510px')
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('desktop browser column registration', () => {
  it('draws its own layer instead of taking the shipped Sidebar seat', () => {
    const client = fakeClient()
    applyDesktopBrowser(client.ctx as never)
    client.controller()('session-a').setOpen(true)

    expect(client.named(COLUMN_SLOT)).toHaveLength(1)
    expect(client.named(COLUMN_SLOT)[0]?.locale).toBe(DESKTOP_BROWSER_LOCALE_NAMESPACE)
    expect(client.named('rightbar')).toHaveLength(0)
    expect(client.registrations.every(entry => entry.priority === undefined)).toBe(true)
  })

  it('claims the column while any Session shows a panel, and keeps it for the others', () => {
    const client = fakeClient()
    applyDesktopBrowser(client.ctx as never)
    const controller = client.controller()
    controller('session-a').setOpen(true)

    expect(client.layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: true, rightbarFullscreen: false })

    controller('session-b').setOpen(true)
    expect(client.named(COLUMN_SLOT)).toHaveLength(1)
    // One Session closing its panel must not withdraw the layer another holds.
    controller('session-a').setOpen(false)
    expect(client.disposerOf(COLUMN_SLOT)).not.toHaveBeenCalled()
    expect(client.layout.getSnapshot().rightbarShown).toBe(true)

    controller('session-b').setOpen(false)
    expect(client.disposerOf(COLUMN_SLOT)).toHaveBeenCalled()
    expect(client.layout.getSnapshot()).toMatchObject({ rightbarShown: false, rightbarTrack: false })
  })

  it('leaves a Sidebar panel that outlives the browser claim in place', () => {
    const client = fakeClient()
    applyDesktopBrowser(client.ctx as never)
    const controller = client.controller()

    // The Sidebar shows a preview, the user opens the panel over it, then closes it.
    client.layout.openRightbar(true, false)
    controller('session-a').setOpen(true)
    expect(client.layout.getSnapshot()).toMatchObject({ sidebarTakeover: false, rightbarFullscreen: false })

    controller('session-a').setOpen(false)
    expect(client.layout.getSnapshot()).toMatchObject({ rightbarShown: true, rightbarTrack: true })
  })
})
