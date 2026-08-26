import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import { apply } from '../src/client/index.ts'
import { AdvancedFrame } from '../src/client/AdvancedFrame.tsx'
import { applyAdvancedShell } from '../src/client/advanced-shell.ts'
import { provideDesktopLayout } from '../src/client/layout-service.ts'
import { parseDesktopClientEnvironment } from '../src/client/environment.ts'
import { ExtendedFrame } from '../src/client/ExtendedFrame.tsx'
import { applyExtendedShell, applyFramedShell } from '../src/client/extended-shell.ts'
import { installExtendedStyles } from '../src/client/extended-styles.ts'
import {
  collapsedSidebarWidth, computeDesktopColumns, DesktopLayoutState, MACOS_SIDEBAR_COLLAPSED, SIDEBAR_COLLAPSED,
} from '../src/client/layout-state.ts'
import { installDesktopOwnedStyles } from '../src/client/styles.ts'
import { desktopWindowService, provideDesktopWindow } from '../src/client/window-service.ts'
import {
  ADVANCED_MACOS_CONTENT_INSET,
  ADVANCED_MACOS_DRAG_LAYER_Z_INDEX,
  ADVANCED_MACOS_DRAG_REGION_HEIGHT,
  ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
  DESKTOP_FRAME_HEIGHT,
  MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
  WINDOWS_CAPTION_CONTROLS_WIDTH,
} from '../src/window-chrome.ts'

describe('desktop client environment', () => {
  it('does not activate desktop effects for an ordinary browser URL', () => {
    vi.stubGlobal('window', { location: { search: '' } })
    const effect = vi.fn()

    try {
      expect(parseDesktopClientEnvironment('')).toBeUndefined()
      apply({ effect } as unknown as ClientContext)
      expect(effect).not.toHaveBeenCalled()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('accepts the Electron-owned kebab query markers', () => {
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin&dsh-desktop-version=2.0.3&dsh-desktop-material=transparent'))
      .toEqual({ version: '2.0.3', mode: 'advanced', platform: 'darwin', material: 'transparent', micaSupported: false })
    expect(parseDesktopClientEnvironment('?dsh-desktop-platform=win32&dsh-desktop-mode=compatibility&dsh-desktop-version=2.0.3&dsh-desktop-material=off&dsh-desktop-mica=0'))
      .toEqual({ version: '2.0.3', mode: 'compatibility', platform: 'win32', material: 'off', micaSupported: false })
    expect(parseDesktopClientEnvironment('?dsh-desktop-mode=extended&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=mica&dsh-desktop-mica=1'))
      .toEqual({ version: '2.0.3', mode: 'extended', platform: 'win32', material: 'mica', micaSupported: true })
  })

  it.each([
    ['?dsh-desktop-mode=glass&dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced', 'dsh-desktop-platform'],
    ['?dsh-desktop-platform=darwin', 'dsh-desktop-mode'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=android', 'dsh-desktop-platform'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin', 'dsh-desktop-material'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=darwin&dsh-desktop-material=off', 'dsh-desktop-version'],
    ['?dsh-desktop-mode=advanced&dsh-desktop-platform=win32&dsh-desktop-version=2.0.3&dsh-desktop-material=mica&dsh-desktop-mica=0', 'incompatible'],
  ])('fails loud for malformed marker %s', (search, field) => {
    expect(() => parseDesktopClientEnvironment(search)).toThrow(field)
  })
})

describe('advanced desktop layout', () => {
  it('orders the Windows drag region after scrollable content and before overlays', () => {
    const frame = readFileSync(new URL('../src/client/AdvancedFrame.tsx', import.meta.url), 'utf8')
    const conversation = frame.indexOf('className="dshDesktopConversationSurface"')
    const details = frame.indexOf('className="dshDesktopDetailsSurface"')
    const caption = frame.indexOf('className="dshDesktopWindowsCaptionRow"')
    const overlay = frame.indexOf('className="dshDesktopOverlay"')

    expect([conversation, details, caption, overlay]).not.toContain(-1)
    expect(caption).toBeGreaterThan(conversation)
    expect(caption).toBeGreaterThan(details)
    expect(caption).toBeLessThan(overlay)
  })

  it('owns native caption geometry with one fixed macOS drag strip above page content', () => {
    expect(ADVANCED_MACOS_CONTENT_INSET).toBe(20)
    expect(ADVANCED_MACOS_DRAG_REGION_HEIGHT).toBe(32)
    expect(ADVANCED_MACOS_DRAG_LAYER_Z_INDEX).toBe(20)
    expect(ADVANCED_MACOS_DRAG_LAYER_Z_INDEX).toBeLessThan(25)
    expect(ADVANCED_MACOS_DRAG_REGION_HEIGHT).toBeGreaterThan(ADVANCED_MACOS_CONTENT_INSET)
    expect(ADVANCED_WINDOWS_TITLEBAR_HEIGHT).toBe(32)
    let css = ''
    const remove = vi.fn()
    const style = {
      dataset: {},
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installDesktopOwnedStyles()
      expect(css).toMatch(/\.dshDesktopFrame \{[^}]*transition: grid-template-columns var\(--ds-transition-duration-slow\) var\(--ds-ease-in-out\);/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-dragging\] \{ transition: none; \}/)
      expect(css).toMatch(/\[data-slot="sidebar\.footer\.action"\] \{[^}]*display: flex !important;[^}]*flex-direction: column;[^}]*max-height: min\(40vh, 240px\);[^}]*overflow-y: auto;/)
      expect(css).toMatch(/\[data-slot="sidebar\.footer\.action"\] > \* \{[^}]*flex: none;[^}]*min-width: 0;/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-details-collapsed\] \.dshDesktopDetailsSurface \{ border-left: none; \}/)
      expect(css).toMatch(/\.dshDesktopResizeHandle \{[^}]*transition: left var\(--ds-transition-duration-slow\) var\(--ds-ease-in-out\);/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-dragging\] \.dshDesktopResizeHandle \{ transition: none; \}/)
      expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*\.dshDesktopFrame,[\s\S]*\.dshDesktopResizeHandle \{ transition: none !important; \}/)
      expect(css).toMatch(/\.dshDesktopSidebarSurface\s*\{[^}]*--dsw-specific-sidebar-fill:\s*transparent;/)
      expect(css).toMatch(/data-desktop-mode="advanced"\]\[data-desktop-platform="darwin"\]\[data-sidebar-collapsed\][^{]*\.dshDesktopUpstreamSidebar \{[^}]*width:\s*56px;[^}]*margin:\s*0 auto;/)
      expect(css).not.toMatch(/data-desktop-mode="extended"[^{}]*data-sidebar-collapsed[^{}]*\.dshDesktopUpstreamSidebar/)
      expect(css).toMatch(new RegExp(`data-desktop-mode="advanced"\\]\\[data-desktop-platform="darwin"\\] \\.dshDesktopUpstreamSidebar \\{[^}]*padding-top: ${ADVANCED_MACOS_CONTENT_INSET}px;`))
      expect(css).not.toMatch(/\.dshDesktopUpstreamSidebar \{[^}]*-webkit-app-region: no-drag;/)
      expect(css).toContain(`grid-template-rows: ${ADVANCED_MACOS_CONTENT_INSET}px minmax(0, 1fr)`)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-mode="advanced"\]\[data-desktop-platform="darwin"\] \.dshDesktopSidebarSurface \{[^}]*grid-row: 1 \/ -1;/)
      expect(css).not.toMatch(/data-desktop-platform="darwin"\] \.dshDesktopSidebarSurface \{[^}]*-webkit-app-region: no-drag;/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-mode="advanced"\]\[data-desktop-platform="darwin"\] \.dshDesktopConversationSurface,\s*\.dshDesktopFrame\[data-desktop-mode="advanced"\]\[data-desktop-platform="darwin"\] \.dshDesktopDetailsSurface \{ grid-row: 2; \}/)
      expect(css).toMatch(new RegExp(`data-desktop-platform="darwin"\\] \\.dshDesktopSidebarSurface::before \\{[^}]*z-index: ${ADVANCED_MACOS_DRAG_LAYER_Z_INDEX};[^}]*left: ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH}px;[^}]*height: ${ADVANCED_MACOS_DRAG_REGION_HEIGHT}px;[^}]*-webkit-app-region: drag;`))
      expect(css).toMatch(new RegExp(`\\.dshDesktopMacCaptionRow \\{[^}]*position: absolute;[^}]*z-index: ${ADVANCED_MACOS_DRAG_LAYER_Z_INDEX};[^}]*grid-column: 2 / -1;[^}]*grid-row: 1;[^}]*left: 0;[^}]*height: ${ADVANCED_MACOS_DRAG_REGION_HEIGHT}px;[^}]*background: var\\(--dsw-alias-bg-base\\);[^}]*-webkit-app-region: drag;`))
      expect(css).not.toContain('.dshDesktopMacCaptionRow::before')
      expect(css).not.toMatch(/data-desktop-platform="darwin"\] \.dshDesktopSidebarSurface \{[^}]*-webkit-app-region:\s*drag;/)
      expect(css).not.toContain('[data-slot="conversation.session.header"]')
      expect(css).not.toContain('[data-phase')
      expect(css).toMatch(/\.dshDesktopNoDrag, button, input, textarea, select, label, summary, a,[^{}]*\{ -webkit-app-region: no-drag !important; \}/)
      expect(css).toContain('[contenteditable="true"]')
      expect(css).toContain('[role="switch"]')
      expect(css).not.toMatch(/html:has\(\[aria-modal="true"\]\) \.dshDesktopMacCaptionRow/)
      expect(css).not.toMatch(/html:has\(\[aria-modal="true"\]\) \.dshDesktopSidebarSurface/)
      expect(css).toContain(`grid-template-rows: ${ADVANCED_WINDOWS_TITLEBAR_HEIGHT}px minmax(0, 1fr)`)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-mode="advanced"\]\[data-desktop-platform="win32"\] \.dshDesktopSidebarSurface \{ grid-row: 1 \/ -1; \}/)
      expect(css).toMatch(/\.dshDesktopFrame\[data-desktop-mode="advanced"\]\[data-desktop-platform="win32"\] \.dshDesktopConversationSurface,\s*\.dshDesktopFrame\[data-desktop-mode="advanced"\]\[data-desktop-platform="win32"\] \.dshDesktopDetailsSurface \{ grid-row: 2; \}/)
      expect(css).toMatch(/\.dshDesktopWindowsCaptionRow \{[^}]*grid-column: 2 \/ -1;[^}]*grid-row: 1;/)
      expect(css).toMatch(new RegExp(`\\.dshDesktopWindowsCaptionRow::before \\{[^}]*inset: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH}px 0 0;[^}]*-webkit-app-region: drag;`))
      expect(css).toContain('html:has([aria-modal="true"]) .dshDesktopWindowsCaptionRow::before { -webkit-app-region: no-drag !important; }')
      expect(css).not.toMatch(/data-desktop-platform="win32"[^{}]*header[^{}]*\{[^}]*padding-right/)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })

  it('releases the Cordis layout service with its owning effect', () => {
    let disposed = false
    const ctx = {
      reflect: {
        provide: (name: string, value: unknown) => {
          expect(name).toBe('layout')
          expect(value).toBeInstanceOf(DesktopLayoutState)
          return () => { disposed = true }
        },
      },
    } as unknown as ClientContext

    const dispose = provideDesktopLayout(ctx, new DesktopLayoutState())
    expect(disposed).toBe(false)
    dispose()
    expect(disposed).toBe(true)
  })

  it('keeps the enhanced root registration independent from the extended frame', () => {
    const registrations: Array<Record<string, unknown>> = []
    const occupants: unknown[] = []
    const disposers: Array<() => void> = []
    const dataset: Record<string, string> = {}
    vi.stubGlobal('document', {
      body: {
        dataset,
        removeAttribute: vi.fn(),
        setAttribute: vi.fn(),
        style: { setProperty: vi.fn(), removeProperty: vi.fn() },
      },
      documentElement: { style: { colorScheme: '', removeProperty: vi.fn() } },
      createElement: vi.fn(() => ({
        content: '',
        dataset: {},
        isConnected: false,
        name: '',
        remove: vi.fn(),
        style: { setProperty: vi.fn(), removeProperty: vi.fn() },
        textContent: '',
      })),
      head: { appendChild: vi.fn() },
    })
    vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(0, 0, 0)' }))
    const ctx = {
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      reflect: { provide: vi.fn(() => () => {}) },
      theme: {
        getTheme: vi.fn(() => ({ active: { colorScheme: 'dark', tokens: {} } })),
      },
      on: vi.fn(() => () => {}),
      slots: {
        register: vi.fn((options: Record<string, unknown>, occupant: unknown) => {
          registrations.push(options)
          occupants.push(occupant)
          return () => {}
        }),
      },
    } as unknown as ClientContext

    try {
      applyAdvancedShell(ctx, {
        version: '2.0.3',
        mode: 'advanced',
        platform: 'darwin',
        material: 'transparent',
        micaSupported: false,
      })
      expect(registrations).toHaveLength(1)
      expect(occupants).toEqual([AdvancedFrame])
      const rootInject = (registrations[0]?.inject as () => Record<string, unknown>)()
      expect(rootInject).toMatchObject({ platform: 'darwin' })
      expect(rootInject).not.toHaveProperty('mode')
      expect(dataset).toMatchObject({
        dshDesktopMode: 'advanced',
        dshDesktopPlatform: 'darwin',
        dshDesktopMaterial: 'transparent',
      })
      disposers.forEach(dispose => { dispose() })
      expect(dataset).toEqual({})
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('reports generation-stable safe areas and drag geometry to client plugins', () => {
    expect(desktopWindowService({
      version: '2.0.3', mode: 'compatibility', platform: 'darwin', material: 'off', micaSupported: false,
    })).toEqual({
      version: '2.0.3',
      mode: 'compatibility',
      platform: 'darwin',
      material: 'off',
      micaSupported: false,
      availableMaterials: ['off', 'transparent'],
      safeAreaInsets: { top: DESKTOP_FRAME_HEIGHT, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: DESKTOP_FRAME_HEIGHT,
        leftInset: MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
        rightInset: 0,
      },
    })
    const mac = desktopWindowService({
      version: '2.0.3', mode: 'advanced', platform: 'darwin', material: 'transparent', micaSupported: false,
    })
    expect(mac).toEqual({
      version: '2.0.3',
      mode: 'advanced',
      platform: 'darwin',
      material: 'transparent',
      micaSupported: false,
      availableMaterials: ['off', 'transparent'],
      safeAreaInsets: { top: ADVANCED_MACOS_CONTENT_INSET, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: ADVANCED_MACOS_DRAG_REGION_HEIGHT,
        leftInset: MACOS_TRAFFIC_LIGHT_SAFE_WIDTH,
        rightInset: 0,
      },
    })
    expect(Object.isFrozen(mac)).toBe(true)
    expect(Object.isFrozen(mac.safeAreaInsets)).toBe(true)
    expect(Object.isFrozen(mac.dragRegion)).toBe(true)
    expect(desktopWindowService({
      version: '2.0.3', mode: 'advanced', platform: 'win32', material: 'acrylic', micaSupported: false,
    })).toEqual({
      version: '2.0.3',
      mode: 'advanced',
      platform: 'win32',
      material: 'acrylic',
      micaSupported: false,
      availableMaterials: ['off', 'acrylic'],
      safeAreaInsets: { top: ADVANCED_WINDOWS_TITLEBAR_HEIGHT, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: ADVANCED_WINDOWS_TITLEBAR_HEIGHT,
        leftInset: 0,
        rightInset: WINDOWS_CAPTION_CONTROLS_WIDTH,
      },
    })
    expect(desktopWindowService({
      version: '2.0.3', mode: 'extended', platform: 'win32', material: 'mica', micaSupported: true,
    })).toEqual({
      version: '2.0.3',
      mode: 'extended',
      platform: 'win32',
      material: 'mica',
      micaSupported: true,
      availableMaterials: ['off', 'acrylic', 'mica'],
      safeAreaInsets: { top: DESKTOP_FRAME_HEIGHT, right: 0, bottom: 0, left: 0 },
      dragRegion: {
        height: DESKTOP_FRAME_HEIGHT,
        leftInset: 0,
        rightInset: WINDOWS_CAPTION_CONTROLS_WIDTH,
      },
    })

    let disposed = false
    const ctx = {
      reflect: {
        provide: (name: string, value: unknown) => {
          expect(name).toBe('desktopWindow')
          expect(value).toBe(mac)
          return () => { disposed = true }
        },
      },
    } as unknown as ClientContext
    const dispose = provideDesktopWindow(ctx, mac)
    expect(disposed).toBe(false)
    dispose()
    expect(disposed).toBe(true)
  })

  it('keeps the wider macOS rail in enhanced mode and the upstream width in extended mode', () => {
    expect(computeDesktopColumns(1440, 0, 0)).toEqual({ sidebar: SIDEBAR_COLLAPSED, center: 1384, details: 0 })
    expect(computeDesktopColumns(1440, 0, 0, MACOS_SIDEBAR_COLLAPSED))
      .toEqual({ sidebar: MACOS_SIDEBAR_COLLAPSED, center: 1350, details: 0 })
    expect(SIDEBAR_COLLAPSED).toBe(56)
    expect(collapsedSidebarWidth('advanced', 'darwin')).toBe(MACOS_SIDEBAR_COLLAPSED)
    expect(collapsedSidebarWidth('extended', 'darwin')).toBe(SIDEBAR_COLLAPSED)
    expect(collapsedSidebarWidth('extended', 'win32')).toBe(SIDEBAR_COLLAPSED)
    expect(MACOS_SIDEBAR_COLLAPSED).toBe(90)
  })

  it('publishes mirrored panel transitions', () => {
    const layout = new DesktopLayoutState()
    const snapshots: object[] = []
    layout.subscribe(() => { snapshots.push(layout.getSnapshot()) })
    layout.toggleSidebar()
    layout.openDetails()
    layout.closeDetails()
    expect(snapshots).toEqual([
      { sidebar: 0, details: 0, narrow: false, narrowExpanded: false },
      { sidebar: 0, details: 360, narrow: false, narrowExpanded: false },
      { sidebar: 0, details: 0, narrow: false, narrowExpanded: false },
    ])
  })

  it('lets the rail re-expand without losing its wide preference on narrow windows', () => {
    const layout = new DesktopLayoutState()
    layout.setNarrow(true)
    expect(layout.getSnapshot()).toMatchObject({ sidebar: 280, narrow: true, narrowExpanded: false })
    layout.toggleSidebar()
    expect(layout.getSnapshot()).toMatchObject({ sidebar: 280, narrow: true, narrowExpanded: true })
    layout.setNarrow(false)
    expect(layout.getSnapshot()).toMatchObject({ sidebar: 280, narrow: false, narrowExpanded: false })
  })
})

describe('independent Desktop frame', () => {
  it('reserves a command bar for both framed modes and limits the inverted-L surface to extended mode', () => {
    let css = ''
    const remove = vi.fn()
    const style = {
      dataset: {},
      get textContent() { return css },
      set textContent(value: string) { css = value },
      remove,
    }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installExtendedStyles()
      expect(css).toContain(`top: ${DESKTOP_FRAME_HEIGHT}px`)
      expect(DESKTOP_FRAME_HEIGHT).toBe(36)
      expect(css).toMatch(/#root \{[^}]*position: fixed;[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;[^}]*padding-top: 0;[^}]*transform: translateZ\(0\);/)
      expect(css).toMatch(/\[data-shell-overlay\] \{[^}]*overflow: hidden;[^}]*transform: translateZ\(0\);/)
      expect(css).toMatch(/\[data-slot="sidebar\.footer\.action"\] \{[^}]*display: flex !important;[^}]*flex-direction: column;[^}]*max-height: min\(40vh, 240px\);[^}]*overflow-y: auto;/)
      expect(css).toMatch(/\[data-slot="sidebar\.footer\.action"\] > \* \{[^}]*flex: none;[^}]*min-width: 0;/)
      expect(css).toMatch(/\[role="presentation"\]:has\(> \[aria-modal="true"\]\),[\s\S]*> \[aria-modal="true"\] \{[\s\S]*top: var\(--dsh-desktop-frame-height\) !important;/)
      expect(css).not.toContain('#root > :has(> [data-shell-overlay])')
      expect(css).toMatch(/body\[data-dsh-desktop-mode="extended"\] \.dshDesktopSidebarSurface \{[^}]*--dsw-specific-sidebar-fill: transparent;[^}]*border-right-color: transparent;[^}]*background: transparent !important;/)
      expect(css).toMatch(/body\[data-dsh-desktop-mode="extended"\] \.dshDesktopFrame \{[^}]*background: var\(--dsh-desktop-frame-fill\);/)
      expect(css).toMatch(/body\[data-dsh-desktop-mode="extended"\] \.dshDesktopConversationSurface \{[^}]*border-top: 1px solid var\(--dsw-alias-border-l1\);[^}]*border-left: 1px solid var\(--dsw-alias-border-l1\);[^}]*border-top-left-radius: 10px;/)
      expect(css).toContain('body:is([data-dsh-desktop-mode="compatibility"], [data-dsh-desktop-mode="extended"]) #root')
      expect(css).toMatch(/\.dshDesktopFrameTitlebar \{[^}]*-webkit-app-region: drag;/)
      expect(css).toMatch(/\.dshDesktopFrameTitlebar \{[^}]*z-index: 2147483647;/)
      expect(css).toMatch(/\.dshDesktopFrameIdentity \{[^}]*left: 50%;[^}]*transform: translateX\(-50%\);/)
      expect(css).toMatch(/\.dshDesktopFrameActions \{[^}]*-webkit-app-region: no-drag;/)
      expect(css).toContain('[data-platform="darwin"] .dshDesktopFrameActions { margin-left: auto; }')
      expect(css).toContain('[data-platform="win32"] .dshDesktopFrameActions { margin-right: auto; }')
      expect(css).toMatch(/\.dshDesktopTitlebarIconButton \{[^}]*-webkit-app-region: no-drag;/)
      expect(css).toMatch(/\.dshDesktopTitlebarIconButton \{[^}]*width: 26px;[^}]*height: 26px;[^}]*border-radius: 7px;/)
      expect(css).toMatch(/\.dshDesktopTitlebarIconButton svg,[^}]*width: 14px;[^}]*height: 14px;/)
      expect(css).toContain('.dshDesktopActionMenu')
      expect(css).toContain(`padding: 0 ${WINDOWS_CAPTION_CONTROLS_WIDTH + 8}px 0 8px`)
      expect(css).toContain(`padding: 0 8px 0 ${MACOS_TRAFFIC_LIGHT_SAFE_WIDTH + 8}px`)
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(remove).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('owns the extended root and keeps its native frame actions private', () => {
    const registrations: Array<Record<string, unknown>> = []
    const occupants: unknown[] = []
    const disposers: Array<() => void> = []
    const dataset: Record<string, string> = {}
    const rootDataset: Record<string, string> = {}
    const bodyStyle = { setProperty: vi.fn(), removeProperty: vi.fn() }
    const documentElementStyle = { colorScheme: '', removeProperty: vi.fn() }
    const createElement = vi.fn(() => ({
      content: '',
      dataset: {},
      id: '',
      isConnected: false,
      name: '',
      remove: vi.fn(),
      style: { setProperty: vi.fn(), removeProperty: vi.fn() },
      textContent: '',
    }))
    vi.stubGlobal('document', {
      body: {
        dataset,
        removeAttribute: vi.fn(),
        setAttribute: vi.fn(),
        style: bodyStyle,
      },
      documentElement: { style: documentElementStyle },
      getElementById: (id: string) => id === 'root' ? { dataset: rootDataset } : null,
      createElement,
      head: { appendChild: vi.fn() },
    })
    vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(0, 0, 0)' }))
    const ctx = {
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      reflect: { provide: vi.fn(() => () => {}) },
      theme: {
        getTheme: vi.fn(() => ({ active: { colorScheme: 'dark', tokens: {} } })),
      },
      on: vi.fn(() => () => {}),
      slots: {
        inject: vi.fn((_name: string, mount: () => unknown) => mount()),
        register: vi.fn((options: Record<string, unknown>, occupant: unknown) => {
          registrations.push(options)
          occupants.push(occupant)
          return () => {}
        }),
      },
    } as unknown as ClientContext

    try {
      applyExtendedShell(ctx, {
        version: '2.0.3',
        mode: 'extended',
        platform: 'win32',
        material: 'acrylic',
        micaSupported: false,
      })
      expect(registrations[0]).toMatchObject({
        name: 'root',
        children: {
          sidebar: { kind: 'single', scope: 'root' },
          conversation: { kind: 'single', scope: 'session-maybe' },
          details: { kind: 'single', scope: 'session' },
          'shell.overlay': { kind: 'list', scope: 'root' },
        },
      })
      expect(registrations[0]?.inject).toBeTypeOf('function')
      const rootInject = (registrations[0]?.inject as () => Record<string, unknown>)()
      expect(rootInject).toMatchObject({
        platform: 'win32',
      })
      expect(rootInject).not.toHaveProperty('mode')
      expect(occupants[0]).toBe(ExtendedFrame)
      expect(registrations[1]).toMatchObject({
        name: 'shell.overlay',
        id: 'desktop-frame-titlebar',
      })
      expect(registrations[1]).not.toHaveProperty('children')
      expect(registrations[1]?.inject).toBeTypeOf('function')
      expect((registrations[1]?.inject as () => Record<string, unknown>)()).toMatchObject({
        environment: { mode: 'extended', platform: 'win32', material: 'acrylic' },
        api: expect.any(Object),
        setMode: expect.any(Function),
      })
      expect(registrations).toHaveLength(2)
      expect(dataset).toMatchObject({
        dshDesktopMode: 'extended',
        dshDesktopPlatform: 'win32',
        dshDesktopMaterial: 'acrylic',
      })
      expect(rootDataset).toEqual({ dshDesktopContentViewport: '' })
      disposers.forEach(dispose => { dispose() })
      expect(dataset).toEqual({})
      expect(rootDataset).toEqual({})
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('does not expose a plugin action seat in compatibility mode', () => {
    const registrations: Array<Record<string, unknown>> = []
    const injectedSlots: string[] = []
    const disposers: Array<() => void> = []
    const dataset: Record<string, string> = {}
    const rootDataset: Record<string, string> = {}
    vi.stubGlobal('document', {
      body: { dataset },
      getElementById: (id: string) => id === 'root' ? { dataset: rootDataset } : null,
      createElement: () => ({ dataset: {}, id: '', remove: vi.fn(), textContent: '' }),
      head: { appendChild: vi.fn() },
    })
    const ctx = {
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      slots: {
        inject: vi.fn((name: string, mount: () => unknown) => {
          injectedSlots.push(name)
          return mount()
        }),
        register: vi.fn((options: Record<string, unknown>) => {
          registrations.push(options)
          return () => {}
        }),
      },
    } as unknown as ClientContext

    try {
      applyFramedShell(ctx, {
        version: '2.0.3',
        mode: 'compatibility',
        platform: 'darwin',
        material: 'transparent',
        micaSupported: false,
      })
      expect(injectedSlots).toEqual(['shell.overlay'])
      expect(registrations).toHaveLength(1)
      expect(registrations[0]).toMatchObject({
        name: 'shell.overlay',
        id: 'desktop-frame-titlebar',
      })
      expect(registrations[0]).not.toHaveProperty('children')
      expect((registrations[0]?.inject as () => Record<string, unknown>)()).toMatchObject({
        setMode: expect.any(Function),
      })
      expect(JSON.stringify(registrations)).not.toContain('desktop.titlebar.action')
      expect(dataset).toMatchObject({
        dshDesktopMode: 'compatibility',
        dshDesktopPlatform: 'darwin',
        dshDesktopMaterial: 'transparent',
      })
      disposers.forEach(dispose => { dispose() })
      expect(dataset).toEqual({})
    } finally {
      vi.unstubAllGlobals()
    }
  })
})
