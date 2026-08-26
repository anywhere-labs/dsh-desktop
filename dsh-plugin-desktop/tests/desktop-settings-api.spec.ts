import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import type { DesktopMarketSnapshot } from '../src/desktop-market.ts'
import DesktopSettingsController, {
  type DesktopSettingsControllerBootstrap,
} from '../src/desktop-settings-controller.ts'
import {
  handleDesktopDeveloperToolsToggleRequest,
  handleDesktopDiagnosticsExportRequest,
  handleDesktopMarketSelectRequest,
  handleDesktopProfileCreateRequest,
  handleDesktopProfileCreateWindowRequest,
  handleDesktopProfileDeleteRequest,
  handleDesktopProfileSelectRequest,
  handleDesktopRecoveryRestartRequest,
  handleDesktopRestartRequest,
  handleDesktopRendererReloadRequest,
  handleDesktopSettingsRequest,
  handleDesktopTerminalOpenRequest,
  handleDesktopUpdateCheckRequest,
  desktopSettingsRouteConstants,
} from '../src/desktop-settings-route.ts'
import type { DesktopProfileSummary } from '../src/profile-manager.ts'

const ORIGIN = 'http://127.0.0.1:43120'

const DESKTOP: DesktopProfileSummary = {
  name: 'desktop',
  dir: '/private/profiles/desktop',
  exists: true,
  bundles: ['@deepseek-ai/dsh-web-app'],
  webCapable: true,
}

const WORK: DesktopProfileSummary = {
  name: 'work',
  dir: '/private/profiles/work',
  exists: true,
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app'],
  webCapable: true,
}

const BROKEN: DesktopProfileSummary = {
  name: 'broken',
  dir: '/private/profiles/broken',
  exists: true,
  bundles: ['private-bundle'],
  webCapable: false,
  problem: 'failed to read /private/profiles/broken/package.json',
}

function market(
  requested: DesktopMarketSnapshot['requested'] = 'disabled',
  effective: DesktopMarketSnapshot['effective'] = requested,
  legacyDefaulted = false,
): DesktopMarketSnapshot {
  return { requested, effective, legacyDefaulted }
}

function bootstrap(
  overrides: Partial<DesktopSettingsControllerBootstrap> = {},
): DesktopSettingsControllerBootstrap {
  return {
    profiles: {
      current: { name: DESKTOP.name, dir: DESKTOP.dir },
      list: () => [DESKTOP, WORK, BROKEN],
      create: () => WORK,
      canDelete: () => false,
      delete: async () => {},
    },
    persistProfileSelection: async () => {},
    readMarket: () => market(),
    readWeb: () => ({
      localUrl: 'http://127.0.0.1:43120/',
      lanUrls: [],
    }),
    selectMarket: async provider => market(provider),
    scheduleRestart: () => {},
    scheduleRecoveryRestart: () => {},
    openTerminal: () => {},
    reloadRenderer: () => {},
    toggleDeveloperTools: () => {},
    exportDiagnostics: async () => {},
    openProfileCreator: () => {},
    ...overrides,
  }
}

interface RequestOptions {
  readonly body?: string | Buffer
  readonly headers?: Readonly<Record<string, string | undefined>>
  readonly remoteAddress?: string
}

function request(method: string, options: RequestOptions = {}): IncomingMessage {
  const req = Readable.from(options.body === undefined ? [] : [options.body]) as IncomingMessage
  req.method = method
  req.headers = {
    host: '127.0.0.1:43120',
    origin: ORIGIN,
    'sec-fetch-site': 'same-origin',
    ...options.headers,
  }
  Object.defineProperty(req, 'socket', {
    configurable: true,
    value: { remoteAddress: options.remoteAddress ?? '127.0.0.1' },
  })
  return req
}

function jsonRequest(value: unknown, options: RequestOptions = {}): IncomingMessage {
  const body = JSON.stringify(value)
  return request('POST', {
    ...options,
    body,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(Buffer.byteLength(body)),
      ...options.headers,
    },
  })
}

function response(): ServerResponse & {
  body: string
  end: ReturnType<typeof vi.fn>
  setHeader: ReturnType<typeof vi.fn>
} {
  const res = {
    body: '',
    statusCode: 200,
    setHeader: vi.fn(),
    end: vi.fn((body?: string) => { res.body = body ?? '' }),
  }
  return res as unknown as ServerResponse & typeof res
}

describe('desktop settings controller', () => {
  it('projects profiles without paths, bundles, or parser diagnostics', () => {
    const controller = new DesktopSettingsController(bootstrap())

    expect(controller.read()).toEqual({
      current: 'desktop',
      profiles: [
        { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
        { name: 'work', exists: true, webCapable: true, selectable: true, deletable: false },
        { name: 'broken', exists: true, webCapable: false, selectable: false, deletable: false },
      ],
      market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
      web: { localUrl: 'http://127.0.0.1:43120/', lanUrls: [] },
    })
    expect(JSON.stringify(controller.read())).not.toContain('/private')
    expect(JSON.stringify(controller.read())).not.toContain('private-bundle')
  })

  it('creates without selecting or restarting and returns a fresh safe state', () => {
    const create = vi.fn(() => WORK)
    const persistProfileSelection = vi.fn(async () => {})
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [DESKTOP, WORK],
        create,
      },
      persistProfileSelection,
      scheduleRestart,
    }))

    expect(controller.createProfile('work')).toEqual({
      current: 'desktop',
      profiles: [
        { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
        { name: 'work', exists: true, webCapable: true, selectable: true, deletable: false },
      ],
      market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
      web: { localUrl: 'http://127.0.0.1:43120/', lanUrls: [] },
    })
    expect(create).toHaveBeenCalledWith('work')
    expect(persistProfileSelection).not.toHaveBeenCalled()
    expect(scheduleRestart).not.toHaveBeenCalled()
  })

  it('deletes an eligible profile and returns the fresh projection', async () => {
    const remove = vi.fn(async () => {})
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [DESKTOP, WORK],
        create: () => WORK,
        canDelete: name => name === WORK.name,
        delete: remove,
      },
    }))

    await expect(controller.deleteProfile('work')).resolves.toEqual({
      current: 'desktop',
      profiles: [
        { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
        { name: 'work', exists: true, webCapable: true, selectable: true, deletable: true },
      ],
      market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
      web: { localUrl: 'http://127.0.0.1:43120/', lanUrls: [] },
    })
    expect(remove).toHaveBeenCalledWith('work')
  })

  it('persists a fresh selectable profile and defers restart until after response', async () => {
    const persistProfileSelection = vi.fn(async () => {})
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [DESKTOP, WORK, BROKEN],
        create: () => WORK,
      },
      persistProfileSelection,
      scheduleRestart,
    }))

    await expect(controller.selectProfile('desktop')).resolves.toEqual({
      response: { accepted: true, restartRequired: false },
    })
    const operation = await controller.selectProfile('work')
    expect(operation.response).toEqual({ accepted: true, restartRequired: true })
    expect(persistProfileSelection).toHaveBeenCalledOnce()
    expect(persistProfileSelection).toHaveBeenCalledWith('work')
    expect(scheduleRestart).not.toHaveBeenCalled()
    operation.afterResponse?.()
    expect(scheduleRestart).toHaveBeenCalledOnce()
    await expect(controller.selectProfile('broken')).rejects.toThrow('is not selectable')
  })

  it('keeps the generation-effective Market fixed and schedules only after persistence', async () => {
    const events: string[] = []
    const selectMarket = vi.fn(async (provider: DesktopMarketSnapshot['requested']) => {
      events.push(`persist:${provider}`)
      return market(provider, provider, false)
    })
    const scheduleRestart = vi.fn(() => { events.push('schedule') })
    const controller = new DesktopSettingsController(bootstrap({
      readMarket: () => market('community-market'),
      selectMarket,
      scheduleRestart,
    }))

    const operation = await controller.selectMarket('dsh-market')
    expect(operation.response).toEqual({ accepted: true, restartRequired: true })
    expect(events).toEqual(['persist:dsh-market'])
    operation.afterResponse?.()
    expect(events).toEqual(['persist:dsh-market', 'schedule'])
  })

  it('persists an explicit legacy-default choice without restarting the same provider', async () => {
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      readMarket: () => market('disabled', 'disabled', true),
      selectMarket: async provider => market(provider, provider, false),
      scheduleRestart,
    }))

    await expect(controller.selectMarket('disabled')).resolves.toEqual({
      response: { accepted: true, restartRequired: false },
    })
    expect(scheduleRestart).not.toHaveBeenCalled()
  })

  it('does not expose a restart callback when persistence fails', async () => {
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      persistProfileSelection: async () => { throw new Error('state is read-only') },
      selectMarket: async () => { throw new Error('state is read-only') },
      scheduleRestart,
    }))

    await expect(controller.selectProfile('work')).rejects.toThrow('state is read-only')
    await expect(controller.selectMarket('community-market')).rejects.toThrow('state is read-only')
    expect(scheduleRestart).not.toHaveBeenCalled()
  })

  it('opens the launcher-owned terminal and returns a stable acceptance', () => {
    const openTerminal = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({ openTerminal }))

    expect(controller.openTerminal()).toEqual({ accepted: true })
    expect(openTerminal).toHaveBeenCalledOnce()
  })

  it('defers an explicit Desktop restart until after its acceptance is returned', () => {
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({ scheduleRestart }))

    const operation = controller.restart()
    expect(operation.response).toEqual({ accepted: true })
    expect(scheduleRestart).not.toHaveBeenCalled()
    operation.afterResponse?.()
    expect(scheduleRestart).toHaveBeenCalledOnce()
  })

  it('keeps developer operations behind bounded launcher callbacks', () => {
    const reloadRenderer = vi.fn()
    const toggleDeveloperTools = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      reloadRenderer,
      toggleDeveloperTools,
    }))

    const reload = controller.reloadRenderer()
    expect(reload.response).toEqual({ accepted: true })
    expect(reloadRenderer).not.toHaveBeenCalled()
    reload.afterResponse?.()
    expect(reloadRenderer).toHaveBeenCalledOnce()
    expect(controller.toggleDeveloperTools()).toEqual({ accepted: true })
    expect(toggleDeveloperTools).toHaveBeenCalledOnce()
  })

  it('hands native diagnostics and Profile creation to launcher capabilities', async () => {
    const exportDiagnostics = vi.fn(async () => {})
    const openProfileCreator = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      exportDiagnostics,
      openProfileCreator,
    }))

    await expect(controller.exportDiagnostics()).resolves.toEqual({ accepted: true })
    expect(controller.openProfileCreator()).toEqual({ accepted: true })
    expect(exportDiagnostics).toHaveBeenCalledOnce()
    expect(openProfileCreator).toHaveBeenCalledOnce()
  })
})

describe('desktop settings HTTP boundary', () => {
  it('serves GET state with no-store headers and supports browser GET fetch metadata', async () => {
    const controller = new DesktopSettingsController(bootstrap())
    const req = request('GET', {
      headers: { origin: undefined, referer: `${ORIGIN}/settings` },
    })
    const res = response()

    await handleDesktopSettingsRequest(req, res, ORIGIN, controller)

    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual(controller.read())
    expect(res.setHeader).toHaveBeenCalledWith('cache-control', 'no-store')
    expect(res.setHeader).toHaveBeenCalledWith('x-content-type-options', 'nosniff')
  })

  it.each([
    ['cross-origin', { headers: { origin: 'https://example.com' } }],
    ['wrong Host', { headers: { host: 'example.com', origin: ORIGIN } }],
    ['non-loopback socket', { remoteAddress: '192.0.2.10' }],
    ['cross-site metadata', { headers: { 'sec-fetch-site': 'cross-site' } }],
  ] as const)('rejects a %s request before reading settings', async (_label, options) => {
    const readMarket = vi.fn(() => market())
    const controller = new DesktopSettingsController(bootstrap({ readMarket }))
    readMarket.mockClear()
    const res = response()

    await handleDesktopSettingsRequest(request('GET', options), res, ORIGIN, controller)

    expect(res.statusCode).toBe(403)
    expect(readMarket).not.toHaveBeenCalled()
  })

  it('creates a profile from an exact bounded JSON body', async () => {
    const create = vi.fn(() => WORK)
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [DESKTOP, WORK],
        create,
      },
    }))
    const res = response()

    await handleDesktopProfileCreateRequest(jsonRequest({ name: 'work' }), res, ORIGIN, controller)

    expect(res.statusCode).toBe(201)
    expect(JSON.parse(res.body)).toEqual({
      current: 'desktop',
      profiles: [
        { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
        { name: 'work', exists: true, webCapable: true, selectable: true, deletable: false },
      ],
      market: { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
      web: { localUrl: 'http://127.0.0.1:43120/', lanUrls: [] },
    })
    expect(create).toHaveBeenCalledWith('work')
  })

  it('deletes a profile through the exact mutation endpoint', async () => {
    const remove = vi.fn(async () => {})
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [DESKTOP, WORK],
        create: () => WORK,
        canDelete: name => name === WORK.name,
        delete: remove,
      },
    }))
    const res = response()

    await handleDesktopProfileDeleteRequest(jsonRequest({ name: 'work' }), res, ORIGIN, controller)

    expect(res.statusCode).toBe(200)
    expect(remove).toHaveBeenCalledWith('work')
    expect(JSON.parse(res.body).profiles).toEqual([
      { name: 'desktop', exists: true, webCapable: true, selectable: true, deletable: false },
      { name: 'work', exists: true, webCapable: true, selectable: true, deletable: true },
    ])
  })

  it.each([
    [{}, 400],
    [{ name: '' }, 400],
    [{ name: '../escape' }, 400],
    [{ name: 'work', extra: true }, 400],
    [{ provider: 'unknown' }, 400],
    [{ provider: 'disabled', extra: true }, 400],
  ])('rejects a non-exact or invalid mutation body', async (body, statusCode) => {
    const create = vi.fn(() => WORK)
    const selectMarket = vi.fn(async () => market())
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [],
        create,
      },
      selectMarket,
    }))
    const res = response()

    if ('provider' in body) {
      await handleDesktopMarketSelectRequest(jsonRequest(body), res, ORIGIN, controller)
    } else {
      await handleDesktopProfileCreateRequest(jsonRequest(body), res, ORIGIN, controller)
    }

    expect(res.statusCode).toBe(statusCode)
    expect(create).not.toHaveBeenCalled()
    expect(selectMarket).not.toHaveBeenCalled()
  })

  it('rejects unsupported media types and declared or streamed oversized bodies', async () => {
    const controller = new DesktopSettingsController(bootstrap())

    const wrongType = response()
    await handleDesktopProfileCreateRequest(
      request('POST', { body: '{}', headers: { 'content-type': 'text/plain' } }),
      wrongType,
      ORIGIN,
      controller,
    )
    expect(wrongType.statusCode).toBe(415)

    const declared = response()
    await handleDesktopProfileCreateRequest(
      request('POST', {
        body: '{}',
        headers: {
          'content-type': 'application/json',
          'content-length': String(desktopSettingsRouteConstants.maxBodyBytes + 1),
        },
      }),
      declared,
      ORIGIN,
      controller,
    )
    expect(declared.statusCode).toBe(413)

    const streamed = response()
    await handleDesktopProfileCreateRequest(
      request('POST', {
        body: Buffer.alloc(desktopSettingsRouteConstants.maxBodyBytes + 1, 0x20),
        headers: { 'content-type': 'application/json' },
      }),
      streamed,
      ORIGIN,
      controller,
    )
    expect(streamed.statusCode).toBe(413)
  })

  it('selects a profile and persists a Market provider through their fixed endpoints', async () => {
    const persistProfileSelection = vi.fn(async () => {})
    const selectMarket = vi.fn(async () => market('community-market'))
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [DESKTOP, WORK],
        create: () => WORK,
      },
      persistProfileSelection,
      selectMarket,
      scheduleRestart,
    }))
    const profileResponse = response()
    const marketResponse = response()

    await handleDesktopProfileSelectRequest(
      jsonRequest({ name: 'work' }), profileResponse, ORIGIN, controller,
    )
    await handleDesktopMarketSelectRequest(
      jsonRequest({ provider: 'community-market' }), marketResponse, ORIGIN, controller,
    )

    expect(profileResponse.statusCode).toBe(202)
    expect(JSON.parse(profileResponse.body)).toEqual({ accepted: true, restartRequired: true })
    expect(marketResponse.statusCode).toBe(202)
    expect(JSON.parse(marketResponse.body)).toEqual({ accepted: true, restartRequired: true })
    expect(persistProfileSelection).toHaveBeenCalledWith('work')
    expect(selectMarket).toHaveBeenCalledWith('community-market')
    expect(scheduleRestart).not.toHaveBeenCalled()
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(scheduleRestart).toHaveBeenCalledTimes(2)
  })

  it('opens the terminal only for an exact same-origin empty request', async () => {
    const openTerminal = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({ openTerminal }))
    const accepted = response()

    await handleDesktopTerminalOpenRequest(
      jsonRequest({}), accepted, ORIGIN, controller,
    )

    expect(accepted.statusCode).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({ accepted: true })
    expect(openTerminal).toHaveBeenCalledOnce()

    for (const req of [
      jsonRequest({ command: 'dsh plugin add untrusted' }),
      jsonRequest({}, { headers: { origin: 'https://example.com' } }),
    ]) {
      const rejected = response()
      await handleDesktopTerminalOpenRequest(req, rejected, ORIGIN, controller)
      expect(rejected.statusCode).toBe(req.headers.origin === ORIGIN ? 400 : 403)
    }
    expect(openTerminal).toHaveBeenCalledOnce()
  })

  it('runs the shared interactive update flow only for an exact empty request', async () => {
    const checkNow = vi.fn(async () => {})
    const accepted = response()

    await handleDesktopUpdateCheckRequest(jsonRequest({}), accepted, ORIGIN, checkNow)

    expect(accepted.statusCode).toBe(200)
    expect(JSON.parse(accepted.body)).toEqual({ accepted: true })
    expect(checkNow).toHaveBeenCalledOnce()

    const rejected = response()
    await handleDesktopUpdateCheckRequest(
      jsonRequest({ version: '9.9.9' }), rejected, ORIGIN, checkNow,
    )
    expect(rejected.statusCode).toBe(400)
    expect(checkNow).toHaveBeenCalledOnce()
  })

  it('queues an explicit restart only after an exact request has been acknowledged', async () => {
    const scheduleRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({ scheduleRestart }))
    const accepted = response()

    await handleDesktopRestartRequest(jsonRequest({}), accepted, ORIGIN, controller)

    expect(accepted.statusCode).toBe(202)
    expect(JSON.parse(accepted.body)).toEqual({ accepted: true })
    expect(scheduleRestart).not.toHaveBeenCalled()
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(scheduleRestart).toHaveBeenCalledOnce()

    const rejected = response()
    await handleDesktopRestartRequest(jsonRequest({ reason: 'untrusted' }), rejected, ORIGIN, controller)
    expect(rejected.statusCode).toBe(400)
    expect(scheduleRestart).toHaveBeenCalledOnce()
  })

  it('queues recovery restart separately and only after acknowledging an exact request', async () => {
    const scheduleRecoveryRestart = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({ scheduleRecoveryRestart }))
    const accepted = response()

    await handleDesktopRecoveryRestartRequest(jsonRequest({}), accepted, ORIGIN, controller)

    expect(accepted.statusCode).toBe(202)
    expect(JSON.parse(accepted.body)).toEqual({ accepted: true })
    expect(scheduleRecoveryRestart).not.toHaveBeenCalled()
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(scheduleRecoveryRestart).toHaveBeenCalledOnce()

    const rejected = response()
    await handleDesktopRecoveryRestartRequest(
      jsonRequest({ mode: 'untrusted' }), rejected, ORIGIN, controller,
    )
    expect(rejected.statusCode).toBe(400)
    expect(scheduleRecoveryRestart).toHaveBeenCalledOnce()
  })

  it('serves exact developer actions without accepting renderer commands', async () => {
    const reloadRenderer = vi.fn()
    const toggleDeveloperTools = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      reloadRenderer,
      toggleDeveloperTools,
    }))
    const reloadResponse = response()
    const devToolsResponse = response()

    await handleDesktopRendererReloadRequest(jsonRequest({}), reloadResponse, ORIGIN, controller)
    await handleDesktopDeveloperToolsToggleRequest(jsonRequest({}), devToolsResponse, ORIGIN, controller)

    expect(reloadResponse.statusCode).toBe(202)
    expect(devToolsResponse.statusCode).toBe(200)
    expect(JSON.parse(reloadResponse.body)).toEqual({ accepted: true })
    expect(JSON.parse(devToolsResponse.body)).toEqual({ accepted: true })
    expect(reloadRenderer).not.toHaveBeenCalled()
    expect(toggleDeveloperTools).toHaveBeenCalledOnce()
    await new Promise<void>(resolve => { setImmediate(resolve) })
    expect(reloadRenderer).toHaveBeenCalledOnce()

    const rejected = response()
    await handleDesktopDeveloperToolsToggleRequest(
      jsonRequest({ code: 'require("electron")' }), rejected, ORIGIN, controller,
    )
    expect(rejected.statusCode).toBe(400)
    expect(toggleDeveloperTools).toHaveBeenCalledOnce()
  })

  it('exports diagnostics and opens the native creator', async () => {
    const exportDiagnostics = vi.fn(async () => {})
    const openProfileCreator = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      exportDiagnostics,
      openProfileCreator,
    }))
    const diagnosticResponse = response()
    const creatorResponse = response()

    await handleDesktopDiagnosticsExportRequest(jsonRequest({}), diagnosticResponse, ORIGIN, controller)
    await handleDesktopProfileCreateWindowRequest(jsonRequest({}), creatorResponse, ORIGIN, controller)

    expect(diagnosticResponse.statusCode).toBe(200)
    expect(creatorResponse.statusCode).toBe(200)
    expect(exportDiagnostics).toHaveBeenCalledOnce()
    expect(openProfileCreator).toHaveBeenCalledOnce()
  })

  it('reports terminal launch failures without exposing the native cause', async () => {
    const reportError = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      openTerminal: () => { throw new Error('open -a Terminal failed at /private/path') },
    }))
    const res = response()

    await handleDesktopTerminalOpenRequest(
      jsonRequest({}), res, ORIGIN, controller, reportError,
    )

    expect(res.statusCode).toBe(500)
    expect(JSON.parse(res.body)).toEqual({ error: 'terminal could not be opened' })
    expect(res.body).not.toContain('/private')
    expect(reportError).toHaveBeenCalledWith('open terminal', expect.any(Error))
  })

  it('reports stable operation errors without exposing native causes', async () => {
    const reportError = vi.fn()
    const controller = new DesktopSettingsController(bootstrap({
      profiles: {
        current: { name: DESKTOP.name, dir: DESKTOP.dir },
        list: () => [],
        create: () => { throw new Error('EACCES /private/profiles/work') },
      },
    }))
    const res = response()

    await handleDesktopProfileCreateRequest(
      jsonRequest({ name: 'work' }), res, ORIGIN, controller, reportError,
    )

    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toEqual({ error: 'profile could not be created' })
    expect(res.body).not.toContain('/private')
    expect(reportError).toHaveBeenCalledWith('create profile', expect.any(Error))
  })

  it('rejects another method before invoking the controller', async () => {
    const readMarket = vi.fn(() => market())
    const controller = new DesktopSettingsController(bootstrap({ readMarket }))
    readMarket.mockClear()
    const res = response()

    await handleDesktopSettingsRequest(request('POST'), res, ORIGIN, controller)

    expect(res.statusCode).toBe(405)
    expect(res.setHeader).toHaveBeenCalledWith('allow', 'GET')
    expect(readMarket).not.toHaveBeenCalled()
  })
})
