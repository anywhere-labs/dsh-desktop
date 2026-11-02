import { describe, expect, it } from 'vitest'
import { expireSurplusSessions, surplusSessionExpiries } from '../src/browser-sessions.ts'

const FIRST_PORT = 20_000
const HOST = '127.0.0.1'

function session(port: number, issuedAt: number, authority = `${HOST}:${String(port)}`): string {
  const payload = Buffer.from(JSON.stringify({ version: 1, authority, issuedAt, expiresAt: issuedAt + 1000 })).toString('base64url')
  return `dsh-auth-${String(port)}=v1.${payload}.signature`
}

/** Sessions of former Hosts, where a higher port was issued later. */
function sessions(count: number): string[] {
  return Array.from({ length: count }, (_, index) => session(FIRST_PORT + index, index + 1))
}

const expiry = (port: number) => `dsh-auth-${String(port)}=; Max-Age=0; Path=/`

describe('surplusSessionExpiries', () => {
  it('leaves a browser within the retained count alone', () => {
    expect(surplusSessionExpiries(sessions(16).join('; '), `${HOST}:1`)).toEqual([])
    expect(surplusSessionExpiries('', `${HOST}:1`)).toEqual([])
    expect(surplusSessionExpiries(undefined, `${HOST}:1`)).toEqual([])
    expect(surplusSessionExpiries(null, null)).toEqual([])
  })

  it('expires the oldest sessions past the retained count, in any cookie order', () => {
    const expiries = surplusSessionExpiries(sessions(19).reverse().join('; '), `${HOST}:1`)
    expect(expiries).toEqual([expiry(FIRST_PORT + 2), expiry(FIRST_PORT + 1), expiry(FIRST_PORT)])
  })

  it('keeps the session of the answering Host however old it is', () => {
    const expiries = surplusSessionExpiries(sessions(19).join('; '), `${HOST}:${String(FIRST_PORT)}`)
    expect(expiries).toEqual([expiry(FIRST_PORT + 2), expiry(FIRST_PORT + 1)])
  })

  it('recognizes the session of a Host answering over TLS', () => {
    const current = session(FIRST_PORT - 1, 0, `https://${HOST}:${String(FIRST_PORT - 1)}`)
    const expiries = surplusSessionExpiries([current, ...sessions(17)].join('; '), `${HOST}:${String(FIRST_PORT - 1)}`)
    expect(expiries).toEqual([expiry(FIRST_PORT)])
  })

  it('ignores other cookies and leaves sessions in an unknown format alone', () => {
    const cookies = [
      'other=1', 'dsh-auth-plain=value', 'dsh-auth-json=v1.bm90LWpzb24.signature', 'dsh-auth-null=v1.bnVsbA.signature',
      `dsh-auth-fields=v1.${Buffer.from('{"version":3}').toString('base64url')}.signature`, 'dsh-auth-bare', ...sessions(17),
    ]
    expect(surplusSessionExpiries(cookies.join('; '), `${HOST}:1`)).toEqual([expiry(FIRST_PORT)])
  })
})

describe('expireSurplusSessions', () => {
  it('returns the same response when nothing expires', () => {
    const response = new Response('body')
    expect(expireSurplusSessions(new Request('http://x/', { headers: { cookie: sessions(16).join('; '), host: `${HOST}:1` } }), response)).toBe(response)
  })

  it('adds the expiries to a response keeping its status, cookies and body', async () => {
    const response = new Response('body', { status: 203, statusText: 'Kept', headers: { 'set-cookie': 'minted=1; Path=/', 'content-type': 'text/plain' } })
    const result = expireSurplusSessions(new Request('http://x/', { headers: { cookie: sessions(17).join('; '), host: `${HOST}:1` } }), response)
    expect([result.status, result.statusText, result.headers.get('content-type')]).toEqual([203, 'Kept', 'text/plain'])
    expect(result.headers.getSetCookie()).toEqual(['minted=1; Path=/', expiry(FIRST_PORT)])
    expect(await result.text()).toBe('body')
  })

  it('copies a response whose headers are immutable', () => {
    const response = Response.redirect('http://x/next', 303)
    const result = expireSurplusSessions(new Request('http://x/', { headers: { cookie: sessions(17).join('; '), host: `${HOST}:1` } }), response)
    expect([result.status, result.headers.get('location'), result.headers.getSetCookie()]).toEqual([303, 'http://x/next', [expiry(FIRST_PORT)]])
  })
})
