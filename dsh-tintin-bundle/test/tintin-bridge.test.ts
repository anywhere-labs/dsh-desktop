// Unit tests for the WP-1 pure-logic ports (machine-id, server-proxy).
import { describe, expect, it } from 'vitest'
import { deriveMachineId, MACHINE_ID_KEY, resolveMachineIdSync } from '../lib/machine-id.js'
import {
  createServerUrlResolver,
  createFixOutputUrl,
  makeFixGenUrls,
  resolveEndpoint,
  API_ENDPOINTS,
} from '../lib/server-proxy.js'

describe('tintin machine-id', () => {
  it('derives a stable 16-hex id from mac+host+cpu', () => {
    const info = { mac: 'AA:BB:CC:DD:EE:FF', hostname: 'DESKTOP-1', cpu: 'Intel64' }
    const a = deriveMachineId(info)
    expect(a).toMatch(/^[0-9a-f]{16}$/)
    expect(deriveMachineId(info)).toBe(a) // pure & deterministic
  })

  it('returns empty string with no usable seed (never fabricates)', () => {
    expect(deriveMachineId({})).toBe('')
    expect(deriveMachineId(null)).toBe('')
  })

  it('normalizes mac to 12 lowercase hex, keeps host/cpu case', () => {
    const a = deriveMachineId({ mac: 'aa-bb-cc-dd-ee-ff', hostname: 'Host', cpu: 'X' })
    const b = deriveMachineId({ mac: 'AA:BB:CC:DD:EE:FF', hostname: 'Host', cpu: 'X' })
    expect(a).toBe(b)
  })

  it('resolveMachineIdSync is cache-first and writes back once', () => {
    const store = { v: undefined as string | undefined, get() { return this.v }, set(_k: string, x: string) { this.v = x } }
    const collect = () => ({ mac: 'aa:bb:cc:dd:ee:ff', hostname: 'H', cpu: 'C' })
    const first = resolveMachineIdSync({ store, collect })
    expect(first).toMatch(/^[0-9a-f]{16}$/)
    expect(store.v).toBe(first)
    // Second call must reuse the cached value, not re-derive.
    const second = resolveMachineIdSync({ store, collect: () => ({ mac: '00:00:00:00:00:01', hostname: 'X', cpu: 'Y' }) })
    expect(second).toBe(first)
  })
})

describe('tintin server-proxy', () => {
  it('resolves server.url first, then the TinTin store, then ai_config, then the default', () => {
    const withConfig = createServerUrlResolver({ readConfig: () => 'http://192.168.111.31:8000/' })
    expect(withConfig()).toBe('http://192.168.111.31:8000') // trailing slash stripped

    // 0.1.7 起第二档:TinTin 自有存储(设置服务拒写 overlay 条目的替代持久层)
    const withStore = createServerUrlResolver({
      readConfig: () => null,
      readTintinStore: () => ({ server: { url: 'http://192.168.111.31:8000' } }),
      readAiConfig: () => ({ server_url: 'http://10.0.0.2:9000' }),
    })
    expect(withStore()).toBe('http://192.168.111.31:8000')

    // 显式 profile config 仍优先于存储档
    const configWins = createServerUrlResolver({
      readConfig: () => 'http://10.0.0.5:5000',
      readTintinStore: () => ({ server: { url: 'http://192.168.111.31:8000' } }),
    })
    expect(configWins()).toBe('http://10.0.0.5:5000')

    const withAi = createServerUrlResolver({ readConfig: () => null, readAiConfig: () => ({ server_url: 'http://10.0.0.2:9000' }) })
    expect(withAi()).toBe('http://10.0.0.2:9000')

    const fallback = createServerUrlResolver({ readConfig: () => null, readAiConfig: () => null })
    expect(fallback()).toBe('http://192.168.111.31:8000') // 定制版默认=部署服务器（2026-10-12 裁决）
  })

  it('rewrites /output/ urls onto the current server only when host differs', () => {
    const fix = createFixOutputUrl(() => 'http://192.168.111.31:8000')
    expect(fix('http://old-server:8000/output/a.mp4')).toBe('http://192.168.111.31:8000/output/a.mp4')
    expect(fix('http://192.168.111.31:8000/output/a.mp4')).toBe('http://192.168.111.31:8000/output/a.mp4')
    expect(fix('')).toBe('')
  })

  it('fixGenUrls rewrites url/audio_url/file_url only', () => {
    const fix = createFixOutputUrl(() => 'http://S')
    const fixGen = makeFixGenUrls(fix)
    const out = fixGen({ url: 'http://x/output/1.mp4', audio_url: 'http://x/output/2.mp3', other: 'http://x/output/3' })
    expect(out.url).toBe('http://S/output/1.mp4')
    expect(out.audio_url).toBe('http://S/output/2.mp3')
    expect(out.other).toBe('http://x/output/3')
  })

  it('resolveEndpoint handles string, function and query params', () => {
    expect(resolveEndpoint('/material/list')).toBe('/material/list')
    const webDownloadStatus = API_ENDPOINTS.material?.webDownloadStatus
    expect(webDownloadStatus).toBeTypeOf('function')
    expect(resolveEndpoint(webDownloadStatus as (...args: string[]) => string, { __args: ['abc'] })).toBe('/material/web_download/abc')
    expect(resolveEndpoint('/material/list', { page: 1, tag: ['a', 'b'] })).toBe('/material/list?page=1&tag=a&tag=b')
  })
})
