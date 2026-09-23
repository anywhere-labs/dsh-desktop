import { describe, expect, it } from 'vitest'
import {
  buildDesktopProxyOverlay,
  desktopProxyEnvLookup,
  parsePacProxyResult,
  socksProxyDiagnostic,
  type DesktopProxyEnvLookup,
} from '../src/system-proxy.ts'

function env(values: Record<string, string>): DesktopProxyEnvLookup {
  return { get: name => (values[name] === undefined ? undefined : { value: values[name] }) }
}

describe('PAC proxy result parsing', () => {
  it('reads a direct answer', () => {
    expect(parsePacProxyResult('DIRECT')).toEqual({ kind: 'direct' })
  })

  it('reads an HTTP proxy answer', () => {
    expect(parsePacProxyResult('PROXY 127.0.0.1:7890')).toEqual({ kind: 'proxy', url: 'http://127.0.0.1:7890' })
  })

  it('reads an HTTPS proxy answer as an https URL', () => {
    expect(parsePacProxyResult('HTTPS proxy.corp:443')).toEqual({ kind: 'proxy', url: 'https://proxy.corp:443' })
  })

  it('keeps an IPv6 literal bracketed', () => {
    expect(parsePacProxyResult('PROXY [::1]:8080')).toEqual({ kind: 'proxy', url: 'http://[::1]:8080' })
  })

  it('skips a SOCKS candidate to reach the routable one behind it', () => {
    expect(parsePacProxyResult('SOCKS5 127.0.0.1:7891;PROXY 127.0.0.1:7890'))
      .toEqual({ kind: 'proxy', url: 'http://127.0.0.1:7890' })
  })

  it('reports a SOCKS-only answer rather than inventing a proxy', () => {
    const result = parsePacProxyResult('SOCKS5 127.0.0.1:7891')

    expect(result.kind).toBe('unsupported')
    expect(result).toMatchObject({ detail: expect.stringContaining('SOCKS5') })
  })

  it('reports a QUIC-only answer as unusable', () => {
    expect(parsePacProxyResult('QUIC edge.corp:443').kind).toBe('unsupported')
  })

  it('takes DIRECT when it is offered before a proxy', () => {
    expect(parsePacProxyResult('DIRECT;PROXY 127.0.0.1:7890')).toEqual({ kind: 'direct' })
  })

  it('treats an empty answer as direct', () => {
    expect(parsePacProxyResult('')).toEqual({ kind: 'direct' })
    expect(parsePacProxyResult('   ;  ')).toEqual({ kind: 'direct' })
  })

  it('refuses an entry carrying a path or credentials', () => {
    expect(parsePacProxyResult('PROXY 127.0.0.1:7890/evil').kind).toBe('unsupported')
    expect(parsePacProxyResult('PROXY user:pass@127.0.0.1:7890').kind).toBe('unsupported')
  })

  it('refuses an authority without a port', () => {
    expect(parsePacProxyResult('PROXY proxy.corp').kind).toBe('unsupported')
  })

  it('reports an unrecognized entry instead of guessing', () => {
    expect(parsePacProxyResult('BANANA 127.0.0.1:7890').kind).toBe('unsupported')
  })
})

describe('Desktop proxy overlay', () => {
  it('prefers an exported proxy over the system configuration', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({ HTTPS_PROXY: 'http://corp:8080' }),
      probe: { http: 'http://127.0.0.1:7890', https: 'http://127.0.0.1:7890' },
    })

    expect(resolution.source).toBe('environment')
    expect(resolution.overlay).toEqual({})
    expect(resolution.summary).toContain('source: environment HTTPS_PROXY')
  })

  it('ignores an exported proxy name that is present but empty', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({ HTTPS_PROXY: '   ' }),
      probe: { https: 'http://127.0.0.1:7890' },
    })

    expect(resolution.source).toBe('system')
  })

  it('defers to ALL_PROXY as an explicit choice', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({ ALL_PROXY: 'socks5://127.0.0.1:7891' }),
      probe: { https: 'http://127.0.0.1:7890' },
    })

    expect(resolution.source).toBe('environment')
    expect(resolution.overlay).toEqual({})
  })

  it('synthesizes the system proxy with a bypass list covering this machine', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({}),
      probe: { http: 'http://127.0.0.1:7890', https: 'http://127.0.0.1:7890' },
      lanAddresses: ['192.168.1.7'],
    })

    expect(resolution.source).toBe('system')
    expect(resolution.overlay).toEqual({
      http_proxy: 'http://127.0.0.1:7890',
      https_proxy: 'http://127.0.0.1:7890',
      no_proxy: '192.168.1.7,.local',
    })
  })

  it('keeps the bypass entries the user already wrote', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({ NO_PROXY: 'internal.corp, .example.com' }),
      probe: { https: 'http://127.0.0.1:7890' },
      lanAddresses: ['192.168.1.7'],
    })

    expect(resolution.overlay.no_proxy).toBe('internal.corp,.example.com,192.168.1.7,.local')
  })

  it('carries only the scheme the resolver answered for', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({}),
      probe: { https: 'http://127.0.0.1:7890' },
    })

    expect(resolution.overlay.https_proxy).toBe('http://127.0.0.1:7890')
    expect(resolution.overlay.http_proxy).toBeUndefined()
  })

  it('reports a direct machine without a proxy', () => {
    const resolution = buildDesktopProxyOverlay({ env: env({}), probe: {} })

    expect(resolution.source).toBe('none')
    expect(resolution.overlay).toEqual({})
    expect(resolution.summary).toContain('outbound proxy = none')
  })

  it('keeps probe notes and warns when PAC rules route probes differently', () => {
    const resolution = buildDesktopProxyOverlay({
      env: env({}),
      probe: { https: 'http://127.0.0.1:7890', disagreed: true, notes: ['a probe note'] },
    })

    expect(resolution.diagnostics[0]).toBe('a probe note')
    expect(resolution.diagnostics.join(' ')).toContain('PAC')
  })

  it('reports a SOCKS-only machine as direct while keeping the explanation', () => {
    const note = socksProxyDiagnostic('https://api.deepseek.com/', 'SOCKS5 (127.0.0.1:7891)')
    const resolution = buildDesktopProxyOverlay({ env: env({}), probe: { notes: [note] } })

    expect(resolution.source).toBe('none')
    expect(resolution.diagnostics).toEqual([note])
    expect(note).toContain('mixed port')
  })
})

describe('Desktop proxy environment lookup', () => {
  it('lets the synthesized overlay win over the snapshot', () => {
    const lookup = desktopProxyEnvLookup(env({ no_proxy: 'stale' }), { no_proxy: 'merged,.local' })

    expect(lookup.get('no_proxy')).toEqual({ value: 'merged,.local' })
  })

  it('answers the uppercase spelling from the lowercase overlay', () => {
    const lookup = desktopProxyEnvLookup(env({}), { https_proxy: 'http://127.0.0.1:7890' })

    expect(lookup.get('HTTPS_PROXY')).toEqual({ value: 'http://127.0.0.1:7890' })
  })

  it('falls back to the snapshot for everything else', () => {
    const lookup = desktopProxyEnvLookup(env({ DSH_HOME: '/home/dsh' }), { no_proxy: '.local' })

    expect(lookup.get('DSH_HOME')).toEqual({ value: '/home/dsh' })
    expect(lookup.get('HTTP_PROXY')).toBeUndefined()
  })

  it('passes the environment through untouched when no overlay was synthesized', () => {
    const lookup = desktopProxyEnvLookup(env({ HTTPS_PROXY: 'http://corp:8080' }), {})

    expect(lookup.get('HTTPS_PROXY')).toEqual({ value: 'http://corp:8080' })
  })
})
