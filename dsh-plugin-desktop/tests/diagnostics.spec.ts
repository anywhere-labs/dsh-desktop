import { mkdtempSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { readPluginInventory } from '@deepseek-ai/dsh-host-plugin-inventory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { configureDeveloperLogging, developerLoggingEnabled, initializeDeveloperLogging } from '../src/developer-logging.ts'
import { apply, inject, name } from '../src/diagnostics.ts'
import { FileExporter } from '../src/file-exporter.ts'
import { LogFileSink } from '../src/log-files.ts'
import { isErrorType, shouldEmit } from '../src/log-level.ts'
import { maskSecrets } from '../src/mask-secrets.ts'
import { recordOfficialInspector, recordOfficialPluginInventory } from '../src/official-diagnostics.ts'
import type { DesktopRuntime, DesktopTrayItem } from '../src/runtime.ts'
import { DesktopSettingsSchema, DesktopShellConfig, observeDesktopPreferenceSettings } from '../src/settings-bridge.ts'

vi.mock('@deepseek-ai/dsh-host-plugin-inventory', () => ({ readPluginInventory: vi.fn() }))

beforeEach(() => vi.resetAllMocks())

afterEach(() => {
  configureDeveloperLogging({ developerLogging: false, logLevel: 'info' })
  initializeDeveloperLogging(() => {})
})

describe('desktop diagnostics Host plugin', () => {
  it('owns an effect-scoped tray command that exports diagnostics', async () => {
    let trayItem: DesktopTrayItem | undefined
    let disposeEffect: (() => void) | undefined
    const exportDiagnostics = vi.fn(async () => {})
    const disposeRegistration = vi.fn()
    const runtime = {
      locale: 'en',
      exportDiagnostics,
      registerTrayItem: (item: DesktopTrayItem) => {
        trayItem = item
        return { refresh: () => {}, dispose: disposeRegistration }
      },
    } as unknown as DesktopRuntime
    const ctx = {
      desktopRuntime: runtime,
      effect: (register: () => (() => void)) => {
        disposeEffect = register()
        return disposeEffect
      },
    } as unknown as Context

    apply(ctx)

    expect(name).toBe('desktop-diagnostics')
    expect(inject).toEqual(['desktopRuntime'])
    expect(trayItem).toMatchObject({ group: 'tools', order: 20 })
    expect(trayItem?.label()).toBe('Export Diagnostics…')
    await trayItem?.invoke()
    expect(exportDiagnostics).toHaveBeenCalledOnce()

    disposeEffect?.()
    expect(disposeRegistration).toHaveBeenCalledOnce()
  })

  it('uses the active desktop locale for its tray label', () => {
    let trayItem: DesktopTrayItem | undefined
    const runtime = {
      locale: 'zh',
      exportDiagnostics: vi.fn(async () => {}),
      registerTrayItem: (item: DesktopTrayItem) => {
        trayItem = item
        return { refresh: () => {}, dispose: () => {} }
      },
    } as unknown as DesktopRuntime
    const ctx = {
      desktopRuntime: runtime,
      effect: (register: () => (() => void)) => register(),
    } as unknown as Context

    apply(ctx)

    expect(trayItem?.label()).toBe('导出诊断信息…')
  })
})

describe('shouldEmit', () => {
  it('emits nothing above the threshold', () => {
    expect(shouldEmit('debug', 'info')).toBe(false)
    expect(shouldEmit('info', 'info')).toBe(true)
    expect(shouldEmit('warn', 'info')).toBe(true)
    expect(shouldEmit('error', 'info')).toBe(true)
  })

  it('emits only errors at the error threshold', () => {
    expect(shouldEmit('error', 'error')).toBe(true)
    expect(shouldEmit('warn', 'error')).toBe(false)
    expect(shouldEmit('info', 'error')).toBe(false)
    expect(shouldEmit('debug', 'error')).toBe(false)
  })

  it('emits everything at the debug threshold', () => {
    expect(shouldEmit('debug', 'debug')).toBe(true)
    expect(shouldEmit('info', 'debug')).toBe(true)
    expect(shouldEmit('warn', 'debug')).toBe(true)
    expect(shouldEmit('error', 'debug')).toBe(true)
  })
})

describe('isErrorType', () => {
  it('treats warn and error as the error log', () => {
    expect(isErrorType('warn')).toBe(true)
    expect(isErrorType('error')).toBe(true)
    expect(isErrorType('info')).toBe(false)
    expect(isErrorType('debug')).toBe(false)
  })
})

describe('developer logging settings', () => {
  it('defaults existing profiles to disabled and publishes a volatile setting', () => {
    expect(DesktopSettingsSchema({} as never)).toMatchObject({ developerLogging: false, logLevel: 'info' })
    expect(DesktopShellConfig({}).developerLogging.get()).toBe(false)
    expect(DesktopShellConfig({ developerLogging: true }).developerLogging.get()).toBe(true)
  })

  it('applies tracing and kernel thresholds live and forwards them to Electron even without notification settings', () => {
    let desktop = { developerLogging: false, logLevel: 'info' }
    let changed: ((namespace: string) => void) | undefined
    const native = vi.fn()
    const threshold = vi.fn()
    const write = vi.fn(async () => {})
    const ctx = {
      get(key: string) {
        if (key === 'settings') return { describe: () => [{ ns: 'desktop-shell', value: desktop }] }
        if (key === 'desktopRuntime') return { configureDeveloperLogging: native }
        return undefined
      },
      loader: { entries: () => [] },
      on(_event: string, callback: typeof changed) { changed = callback },
    } as unknown as Context
    observeDesktopPreferenceSettings(ctx, { setThreshold: threshold }, write)
    expect(developerLoggingEnabled()).toBe(false)
    desktop = { developerLogging: true, logLevel: 'debug' }
    changed?.('desktop-shell')
    expect(developerLoggingEnabled()).toBe(true)
    expect(native).toHaveBeenLastCalledWith(desktop)
    expect(threshold).toHaveBeenLastCalledWith('debug')
    expect(write).not.toHaveBeenCalled()
    desktop = { developerLogging: false, logLevel: 'error' }
    changed?.('desktop-shell')
    expect(developerLoggingEnabled()).toBe(false)
  })
})

describe('maskSecrets', () => {
  it('masks API key values', () => {
    const masked = maskSecrets('key is sk-1234abcd5678')
    expect(masked).toContain('sk-****')
    expect(masked).not.toContain('sk-1234abcd')
  })

  it('masks bearer tokens in headers', () => {
    const masked = maskSecrets('Authorization: Bearer abc.def.ghi')
    expect(masked).toContain('Bearer ****')
    expect(masked).not.toContain('abc.def.ghi')
  })

  it('masks basic authorization credentials', () => {
    const masked = maskSecrets('Authorization: Basic dXNlcjpwYXNzd29yZA==')
    expect(masked).toBe('Authorization: Basic ****')
    expect(masked).not.toContain('dXNlcjpwYXNzd29yZA==')
  })

  it('masks cookie header values', () => {
    const masked = maskSecrets('Cookie: session=short-secret; theme=dark')
    expect(masked).toBe('Cookie: ****')
    expect(masked).not.toContain('short-secret')
  })

  it('masks URL userinfo and sensitive query values', () => {
    const masked = maskSecrets('GET https://user:pass@example.com/api?token=short&mode=fast')
    expect(masked).toBe('GET https://****:****@example.com/api?token=****&mode=fast')
    expect(masked).not.toContain('user:pass')
    expect(masked).not.toContain('token=short')
  })

  it('masks named secret fields even when their values are short', () => {
    const masked = maskSecrets('api_key=short password: hunter2 mode=fast')
    expect(masked).toBe('api_key=**** password: **** mode=fast')
    expect(masked).not.toContain('hunter2')
  })

  it('masks quoted secret fields in rendered JSON', () => {
    const masked = maskSecrets(JSON.stringify({
      api_key: 'short-secret',
      code: 'short-code',
      nested: {
        access_token: 'access123',
        authorization: 'custom-auth',
        password: 'hunter2',
        token: 'abc123',
        'x-api-key': 'short-key',
      },
      mode: 'fast',
    }))

    expect(masked).toBe('{"api_key":"****","code":"****","nested":{"access_token":"****","authorization":"****","password":"****","token":"****","x-api-key":"****"},"mode":"fast"}')
    expect(masked).not.toContain('short-secret')
    expect(masked).not.toContain('short-code')
    expect(masked).not.toContain('access123')
    expect(masked).not.toContain('custom-auth')
    expect(masked).not.toContain('short-key')
    expect(masked).not.toContain('hunter2')
    expect(masked).not.toContain('abc123')
  })

  it('leaves ordinary prose untouched', () => {
    expect(maskSecrets('hello world, profile "desktop"')).toBe('hello world, profile "desktop"')
  })
})

describe('official diagnostics snapshots', () => {
  function environment(inspector?: object) {
    const record = vi.fn()
    const ctx = {
      fiber: { state: 2 },
      get: (key: string) => key === 'inspector' ? inspector : key === 'loader' ? {} : undefined,
      loader: { entries: () => { throw new Error('Desktop must not reconstruct official inventory') } },
    } as unknown as Context
    return { ctx, record }
  }

  it('uses the official inventory projection for effective enablement and named lifecycle phases', async () => {
    const { ctx, record } = environment()
    vi.mocked(readPluginInventory).mockResolvedValue({ entries: [{ entryId: 'plugin-a', moduleName: 'example', enabled: false, fiberPhase: 'active' }] } as never)
    await recordOfficialPluginInventory(ctx, record)
    expect(readPluginInventory).toHaveBeenCalledExactlyOnceWith(ctx)
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event: 'plugin.snapshot', fields: {
      api: 'readPluginInventory', pluginId: 'plugin-a', module: 'example', enabled: false, fiberPhase: 'active',
    } }))
  })

  it('reads public Inspector topology metadata without starting capture or exporting content', async () => {
    const getTree = vi.fn(async () => ({ schemaVersion: 0, host: {
      source: { sourceId: 'host-a', kind: 'host' }, connection: { state: 'connected' }, revision: 4, truncated: true,
      root: { privateData: 'not exported' },
    }, clients: [] }))
    const publish = vi.fn()
    const { ctx, record } = environment({ cordis: { getTree }, publish })
    await recordOfficialInspector(ctx, record)
    expect(getTree).toHaveBeenCalledOnce()
    expect(publish).not.toHaveBeenCalled()
    expect(record.mock.calls[0]?.[0]).toMatchObject({ event: 'inspector.snapshot', fields: {
      api: 'ctx.inspector.cordis.getTree', schemaVersion: 0, hostPresent: true, clientCount: 0,
    } })
    expect(record.mock.calls[1]?.[0]).toMatchObject({ event: 'realm.snapshot', fields: {
      sourceId: 'host-a', kind: 'host', revision: 4, connection: 'connected', truncated: true,
    } })
    expect(JSON.stringify(record.mock.calls)).not.toContain('not exported')
  })

  it('reports an unavailable optional Inspector without falling back to private internals', async () => {
    const { ctx, record } = environment()
    await recordOfficialInspector(ctx, record)
    expect(record).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ event: 'inspector.unavailable' }))
    expect(readPluginInventory).not.toHaveBeenCalled()
  })

  it('isolates official query failures and suppresses late snapshots after disposal', async () => {
    const failure = new Error('official query timed out')
    const getTree = vi.fn(async (): Promise<unknown> => { throw failure })
    const { ctx, record } = environment({ cordis: { getTree } })
    await expect(recordOfficialInspector(ctx, record)).resolves.toBeUndefined()
    expect(record).toHaveBeenCalledWith(expect.objectContaining({ event: 'inspector.query-failed', error: failure }))
    record.mockClear()
    const later = Promise.withResolvers<unknown>()
    getTree.mockImplementation(() => later.promise)
    const query = recordOfficialInspector(ctx, record)
    ;(ctx.fiber as unknown as { state: number }).state = 4
    later.resolve({ schemaVersion: 0, host: null, clients: [] })
    await query
    expect(record).not.toHaveBeenCalled()
  })
})

describe('FileExporter', () => {
  function todaySuffix(): string {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  function exporter(threshold: 'debug' | 'info' | 'warn' | 'error' = 'info'): { e: FileExporter; dir: string } {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-log-'))
    const sink = new LogFileSink(dir, { maxFileBytes: 10 * 1024 * 1024, maxDirectoryBytes: 200 * 1024 * 1024 })
    return { e: new FileExporter(sink, threshold), dir }
  }

  it('renders and writes a message with a level and name prefix', () => {
    const { e, dir } = exporter('info')
    e.export({ sn: 0, ts: Date.now(), name: 'test', type: 'info', level: 1, args: ['hello'] })
    e.close()
    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text).toContain('[I] [test] hello')
  })

  it('drops debug messages at the info threshold', () => {
    const { e, dir } = exporter('info')
    e.export({ sn: 0, ts: Date.now(), name: 'test', type: 'debug', level: 3, args: ['hidden'] })
    e.close()
    expect(readdirSync(dir)).toEqual([])
  })
})
