/** The LiveShare owner sign-in popup of dsh 0.2.2. */
import { EventEmitter } from 'node:events'
import { expect, it, vi } from 'vitest'
import type { BrowserWindow, WebContents } from 'electron'
import {
  guardOwnerLoginWindow,
  isOwnerLoginPopup,
  OWNER_LOGIN_FRAME,
  ownerLoginNavigation,
  ownerLoginWindowOptions,
} from '../../src/upstream-family/liveshare-owner-login.ts'

const HOST = 'http://127.0.0.1:43123'
const RELAY = 'https://relay.example.com/team'
const authorize = (origin: string): string =>
  `${RELAY}/__liveshare/owner-authorize?state=s&code_challenge=c&instance=i&origin=${encodeURIComponent(origin)}`

it.each([
  [OWNER_LOGIN_FRAME, 'about:blank', true],
  [OWNER_LOGIN_FRAME, '', true],
  [OWNER_LOGIN_FRAME, 'https://relay.example.com/', false],
  ['another-window', 'about:blank', false],
  ['', 'about:blank', false],
])('treats window.open(%j, %j) as the sign-in popup: %s', (frameName, url, accepted) => {
  expect(isOwnerLoginPopup({ frameName, url })).toBe(accepted)
})

it('addresses the Relay code to the Desktop document instead of the Host', () => {
  const decision = ownerLoginNavigation(authorize(HOST), HOST)
  expect(decision.kind).toBe('redirect')
  const url = new URL(decision.kind === 'redirect' ? decision.url : '')
  expect(`${url.origin}${url.pathname}`).toBe(`${RELAY}/__liveshare/owner-authorize`)
  expect(Object.fromEntries(url.searchParams)).toEqual({ state: 's', code_challenge: 'c', instance: 'i', origin: 'dsh-app://app' })
})

it.each([
  [authorize('dsh-app://app'), HOST, true, 'allow'],
  [authorize('https://owner.example.com'), HOST, true, 'allow'],
  [authorize(HOST), undefined, true, 'allow'],
  [`${RELAY}/__liveshare/owner-authorize`, HOST, true, 'allow'],
  ['https://accounts.example.com/oauth/authorize?client_id=x', HOST, true, 'allow'],
  ['http://127.0.0.1:8787/__liveshare/owner-authorize?state=s', HOST, true, 'allow'],
  ['about:blank', HOST, false, 'allow'],
  ['data:text/html,frame', HOST, false, 'allow'],
  [`${HOST}/`, HOST, true, 'cancel'],
  [`${HOST}/api/session/list`, HOST, false, 'cancel'],
  ['dsh-app://app/', HOST, true, 'cancel'],
  ['dsh-app://app/', HOST, false, 'cancel'],
  ['file:///etc/passwd', HOST, true, 'cancel'],
  ['javascript:alert(1)', HOST, true, 'cancel'],
  ['about:blank', HOST, true, 'cancel'],
  ['data:text/html,page', HOST, true, 'cancel'],
  ['https://user:pass@relay.example.com/', HOST, true, 'cancel'],
  ['not a url', HOST, true, 'cancel'],
])('decides %s (Host %s, main frame %s) as %s', (url, host, mainFrame, kind) => {
  expect(ownerLoginNavigation(url, host, mainFrame).kind).toBe(kind)
})

it('opens the popup sandboxed, without the Desktop preload or <webview>, above its window', () => {
  const parent = { isDestroyed: () => false } as unknown as BrowserWindow
  const options = ownerLoginWindowOptions(parent)
  expect(options.parent).toBe(parent)
  expect(options.webPreferences).toEqual({ sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false })
  expect(ownerLoginWindowOptions({ isDestroyed: () => true } as unknown as BrowserWindow)).not.toHaveProperty('parent')
})

function fakePopup(): EventEmitter & {
  openHandler?: (details: { url: string }) => { action: string }
  setWindowOpenHandler(handler: (details: { url: string }) => { action: string }): void
  loadURL: ReturnType<typeof vi.fn>
} {
  return Object.assign(new EventEmitter(), {
    setWindowOpenHandler(this: { openHandler?: unknown }, handler: unknown) { this.openHandler = handler },
    loadURL: vi.fn(async () => {}),
  }) as never
}

function event(url = '', isMainFrame = true): { url: string, isMainFrame: boolean, defaultPrevented: boolean, preventDefault(): void } {
  return { url, isMainFrame, defaultPrevented: false, preventDefault() { this.defaultPrevented = true } }
}

it('reloads the authorize page for the Desktop document and keeps the popup on web pages', () => {
  const popup = fakePopup()
  const openExternal = vi.fn()
  guardOwnerLoginWindow(popup as unknown as WebContents, { hostOrigin: () => HOST, openExternal })

  const first = event(authorize(HOST))
  popup.emit('will-frame-navigate', first)
  expect(first.defaultPrevented).toBe(true)
  expect(popup.loadURL).toHaveBeenCalledExactlyOnceWith(authorize('dsh-app://app'))

  const relayPage = event(`${RELAY}/__liveshare/owner-authorize`)
  popup.emit('will-frame-navigate', relayPage)
  expect(relayPage.defaultPrevented).toBe(false)
  for (const refused of [event('dsh-app://app/'), event(`${HOST}/api/session/list`, false)]) {
    popup.emit('will-frame-navigate', refused)
    expect(refused.defaultPrevented).toBe(true)
  }
  const redirect = event('file:///etc/passwd')
  popup.emit('will-redirect', redirect)
  expect(redirect.defaultPrevented).toBe(true)
  expect(popup.loadURL).toHaveBeenCalledOnce()

  expect(popup.openHandler?.({ url: 'https://relay.example.com/help' })).toEqual({ action: 'deny' })
  expect(openExternal).toHaveBeenCalledWith('https://relay.example.com/help')
  const webview = event()
  popup.emit('will-attach-webview', webview)
  expect(webview.defaultPrevented).toBe(true)
})
