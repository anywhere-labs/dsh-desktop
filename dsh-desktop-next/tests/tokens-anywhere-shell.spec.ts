import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { classifyAnywhereLoginRequest, deliverAnywhereCallback, isAnywhereLoginLink, isLocalSignIn } from '../src/anywhere-login.ts'
import { TokensAnywhereShell } from '../src/host/tokens-anywhere-shell.ts'

describe('sign-in window rules', () => {
  const CALLBACK = 'http://127.0.0.1:43123/oauth/callback'

  it.each([
    ['https://tokens-anywhere.com/oauth/authorize/?x=1', 'mainFrame', 'allow'],
    ['https://cdn.example/app.js', 'script', 'allow'],
    ['wss://tokens-anywhere.com/socket', 'webSocket', 'allow'],
    ['wss://tokens-anywhere.com/socket', 'mainFrame', 'cancel'],
    ['http://tokens-anywhere.com/', 'mainFrame', 'cancel'],
    [`${CALLBACK}?code=c&state=s&iss=https%3A%2F%2Ftokens-anywhere.com`, 'mainFrame', 'callback'],
    [`${CALLBACK}?code=c`, 'subFrame', 'cancel'],
    ['http://127.0.0.1:43123/other', 'mainFrame', 'cancel'],
    ['http://127.0.0.1:43124/oauth/callback', 'mainFrame', 'cancel'],
    ['http://localhost:8080/admin', 'xhr', 'cancel'],
    ['https://127.0.0.1:8443/', 'mainFrame', 'cancel'],
    ['https://user:pass@tokens-anywhere.com/', 'mainFrame', 'cancel'],
    ['file:///etc/passwd', 'mainFrame', 'cancel'],
    ['data:text/html,hello', 'mainFrame', 'cancel'],
    ['data:image/png;base64,AA', 'image', 'allow'],
  ])('%s as %s is %s', (url, type, decision) => {
    expect(classifyAnywhereLoginRequest(url, type, CALLBACK, false)).toBe(decision)
  })

  it('reaches loopback pages only for a Tokens Anywhere on this computer, and the callback is still intercepted', () => {
    expect(isLocalSignIn('http://localhost:5173/oauth/authorize/')).toBe(true)
    expect(isLocalSignIn('https://tokens-anywhere.com/oauth/authorize/')).toBe(false)
    expect(classifyAnywhereLoginRequest('http://127.0.0.1:5174/#/tokens-anywhere-oauth', 'mainFrame', CALLBACK, true)).toBe('allow')
    expect(classifyAnywhereLoginRequest('ws://localhost:5173/_next/webpack-hmr', 'webSocket', CALLBACK, true)).toBe('allow')
    expect(classifyAnywhereLoginRequest(`${CALLBACK}?code=c`, 'mainFrame', CALLBACK, true)).toBe('callback')
    expect(classifyAnywhereLoginRequest('http://192.168.1.2/', 'mainFrame', CALLBACK, true)).toBe('cancel')
  })

  it('delivers only the current attempt\'s callback, without following its redirect', async () => {
    const fetchImpl = vi.fn(async () => new Response(null, { status: 302 }))
    const url = `${CALLBACK}?code=c&state=s`
    await expect(deliverAnywhereCallback(url, CALLBACK, fetchImpl as never)).resolves.toBe(302)
    expect(String((fetchImpl.mock.calls as unknown as [URL, RequestInit][])[0]![0])).toBe(url)
    expect((fetchImpl.mock.calls as unknown as [URL, RequestInit][])[0]![1]).toMatchObject({ method: 'GET', redirect: 'manual' })
    await expect(deliverAnywhereCallback(url, undefined, fetchImpl as never)).rejects.toThrow('No Tokens Anywhere sign-in')
    await expect(deliverAnywhereCallback('http://127.0.0.1:43124/oauth/callback?code=c', CALLBACK, fetchImpl as never)).rejects.toThrow('Not the Tokens')
    await expect(deliverAnywhereCallback('https://evil.example/oauth/callback', CALLBACK, fetchImpl as never)).rejects.toThrow('Not the Tokens')
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

it('treats only the bare sign-in link as a trigger', () => {
  expect(isAnywhereLoginLink('dsh://v1/tokens/login')).toBe(true)
  expect(isAnywhereLoginLink('dsh://v1/tokens/login/')).toBe(true)
  for (const refused of [
    'dsh://v1/tokens/login?code=attacker', 'dsh://v1/tokens/login#code=attacker', 'dsh://v1/tokens/login?state=s&token=t',
    'dsh://v1/tokens', 'dsh://open', 'https://tokens-anywhere.com/oauth/authorize/', '--dsh-recovery',
  ]) expect(isAnywhereLoginLink(refused)).toBe(false)
})

describe('desktopTokensAnywhere', () => {
  function connection() {
    const events = new EventEmitter()
    const sent: Record<string, unknown>[] = []
    return {
      sent, events,
      connected: true,
      on: (name: string, listener: (...args: unknown[]) => void) => { events.on(name, listener) },
      off: (name: string, listener: (...args: unknown[]) => void) => { events.off(name, listener) },
      send: (message: Record<string, unknown>, callback?: (error: Error | null) => void) => { sent.push(message); callback?.(null); return true },
    }
  }

  it('asks the shell to seal and open secrets, and treats no answer as unavailable', async () => {
    const link = connection()
    const closed = vi.fn()
    const requested = vi.fn()
    const shell = new TokensAnywhereShell(link as never)
    shell.onLoginClosed(closed)
    shell.onLinkOpened(requested)
    const sealing = shell.seal('ta_rt_secret')
    expect(link.sent[0]).toMatchObject({ type: 'anywhere-secret', action: 'seal', value: 'ta_rt_secret' })
    link.events.emit('message', { type: 'anywhere-secret-result', requestId: link.sent[0]!.requestId, value: 'sealed' })
    await expect(sealing).resolves.toBe('sealed')
    const opening = shell.open('sealed')
    link.events.emit('message', { type: 'anywhere-secret-result', requestId: link.sent[1]!.requestId, error: 'Secure storage is unavailable' })
    await expect(opening).resolves.toBeUndefined()
    shell.openLogin('https://tokens.example/oauth/authorize/', 'http://127.0.0.1:43123/oauth/callback')
    shell.closeLogin(true)
    shell.revealFile('credentials')
    expect(link.sent.slice(2)).toEqual([
      { type: 'anywhere-login', action: 'open', url: 'https://tokens.example/oauth/authorize/', callback: 'http://127.0.0.1:43123/oauth/callback' },
      { type: 'anywhere-login', action: 'close', focus: true },
      { type: 'anywhere-reveal', file: 'credentials' },
    ])
    link.events.emit('message', { type: 'anywhere-login-closed' })
    expect(closed).toHaveBeenCalledOnce()
    link.events.emit('message', { type: 'anywhere-login-requested' })
    expect(requested).toHaveBeenCalledOnce()
    shell.dispose()
    await expect(shell.seal('later')).resolves.toBeUndefined()
  })

  it('keeps a link that came before the plugin listened for its first listener', async () => {
    const link = connection()
    const shell = new TokensAnywhereShell(link as never)
    link.events.emit('message', { type: 'anywhere-login-requested' })
    const first = vi.fn()
    const stop = shell.onLinkOpened(first)
    await Promise.resolve()
    expect(first).toHaveBeenCalledOnce()
    const second = vi.fn()
    shell.onLinkOpened(second)
    await Promise.resolve()
    expect(second).not.toHaveBeenCalled()
    stop()
    link.events.emit('message', { type: 'anywhere-login-requested' })
    expect(first).toHaveBeenCalledOnce()
    expect(second).toHaveBeenCalledOnce()
    shell.dispose()
  })
})
