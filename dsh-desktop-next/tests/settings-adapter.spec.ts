import { afterEach, expect, it, vi } from 'vitest'
import { NextSettingsAdapter, projectSettings } from '../src/client/settings-adapter.ts'
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
