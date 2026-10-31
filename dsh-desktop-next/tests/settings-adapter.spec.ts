import { afterEach, expect, it, vi } from 'vitest'
import { NextSettingsAdapter, projectSettings } from '../src/client/settings-adapter.ts'
import {
  balanceSidebarFooterSlot,
  computeBalancedColumnCount,
  computeBalancedGridTemplate,
  installSidebarFooterStyles,
  setSidebarFooterBalanced,
  setSidebarFooterCompat,
  SIDEBAR_FOOTER_BALANCED_ATTRIBUTE,
  SIDEBAR_FOOTER_COMPAT_ATTRIBUTE,
} from '../src/client/sidebar-footer-styles.ts'
import { installWindowStyles } from '../src/client/styles.ts'
import { DEFAULT_PREFERENCES, type DesktopBridge, type DesktopBrowserLinks, type DesktopCommand, type DesktopState } from '../src/desktop-contract.ts'

afterEach(() => { vi.unstubAllGlobals() })

function fixture() {
  const state: DesktopState = {
    selected: 'desktop', profiles: ['desktop', 'work', 'broken'], unavailableProfiles: ['broken'],
    features: { market: true, remoteControl: false }, preferences: { ...DEFAULT_PREFERENCES },
    phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture', platform: 'darwin', version: '0.1.0',
    trayAvailable: true, notificationsAvailable: true, browserUrl: null, lan: null, checkpoint: null, logs: '',
  }
  const commands: DesktopCommand[] = []
  const links: DesktopBrowserLinks = { localUrl: null, lanUrls: [] }
  let fail = false
  const bridge: DesktopBridge = {
    state: async () => structuredClone(state),
    browserLinks: async () => structuredClone(links),
    command: async command => {
      commands.push(command)
      if (fail) { fail = false; throw new Error('Fixture save failure') }
      if (command.type === 'preferences') state.preferences = command.preferences
      if (command.type === 'switch') state.selected = command.name
    },
  }
  return { state, links, commands, bridge, rejectNext: () => { fail = true }, adapter: new NextSettingsAdapter(bridge) }
}

it('shares stable subscription snapshots and serializes independent preference writes', async () => {
  const { adapter, state } = fixture()
  await adapter.refresh()
  const original = adapter.desktopSettings.getSnapshot()
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot()).toBe(original)
  await Promise.all([
    adapter.notificationSettings.set('enabled', false),
    adapter.savePreferences({ closeToTray: false, port: 12345 }),
  ])
  expect(state.preferences).toMatchObject({ notifications: false, closeToTray: false, port: 12345 })
  expect(adapter.notificationSettings.getSnapshot().value?.enabled).toBe(false)
  expect(adapter.desktopSettings.getSnapshot().value?.port).toBe(12345)
})

it('restores persisted state after rejected or cancelled writes and accepts later changes', async () => {
  const { adapter, rejectNext, bridge, state } = fixture()
  await adapter.refresh()
  rejectNext()
  await expect(adapter.notificationSettings.set('enabled', false)).rejects.toThrow('Fixture save failure')
  expect(adapter.notificationSettings.getSnapshot().value?.enabled).toBe(true)
  await adapter.desktopSettings.set('openBrowser', true)
  expect(state.preferences.browserAccess).toBe(true)
  await adapter.desktopSettings.set('sidebarFooterCompat', false)
  expect(state.preferences.sidebarFooterCompat).toBe(false)
  expect(adapter.desktopSettings.getSnapshot().value?.sidebarFooterCompat).toBe(false)
  await adapter.desktopSettings.set('sidebarFooterBalanced', false)
  expect(state.preferences.sidebarFooterBalanced).toBe(false)
  expect(adapter.desktopSettings.getSnapshot().value?.sidebarFooterBalanced).toBe(false)
  // Native confirmation cancellation resolves without applying the requested value.
  bridge.command = async () => {}
  await adapter.desktopSettings.set('openBrowser', false)
  expect(adapter.desktopSettings.getSnapshot().value?.openBrowser).toBe(true)
  await expect(adapter.desktopSettings.set('__proto__', true)).rejects.toThrow('Unsupported')
})

it('maps only supported features and available Profiles to the shared settings API', async () => {
  const { adapter, state, commands } = fixture()
  const view = await adapter.api.read()
  expect(view.profiles.find(item => item.name === 'broken')?.selectable).toBe(false)
  expect(view.profiles.find(item => item.name === 'desktop')?.deletable).toBe(false)
  await expect(adapter.api.selectMarket('dsh-market')).rejects.toThrow('Plugins page')
  expect(commands).toEqual([])
  state.safeMode = true
  await adapter.refresh()
  expect(adapter.desktopSettings.getSnapshot().writable).toBe(false)
  expect(adapter.notificationSettings.getSnapshot().writable).toBe(false)
  expect(adapter.api.selectAa).toBeUndefined()
  expect(projectSettings(state).market.effective).toBe('disabled')
  await adapter.api.selectProfile('work')
  const switched = await adapter.api.read()
  expect(switched.current).toBe('work')
  expect(switched.profiles.find(item => item.name === 'desktop')?.deletable).toBe(false)
})

it('renders full login links and opens or copies the exact selected address', async () => {
  const { state, links, adapter, commands } = fixture()
  state.browserUrl = 'http://127.0.0.1:1234/'
  state.lan = { state: 'ready', actualPort: 5678, addresses: ['192.168.1.20', '10.0.0.20'], caFingerprint: 'fixture', errorCode: null }
  links.localUrl = state.browserUrl + '?token=browser-login'
  links.lanUrls = state.lan.addresses.map(address => `https://${address}:5678/?token=browser-login`)
  expect((await adapter.api.read()).web).toMatchObject({
    localUrl: links.localUrl, lanUrls: links.lanUrls,
    lanCaUrls: state.lan.addresses.map(address => `https://${address}:5678/.well-known/dsh-desktop-ca.crt`),
  })
  for (const url of [links.localUrl, ...links.lanUrls]) {
    await adapter.api.openBrowser!(url)
    await adapter.api.copyBrowser!(url)
  }
  expect(commands).toEqual([links.localUrl, ...links.lanUrls].flatMap(url => [{ type: 'open-browser-url', url }, { type: 'copy-browser-url', url }]))
  expect(adapter.getSnapshot()?.browserUrl).not.toContain('token=')
})

it('installs Settings left-nav scroll rules using official scrollbar tokens and removes them on dispose', () => {
  const appended: { dataset: Record<string, string>; textContent: string; remove: () => void }[] = []
  let removed = false
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      expect(tag).toBe('style')
      return { dataset: {}, textContent: '', remove: () => { removed = true } }
    },
    head: { append: (node: typeof appended[number]) => { appended.push(node) } },
  })
  const dispose = installWindowStyles()
  expect(appended).toHaveLength(1)
  expect(appended[0]!.dataset.plugin).toBe('dsh-desktop-next/window-controls')
  expect(appended[0]!.textContent).toContain("body [data-shortcut-modal='settings'] > nav > :last-child > *")
  expect(appended[0]!.textContent).toContain('padding-right: calc(10px - var(--dsh-scrollbar-width, 5px))')
  expect(appended[0]!.textContent).toContain('scrollbar-gutter: stable')
  dispose()
  expect(removed).toBe(true)
})

it('installs sidebar footer balanced grid styles and toggles the off attribute', () => {
  let css = ''
  let removed = false
  const attrs = new Map<string, string>()
  const style = {
    id: '',
    dataset: {} as Record<string, string>,
    get textContent() { return css },
    set textContent(value: string) { css = value },
    remove: () => { removed = true },
  }
  const appendChild = vi.fn()
  vi.stubGlobal('document', {
    documentElement: {
      setAttribute: (name: string, value: string) => { attrs.set(name, value) },
      removeAttribute: (name: string) => { attrs.delete(name) },
    },
    getElementById: () => null,
    createElement: () => style,
    head: { appendChild },
  })
  const dispose = installSidebarFooterStyles()
  expect(style.id).toBe('dsh-desktop-sidebar-footer-styles')
  expect(style.dataset.plugin).toBe('dsh-desktop-next')
  expect(css).toMatch(/body \[data-slot="sidebar\.footer\.action"\] \{[^}]*display: grid !important;[^}]*grid-template-columns: var\(--dsh-footer-grid-columns, repeat\(4, minmax\(0, 1fr\)\)\);[^}]*overflow-x: hidden;/)
  expect(css).toMatch(/html\[data-dsh-sidebar-footer-balanced="off"\]:not\(\[data-dsh-sidebar-footer-compat="off"\]\) body \[data-slot="sidebar\.footer\.action"\] \{\s*display: flex !important;\s*flex-direction: row;\s*flex-wrap: wrap;/)
  expect(css).toMatch(/body \[class\*="collapsed"\] \[data-slot="sidebar\.footer\.action"\],\s*html\[data-dsh-sidebar-footer-balanced="off"\] body \[class\*="collapsed"\] \[data-slot="sidebar\.footer\.action"\],\s*html\[data-dsh-sidebar-footer-compat="off"\] body \[data-slot="sidebar\.footer\.action"\] \{\s*display: grid !important;\s*grid-template-columns: minmax\(0, 1fr\) !important;\s*justify-items: center;\s*\}/)
  expect(css).toMatch(/body \[data-slot="sidebar\.footer\.action"\] > \[data-dsh-footer-item="compact"\] \{[^}]*grid-column: span 1;[^}]*justify-self: center;/)
  setSidebarFooterCompat(false)
  expect(attrs.get(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE)).toBe('off')
  setSidebarFooterCompat(true)
  expect(attrs.has(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE)).toBe(false)
  setSidebarFooterBalanced(false)
  expect(attrs.get(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE)).toBe('off')
  setSidebarFooterBalanced(true)
  expect(attrs.has(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE)).toBe(false)
  setSidebarFooterCompat(false)
  setSidebarFooterBalanced(false)
  dispose()
  expect(removed).toBe(true)
  expect(attrs.has(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE)).toBe(false)
  expect(attrs.has(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE)).toBe(false)
})

it('balances multi-row compact footer items into equal-split columns and keeps labelled items full-width', () => {
  // 6 alternating square (28px) and pill (56px) items in a 208px sidebar:
  // greedy wrap would be 5 + 1; balanced column count must be 3 (3 + 3).
  const mixedSix = [28, 56, 28, 56, 28, 56]
  expect(computeBalancedColumnCount(mixedSix, 208)).toBe(3)
  expect(computeBalancedGridTemplate(mixedSix, 208)).toBe('repeat(3, minmax(0, 1fr))')

  // 7 and 8 square icons (28px) in 208px wrap into 2 balanced rows of 4 columns (4 + 3 and 4 + 4).
  expect(computeBalancedColumnCount(Array(7).fill(28), 208)).toBe(4)
  expect(computeBalancedColumnCount(Array(8).fill(28), 208)).toBe(4)

  // Verify DOM slot classification separates full-width text launchers from compact icon items.
  function mockChild(labelText: string, width: number) {
    const childAttrs = new Map<string, string>()
    const childNodes = labelText
      ? [{ nodeType: 3, textContent: labelText }]
      : [{ nodeType: 1, tagName: 'SVG', childNodes: [] }]
    return {
      nodeType: 1,
      tagName: 'DIV',
      childNodes,
      scrollWidth: width,
      getBoundingClientRect: () => ({ width }),
      getAttribute: (name: string) => childAttrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => { childAttrs.set(name, value) },
    }
  }

  const children = [
    mockChild('插件市场', 208),
    mockChild('远程控制', 208),
    ...mixedSix.map(w => mockChild('', w)),
  ]
  const styleProps = new Map<string, string>()
  const slot = {
    clientWidth: 216,
    children,
    style: {
      getPropertyValue: (name: string) => styleProps.get(name) ?? '',
      setProperty: (name: string, value: string) => { styleProps.set(name, value) },
    },
  } as unknown as HTMLElement

  balanceSidebarFooterSlot(slot)
  expect(children[0]!.getAttribute('data-dsh-footer-item')).toBe('full')
  expect(children[1]!.getAttribute('data-dsh-footer-item')).toBe('full')
  for (const compact of children.slice(2)) {
    expect(compact.getAttribute('data-dsh-footer-item')).toBe('compact')
  }
  expect(styleProps.get('--dsh-footer-grid-columns')).toBe('repeat(3, minmax(0, 1fr))')
})
