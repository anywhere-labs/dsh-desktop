import { EventEmitter } from 'node:events'
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { NATIVE_ACCESS_HEADER } from '../src/desktop-contract.ts'
import { PLATFORM_LOGIN_PARTITION, PlatformLoginWindow, classifyPlatformLoginRequest, forwardPlatformLoginCallback, type PlatformLoginWindowOptions } from '../src/platform-login-window.ts'

const HOST = 'http://127.0.0.1:43123'
const servers: Server[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map(server => new Promise(resolve => server.close(resolve))))
})

it.each([
  [`${HOST}/oauth/callback?code=c&state=s`, 'mainFrame', 'callback'],
  [`${HOST}/oauth/callback?code=c&state=s`, 'subFrame', 'cancel'],
  [`${HOST}/oauth/callback?code=c&state=s`, 'xhr', 'cancel'],
  [`${HOST}/api/account`, 'mainFrame', 'cancel'],
  [`${HOST}/api/account`, 'xhr', 'cancel'],
  ['http://localhost:43123/oauth/callback?code=c&state=s', 'mainFrame', 'cancel'],
  ['http://127.0.0.1:9222/json', 'xhr', 'cancel'],
  ['https://127.0.0.2/', 'image', 'cancel'],
  ['https://[::1]/', 'mainFrame', 'cancel'],
  ['https://platform.deepseek.com/dsh/authorize?state=s', 'mainFrame', 'allow'],
  ['https://static.deepseek.com/app.js', 'script', 'allow'],
  ['https://user:pass@platform.deepseek.com/', 'mainFrame', 'cancel'],
  ['http://platform.deepseek.com/', 'mainFrame', 'cancel'],
  ['wss://platform.deepseek.com/socket', 'webSocket', 'allow'],
  ['data:image/png;base64,AA==', 'image', 'allow'],
  ['data:text/html,hi', 'mainFrame', 'cancel'],
  ['file:///C:/Windows/System32/calc.exe', 'mainFrame', 'cancel'],
  ['not a url', 'mainFrame', 'cancel'],
])('classifies %s (%s) as %s', (url, type, decision) => {
  expect(classifyPlatformLoginRequest(url, type, HOST)).toBe(decision)
})

it('never treats a callback as the Host one while the Host is down', () => {
  expect(classifyPlatformLoginRequest(`${HOST}/oauth/callback?code=c&state=s`, 'mainFrame', undefined)).toBe('cancel')
})

async function host(status: number): Promise<{ url: string; seen: { url?: string; headers?: IncomingHttpHeaders } }> {
  const seen: { url?: string; headers?: IncomingHttpHeaders } = {}
  const server = createServer((request, response) => {
    seen.url = request.url
    seen.headers = request.headers
    response.writeHead(status, status === 302 ? { location: 'https://platform.deepseek.com/dsh/authorized' } : {}).end()
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/?token=fixture`, seen }
}

it('replays the callback to the Host as the native renderer without following the completion redirect', async () => {
  const fixture = await host(302)
  const origin = new URL(fixture.url).origin
  const status = await forwardPlatformLoginCallback(`${origin}/oauth/callback?code=c&state=s#frag`,
    { url: fixture.url, cookie: 'dsh=session', token: 'native-token' })
  expect(status).toBe(302)
  expect(fixture.seen.url).toBe('/oauth/callback?code=c&state=s')
  expect(fixture.seen.headers?.[NATIVE_ACCESS_HEADER]).toBe('native-token')
  expect(fixture.seen.headers?.cookie).toBe('dsh=session')
})

it('reports a failed exchange status', async () => {
  const fixture = await host(204)
  const origin = new URL(fixture.url).origin
  expect(await forwardPlatformLoginCallback(`${origin}/oauth/callback?code=c&state=s`,
    { url: fixture.url, cookie: 'dsh=session', token: 'native-token' })).toBe(204)
})

it.each([
  ['http://127.0.0.1:1/oauth/callback?code=c&state=s', 'another origin'],
  [`${HOST}/api/account`, 'another route'],
])('refuses to replay %s (%s)', async (callback) => {
  let called = false
  await expect(forwardPlatformLoginCallback(callback, { url: `${HOST}/`, cookie: 'c', token: 't' },
    () => { called = true; return Promise.resolve(new Response(null)) })).rejects.toThrow('Not a Host sign-in callback')
  expect(called).toBe(false)
})

describe('the sign-in window', () => {
  /** Enough of Electron's window and session to drive one sign-in window. */
  function electronFakes() {
    const windows: FakeWindow[] = []
    class FakeWindow extends EventEmitter {
      readonly webContents = Object.assign(new EventEmitter(), { setWindowOpenHandler: vi.fn() })
      destroyed = false
      constructor() { super(); windows.push(this) }
      isDestroyed() { return this.destroyed }
      destroy() { this.destroyed = true; this.emit('closed') }
      loadURL = vi.fn(async () => {})
      show = vi.fn()
      focus = vi.fn()
    }
    const loginSession = Object.assign(new EventEmitter(), {
      setPermissionRequestHandler: vi.fn(), setPermissionCheckHandler: vi.fn(), setDevicePermissionHandler: vi.fn(),
      setDisplayMediaRequestHandler: vi.fn(), clearStorageData: vi.fn(async () => {}),
      webRequest: { onBeforeRequest: vi.fn() },
    })
    return { windows, FakeWindow, loginSession }
  }

  function open(extra: Partial<PlatformLoginWindowOptions> = {}) {
    const { windows, FakeWindow, loginSession } = electronFakes()
    const partition = vi.fn(() => loginSession)
    const deliver = vi.fn(async () => 302)
    const warn = vi.fn()
    const closedByUser = vi.fn()
    const login = new PlatformLoginWindow({
      BrowserWindow: FakeWindow as never, session: partition as never, host: () => undefined, parent: () => undefined,
      title: () => 'Sign in', dark: () => false, warn, partition: 'other', closedByUser, deliver,
      classify: url => url.startsWith('http://127.0.0.1:43123/oauth/callback') ? 'callback' : 'allow',
      ...extra,
    })
    login.open('https://tokens.example/oauth/authorize/')
    return { login, window: windows[0]!, loginSession, partition, deliver, warn, closedByUser }
  }

  it('stops a page going to the callback before any request, so no failed load prints the code', async () => {
    const { window, deliver } = open()
    const stopped = { preventDefault: vi.fn() }
    window.webContents.emit('will-navigate', stopped, 'http://127.0.0.1:43123/oauth/callback?code=secret&state=s')
    expect(stopped.preventDefault).toHaveBeenCalledOnce()
    expect(deliver).toHaveBeenCalledWith('http://127.0.0.1:43123/oauth/callback?code=secret&state=s')
    const onward = { preventDefault: vi.fn() }
    window.webContents.emit('will-navigate', onward, 'https://tokens.example/oauth/authorize/finish/')
    expect(onward.preventDefault).not.toHaveBeenCalled()
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('stops a server redirect to the callback the same way, for the main frame only', () => {
    const { window, deliver } = open()
    const framed = { preventDefault: vi.fn() }
    window.webContents.emit('will-redirect', framed, 'http://127.0.0.1:43123/oauth/callback?code=c', false, false)
    expect(framed.preventDefault).not.toHaveBeenCalled()
    expect(deliver).not.toHaveBeenCalled()
    const stopped = { preventDefault: vi.fn() }
    window.webContents.emit('will-redirect', stopped, 'http://127.0.0.1:43123/oauth/callback?code=c', false, true)
    expect(stopped.preventDefault).toHaveBeenCalledOnce()
    expect(deliver).toHaveBeenCalledWith('http://127.0.0.1:43123/oauth/callback?code=c')
  })

  it('still catches a callback that only shows up as a request', () => {
    const { loginSession, deliver } = open()
    const listener = loginSession.webRequest.onBeforeRequest.mock.calls[0]![0] as (details: object, callback: (answer: object) => void) => void
    const answer = vi.fn()
    listener({ url: 'http://127.0.0.1:43123/oauth/callback?code=c', resourceType: 'mainFrame' }, answer)
    expect(answer).toHaveBeenCalledWith({ cancel: true })
    expect(deliver).toHaveBeenCalledWith('http://127.0.0.1:43123/oauth/callback?code=c')
    listener({ url: 'https://tokens.example/app.js', resourceType: 'script' }, answer)
    expect(answer).toHaveBeenLastCalledWith({ cancel: false })
    expect(deliver).toHaveBeenCalledOnce()
  })

  it('notes an unexpected answer from the callback, and a failed delivery', async () => {
    const refused = open({ deliver: vi.fn(async () => 400) })
    refused.window.webContents.emit('will-navigate', { preventDefault: vi.fn() }, 'http://127.0.0.1:43123/oauth/callback?code=c')
    await vi.waitFor(() => { expect(refused.warn).toHaveBeenCalledOnce() })
    expect(String(refused.warn.mock.calls[0]![0])).not.toContain('code=c')
    const failed = open({ deliver: vi.fn(async () => { throw new Error('unreachable') }) })
    failed.window.webContents.emit('will-navigate', { preventDefault: vi.fn() }, 'http://127.0.0.1:43123/oauth/callback?code=c')
    await vi.waitFor(() => { expect(failed.warn).toHaveBeenCalledOnce() })
  })

  it('tells the owner only when the user closed the window', () => {
    const byUser = open()
    byUser.window.emit('closed')
    expect(byUser.closedByUser).toHaveBeenCalledOnce()
    const closed = open()
    closed.login.close()
    expect(closed.closedByUser).not.toHaveBeenCalled()
    expect(closed.window.destroyed).toBe(true)
  })

  it('uses the partition it is given, and the Platform\'s by default', () => {
    expect(open().partition).toHaveBeenCalledWith('other')
    const { FakeWindow, loginSession } = electronFakes()
    const partition = vi.fn(() => loginSession)
    new PlatformLoginWindow({ BrowserWindow: FakeWindow as never, session: partition as never, host: () => undefined, parent: () => undefined,
      title: () => '', dark: () => false, warn: () => {} }).open('https://platform.deepseek.com/')
    expect(partition).toHaveBeenCalledWith(PLATFORM_LOGIN_PARTITION)
  })
})
