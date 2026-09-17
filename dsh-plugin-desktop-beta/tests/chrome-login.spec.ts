import { EventEmitter } from 'node:events'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_CHROME_CANCELLED,
  BROWSER_CHROME_CLOSED,
  BROWSER_CHROME_LOGIN_TIMEOUT,
  BROWSER_CHROME_NOT_FOUND,
  googleSignedIn,
  isGoogleCookieHost,
  needsGoogleAccount,
  resolveChromeExecutable,
  isGoogleSignInUrl,
  runChromeGoogleLogin,
  toElectronCookie,
  toElectronCookies,
  type ChromeCdpCookie,
  type ChromeCdpSocket,
} from '../src/chrome-login.ts'

function cookie(partial: Partial<ChromeCdpCookie> & Pick<ChromeCdpCookie, 'name' | 'value' | 'domain'>): ChromeCdpCookie {
  return partial
}

describe('Google cookie recognition', () => {
  it('accepts Google account hosts and rejects unrelated ones', () => {
    expect(isGoogleCookieHost('.google.com')).toBe(true)
    expect(isGoogleCookieHost('accounts.google.com')).toBe(true)
    expect(isGoogleCookieHost('gemini.google.com')).toBe(true)
    expect(isGoogleCookieHost('youtube.com')).toBe(true)
    expect(isGoogleCookieHost('example.com')).toBe(false)
    expect(isGoogleCookieHost('notgoogle.com')).toBe(false)
  })

  it('recognizes the pages that need a Google account', () => {
    expect(needsGoogleAccount('https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn')).toBe(true)
    expect(needsGoogleAccount('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp')).toBe(true)
    expect(needsGoogleAccount('https://accounts.google.com/v3/signin/accountchooser?elo=1')).toBe(true)
    expect(needsGoogleAccount('https://gemini.google.com/app')).toBe(true)
    expect(needsGoogleAccount('https://gemini.google.com/signin?continue=https%3A%2F%2Fgemini.google.com%2Fapp')).toBe(true)
    expect(needsGoogleAccount('https://accounts.google.com/Logout')).toBe(false)
    expect(needsGoogleAccount('https://example.com/accounts.google.com')).toBe(false)
    expect(needsGoogleAccount('not a url')).toBe(false)
  })

  it('treats a SID on a Google host as a signed-in session', () => {
    expect(googleSignedIn([
      { name: 'NID', domain: '.google.com' },
      { name: '__Secure-1PSID', domain: '.google.com' },
    ])).toBe(true)
    expect(googleSignedIn([{ name: 'SID', domain: 'example.com' }])).toBe(false)
    expect(googleSignedIn([{ name: 'NID', domain: '.google.com' }])).toBe(false)
  })
})

describe('Chrome to Electron cookie conversion', () => {
  it('rebuilds the URL Electron needs and drops partitioned or unrelated cookies', () => {
    expect(toElectronCookie(cookie({
      name: 'SID',
      value: 'session',
      domain: '.google.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'None',
      expires: 1_800_000_000,
    }))).toEqual({
      url: 'https://google.com/',
      name: 'SID',
      value: 'session',
      domain: '.google.com',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'no_restriction',
      expirationDate: 1_800_000_000,
    })

    expect(toElectronCookie(cookie({
      name: 'SID',
      value: 'session',
      domain: '.google.com',
      session: true,
      expires: -1,
    }))).toMatchObject({ name: 'SID', url: 'http://google.com/' })
    expect(toElectronCookie(cookie({
      name: 'SID',
      value: 'session',
      domain: '.google.com',
    }))).not.toHaveProperty('expirationDate')

    expect(toElectronCookie(cookie({
      name: 'SID',
      value: 'session',
      domain: '.google.com',
      partitionKey: { topLevelSite: 'https://example.com' },
    }))).toBeUndefined()
    expect(toElectronCookie(cookie({
      name: 'other',
      value: '1',
      domain: 'example.com',
    }))).toBeUndefined()

    expect(toElectronCookies([
      cookie({ name: 'SID', value: 'a', domain: '.google.com', secure: true }),
      cookie({ name: 'theme', value: 'dark', domain: 'example.com' }),
    ])).toHaveLength(1)
  })
})

describe('Chrome executable lookup', () => {
  it('imports a __Host- cookie without the Domain attribute Chromium rejects', () => {
    expect(toElectronCookie(cookie({
      name: '__Host-GAPS',
      value: 'gaia',
      domain: 'accounts.google.com',
      path: '/',
      secure: true,
      httpOnly: true,
    }))).toEqual({
      url: 'https://accounts.google.com/',
      name: '__Host-GAPS',
      value: 'gaia',
      path: '/',
      secure: true,
      httpOnly: true,
      sameSite: 'unspecified',
    })
  })

  it('tells Google\'s sign-in form apart from the pages a session reaches after it', () => {
    expect(isGoogleSignInUrl('https://accounts.google.com/v3/signin/identifier?flowName=GlifWebSignIn')).toBe(true)
    expect(isGoogleSignInUrl('https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp')).toBe(true)
    expect(isGoogleSignInUrl('https://gemini.google.com/app')).toBe(false)
    expect(isGoogleSignInUrl('https://myaccount.google.com/')).toBe(false)
    expect(isGoogleSignInUrl('not a url')).toBe(false)
  })

  it('prefers an explicit path and then the platform install locations', () => {
    expect(resolveChromeExecutable({
      platform: 'darwin',
      env: { DSH_CHROME_PATH: '/opt/chrome' },
      homedir: '/Users/me',
      exists: path => path === '/opt/chrome',
    })).toBe('/opt/chrome')

    expect(resolveChromeExecutable({
      platform: 'darwin',
      env: {},
      homedir: '/Users/me',
      exists: path => path === '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    })).toBe('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome')

    expect(resolveChromeExecutable({
      platform: 'linux',
      env: { PATH: '/usr/local/bin' },
      homedir: '/home/me',
      exists: path => path === '/usr/local/bin/google-chrome',
    })).toBe('/usr/local/bin/google-chrome')

    expect(resolveChromeExecutable({
      platform: 'win32',
      env: { PROGRAMFILES: 'C:\\Program Files' },
      homedir: 'C:\\Users\\me',
      exists: () => false,
    })).toBeUndefined()
  })
})

describe('Chrome Google login runner', () => {
  it('launches Chrome, waits for a Google session, and returns its cookies', async () => {
    const child = new EventEmitter() as EventEmitter & { kill: () => void }
    child.kill = () => { child.emit('exit', 0) }
    const phases: string[] = []
    let socket: (ChromeCdpSocket & { methods: string[] }) | undefined
    const cookies = await runChromeGoogleLogin({
      executable: '/chrome',
      profileDir: '/tmp/profile',
      timeoutMs: 5_000,
      signal: new AbortController().signal,
      spawn: (command, args) => {
        expect(command).toBe('/chrome')
        expect(args).toEqual(expect.arrayContaining([
          '--remote-debugging-port=9334',
          '--user-data-dir=/tmp/profile',
          'https://accounts.google.com/ServiceLogin?continue=https%3A%2F%2Fgemini.google.com%2Fapp',
        ]))
        return child as never
      },
      fetch: async url => {
        expect(url).toBe('http://127.0.0.1:9334/json/version')
        return {
          ok: true,
          json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:9334/devtools/browser' }),
        }
      },
      openSocket: url => {
        expect(url).toBe('ws://127.0.0.1:9334/devtools/browser')
        socket = scriptedSocket({
          'Storage.getCookies': [
            { cookies: [{ name: 'NID', value: '1', domain: '.google.com' }] },
            { cookies: [{ name: '__Secure-1PSID', value: 'session', domain: '.google.com', secure: true }] },
          ],
          'Target.getTargets': [SIGNED_IN_PAGES],
        })
        return socket
      },
      freePort: async () => 9334,
      sleep: async () => {},
      now: sequentialNow([0, 0, 1, 2, 3]),
      onPhase: phase => { phases.push(phase) },
    })
    expect(phases).toEqual(['launching', 'waiting'])
    // The browser endpoint answers `Storage.getCookies`; the legacy Network
    // command is gone from it, so it must never be the first choice.
    expect(socket?.methods[0]).toBe('Storage.getCookies')
    expect(cookies).toEqual([
      { name: '__Secure-1PSID', value: 'session', domain: '.google.com', secure: true },
    ])
  })

  it('keeps waiting while Chrome is still on the sign-in form', async () => {
    const cookies = await runChromeGoogleLogin(runner({
      timeoutMs: 5_000,
      now: sequentialNow([0, 0, 1, 2, 3, 4]),
      openSocket: () => scriptedSocket({
        'Storage.getCookies': [
          { cookies: [{ name: 'SID', value: 'stale', domain: '.google.com' }] },
          { cookies: [{ name: 'SID', value: 'fresh', domain: '.google.com' }] },
        ],
        'Target.getTargets': [
          { targetInfos: [{ type: 'page', url: 'https://accounts.google.com/v3/signin/identifier' }] },
          SIGNED_IN_PAGES,
        ],
      }),
    }))
    expect(cookies).toEqual([{ name: 'SID', value: 'fresh', domain: '.google.com' }])
  })

  it('falls back to the legacy cookie command on a Chrome build without the modern one', async () => {
    let socket: (ChromeCdpSocket & { methods: string[] }) | undefined
    const cookies = await runChromeGoogleLogin(runner({
      timeoutMs: 5_000,
      now: sequentialNow([0, 0, 1, 2, 3]),
      openSocket: () => {
        socket = scriptedSocket(
          {
            'Network.getAllCookies': [{ cookies: [{ name: 'SID', value: 'session', domain: '.google.com' }] }],
            'Target.getTargets': [SIGNED_IN_PAGES],
          },
          { 'Storage.getCookies': "'Storage.getCookies' wasn't found" },
        )
        return socket
      },
    }))
    expect(socket?.methods).toEqual(['Storage.getCookies', 'Network.getAllCookies', 'Target.getTargets'])
    expect(cookies).toEqual([{ name: 'SID', value: 'session', domain: '.google.com' }])
  })

  it('reports cancellation, a closed window, and a timeout with stable codes', async () => {
    const cancelled = new AbortController()
    cancelled.abort()
    await expect(runChromeGoogleLogin(runner({
      signal: cancelled.signal,
      fetch: async () => ({ ok: false, json: async () => ({}) }),
    }))).rejects.toThrow(BROWSER_CHROME_CANCELLED)

    const child = new EventEmitter() as EventEmitter & { kill: () => void }
    child.kill = () => {}
    const closed = runChromeGoogleLogin(runner({
      spawn: () => {
        queueMicrotask(() => { child.emit('exit', 0) })
        return child as never
      },
      fetch: async () => ({ ok: false, json: async () => ({}) }),
      sleep: async () => {},
    }))
    await expect(closed).rejects.toThrow(BROWSER_CHROME_CLOSED)

    await expect(runChromeGoogleLogin(runner({
      timeoutMs: 1,
      now: sequentialNow([0, 2]),
      fetch: async () => ({ ok: false, json: async () => ({}) }),
    }))).rejects.toThrow('BROWSER_CHROME_UNAVAILABLE')

    await expect(runChromeGoogleLogin(runner({
      timeoutMs: 1,
      now: sequentialNow([0, 0, 2]),
      openSocket: () => scriptedSocket({ 'Storage.getCookies': [{ cookies: [{ name: 'NID', value: '1', domain: '.google.com' }] }] }),
    }))).rejects.toThrow(BROWSER_CHROME_LOGIN_TIMEOUT)

    expect(BROWSER_CHROME_NOT_FOUND).toBe('BROWSER_CHROME_NOT_FOUND')
  })
})

function sequentialNow(values: readonly number[]): () => number {
  let index = 0
  return () => values[Math.min(index++, values.length - 1)] ?? values.at(-1)!
}

/** The pages Chrome serves once the account is really there. */
const SIGNED_IN_PAGES = { targetInfos: [{ type: 'page', url: 'https://gemini.google.com/app' }] }

/** A debugging socket that answers each protocol method from its own script. */
function scriptedSocket(
  answers: Record<string, readonly unknown[]> = {},
  errors: Record<string, string> = {},
): ChromeCdpSocket & { methods: string[] } {
  const listeners = new Set<(data: string) => void>()
  const methods: string[] = []
  const served = new Map<string, number>()
  return {
    ready: Promise.resolve(),
    methods,
    send(data) {
      const message = JSON.parse(data) as { id: number; method: string }
      methods.push(message.method)
      const failure = errors[message.method]
      const script = answers[message.method] ?? []
      const index = served.get(message.method) ?? 0
      served.set(message.method, index + 1)
      const result = script.length === 0 ? {} : script[Math.min(index, script.length - 1)]
      queueMicrotask(() => {
        const answer = failure === undefined
          ? { id: message.id, result }
          : { id: message.id, error: { message: failure } }
        for (const listener of [...listeners]) listener(JSON.stringify(answer))
      })
    },
    onMessage(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    close() {},
  }
}

function runner(overrides: Partial<Parameters<typeof runChromeGoogleLogin>[0]>): Parameters<typeof runChromeGoogleLogin>[0] {
  const child = new EventEmitter() as EventEmitter & { kill: () => void }
  child.kill = () => { child.emit('exit', 0) }
  return {
    executable: '/chrome',
    profileDir: '/tmp/profile',
    timeoutMs: 5_000,
    signal: new AbortController().signal,
    spawn: () => child as never,
    fetch: async () => ({
      ok: true,
      json: async () => ({ webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser' }),
    }),
    openSocket: () => scriptedSocket({ 'Storage.getCookies': [{ cookies: [] }] }),
    freePort: async () => 1,
    sleep: async () => {},
    now: () => 0,
    onPhase: () => {},
    ...overrides,
  }
}
