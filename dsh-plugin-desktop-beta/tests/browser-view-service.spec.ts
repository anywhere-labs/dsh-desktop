import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserViewService, type DesktopNativeBrowserEvent } from '../src/browser-view-service.ts'

interface FakeSession extends EventEmitter {
  setPermissionRequestHandler: ReturnType<typeof vi.fn>
  setPermissionCheckHandler: ReturnType<typeof vi.fn>
}

interface FakeDebugger extends EventEmitter {
  isAttached: ReturnType<typeof vi.fn>
  attach: ReturnType<typeof vi.fn>
  detach: ReturnType<typeof vi.fn>
  sendCommand: ReturnType<typeof vi.fn>
}

interface FakeWebContents extends EventEmitter {
  session: FakeSession
  debugger: FakeDebugger
  setWindowOpenHandler: ReturnType<typeof vi.fn>
  loadURL: ReturnType<typeof vi.fn>
  setZoomFactor: ReturnType<typeof vi.fn>
  setZoomLevel: ReturnType<typeof vi.fn>
  focus: ReturnType<typeof vi.fn>
  close: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
}

interface FakeView {
  options: { webPreferences: { partition: string } }
  webContents: FakeWebContents
  setBounds: ReturnType<typeof vi.fn>
  setVisible: ReturnType<typeof vi.fn>
}

const electron = vi.hoisted(() => {
  const views: unknown[] = []
  const state: { create: ((options: unknown) => unknown) | undefined } = { create: undefined }
  class WebContentsView {
    readonly webContents: unknown
    readonly setBounds = vi.fn()
    readonly setVisible = vi.fn()
    constructor(readonly options: unknown) {
      this.webContents = state.create?.(options)
      views.push(this)
    }
  }
  return { WebContentsView, views, state }
})

vi.mock('electron', () => ({ WebContentsView: electron.WebContentsView }))

function createSession(): FakeSession {
  return Object.assign(new EventEmitter(), {
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn(),
  }) as FakeSession
}

function createDebugger(): FakeDebugger {
  let attached = false
  return Object.assign(new EventEmitter(), {
    isAttached: vi.fn(() => attached),
    attach: vi.fn(() => { attached = true }),
    detach: vi.fn(() => { attached = false }),
    sendCommand: vi.fn(async () => ({ ok: true })),
  }) as FakeDebugger
}

function createWebContents(session: FakeSession): FakeWebContents {
  let destroyed = false
  const webContents = Object.assign(new EventEmitter(), {
    session,
    debugger: createDebugger(),
    setWindowOpenHandler: vi.fn(),
    loadURL: vi.fn(async () => {}),
    setZoomFactor: vi.fn(),
    setZoomLevel: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => destroyed),
    close: vi.fn(() => { destroyed = true; webContents.emit('destroyed') }),
  }) as FakeWebContents
  return webContents
}

function fixture(origin: { x: number; y: number } = { x: 0, y: 36 }) {
  const sessions: FakeSession[] = []
  const contents: FakeWebContents[] = []
  electron.views.length = 0
  electron.state.create = () => {
    const session = createSession()
    sessions.push(session)
    const webContents = createWebContents(session)
    contents.push(webContents)
    return webContents
  }
  const log = vi.fn()
  const window = createWindow()
  let current = window
  const service = new BrowserViewService({
    window: () => current as never,
    rendererOrigin: () => origin,
    log,
  })
  const events: DesktopNativeBrowserEvent[] = []
  service.subscribe(event => { events.push(event) })
  const view = (index = 0): FakeView => electron.views[index] as FakeView
  return {
    service,
    window,
    view,
    views: electron.views as FakeView[],
    sessions,
    contents,
    events,
    log,
    setWindow: (next: FakeWindow) => { current = next },
  }
}

function createWindow() {
  return Object.assign(new EventEmitter(), {
    contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
    getContentSize: vi.fn(() => [1000, 700]),
    isVisible: vi.fn(() => true),
    isMinimized: vi.fn(() => false),
    isDestroyed: vi.fn(() => false),
  })
}

type FakeWindow = ReturnType<typeof createWindow>

beforeEach(() => {
  electron.views.length = 0
  electron.state.create = undefined
})

describe('guest browser view service', () => {
  it('creates a hidden, sandboxed view in the shared browser profile', async () => {
    const { service, window, view, sessions } = fixture()
    await expect(service.createView({ id: 'tab-1', owner: 'session-a' })).resolves.toEqual({ id: 'tab-1' })
    expect(service.version).toBe(1)
    expect(view().options.webPreferences).toEqual({
      partition: 'persist:dsh-desktop-browser-profile',
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
    })
    expect(window.contentView.addChildView).toHaveBeenCalledWith(view())
    expect(view().setVisible).toHaveBeenLastCalledWith(false)
    expect(view().setBounds).not.toHaveBeenCalled()

    const session = sessions[0]!
    const request = session.setPermissionRequestHandler.mock.calls[0]?.[0] as (
      contents: unknown,
      permission: string,
      callback: (granted: boolean) => void,
    ) => void
    const grant = vi.fn()
    request(null, 'geolocation', grant)
    expect(grant).toHaveBeenCalledWith(false)
    const check = session.setPermissionCheckHandler.mock.calls[0]?.[0] as () => boolean
    expect(check()).toBe(false)
    const download = { preventDefault: vi.fn() }
    session.emit('will-download', download)
    expect(download.preventDefault).toHaveBeenCalledOnce()
  })

  it('gives every owner the same browser profile and hides popups', async () => {
    const { service, views, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.createView({ id: 'b', owner: 'session-a' })
    await service.createView({ id: 'c', owner: 'session-b' })
    const partition = (index: number) => views[index]!.options.webPreferences.partition
    // One profile behind every conversation: a sign-in made in one Session is
    // the sign-in the next Session opens the same site with.
    expect(partition(0)).toBe('persist:dsh-desktop-browser-profile')
    expect(partition(1)).toBe(partition(0))
    expect(partition(2)).toBe(partition(0))

    const handler = views[0]!.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (
      details: { url: string },
    ) => unknown
    expect(handler({ url: 'https://example.com/popup' })).toEqual({ action: 'deny' })
    expect(events).toContainEqual({ type: 'window-open', id: 'a', url: 'https://example.com/popup' })
  })

  it('reports an unavailable native surface instead of throwing at construction', async () => {
    const service = new BrowserViewService({ window: () => undefined, rendererOrigin: () => ({ x: 0, y: 0 }) })
    await expect(service.createView({ id: 'a', owner: 'session-a' })).rejects.toThrow('BROWSER_VIEW_UNAVAILABLE')
    await expect(service.createView({ id: '', owner: 'session-a' })).rejects.toThrow('BROWSER_VIEW_INVALID')
    await expect(service.setBounds('a', { x: 0, y: 0, width: 10, height: 10 })).resolves.toBeUndefined()
  })

  it('clamps renderer geometry below the caption row and hides tiny rectangles', async () => {
    const { service, view } = fixture({ x: 0, y: 36 })
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.setBounds('a', { x: 20, y: 0, width: 400, height: 300 })
    await service.setVisible('a', true)
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 20, y: 36, width: 400, height: 300 })
    expect(view().setVisible).toHaveBeenLastCalledWith(true)

    await service.setBounds('a', { x: 20, y: -50, width: 400, height: 300 })
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 20, y: 36, width: 400, height: 300 })

    await service.setBounds('a', { x: 900, y: 600, width: 400, height: 300 })
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 900, y: 636, width: 100, height: 64 })

    await service.setBounds('a', { x: 1200, y: 900, width: 100, height: 100 })
    expect(view().setVisible).toHaveBeenLastCalledWith(false)

    const applied = view().setBounds.mock.calls.length
    await service.setBounds('missing', { x: 0, y: 0, width: 10, height: 10 })
    expect(view().setBounds.mock.calls.length).toBe(applied)
  })

  it('re-clamps for the window content area on an advanced shell without a caption row', async () => {
    const { service, view } = fixture({ x: 0, y: 0 })
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.setBounds('a', { x: 10, y: 10, width: 2000, height: 2000 })
    await service.setVisible('a', true)
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 10, y: 10, width: 990, height: 690 })
  })

  it('hides and restores the view with its window and re-appends it last', async () => {
    const { service, window, view } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.setBounds('a', { x: 10, y: 10, width: 300, height: 200 })
    await service.setVisible('a', true)
    expect(view().setVisible).toHaveBeenLastCalledWith(true)
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(view())

    window.isMinimized.mockReturnValue(true)
    window.emit('minimize')
    expect(view().setVisible).toHaveBeenLastCalledWith(false)

    window.isMinimized.mockReturnValue(false)
    window.emit('restore')
    expect(view().setVisible).toHaveBeenLastCalledWith(true)
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 10, y: 46, width: 300, height: 200 })

    window.isVisible.mockReturnValue(false)
    window.emit('hide')
    expect(view().setVisible).toHaveBeenLastCalledWith(false)

    window.isVisible.mockReturnValue(true)
    window.emit('show')
    expect(view().setVisible).toHaveBeenLastCalledWith(true)
    expect(window.contentView.addChildView).toHaveBeenLastCalledWith(view())

    window.emit('close')
    expect(view().setVisible).toHaveBeenLastCalledWith(false)
    window.emit('show')
    expect(view().setVisible).toHaveBeenLastCalledWith(true)

    await service.setVisible('a', false)
    expect(view().setVisible).toHaveBeenLastCalledWith(false)
  })

  it('enforces the origin allowlist on every top-level navigation', async () => {
    const { service, view, contents, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a', url: 'https://allowed.example/start' })
    const webContents = contents[0]!
    expect(webContents.loadURL).toHaveBeenCalledWith('https://allowed.example/start')

    await service.createView({ id: 'b', owner: 'session-b', allowOrigins: ['https://allowed.example'] })
    const guest = contents[1]!
    const navigate = (url: string, isMainFrame = true) => {
      const event = { url, isMainFrame, preventDefault: vi.fn() }
      guest.emit('will-frame-navigate', event)
      return event
    }
    expect(navigate('https://allowed.example/page').preventDefault).not.toHaveBeenCalled()
    const blocked = navigate('https://blocked.example/page')
    expect(blocked.preventDefault).toHaveBeenCalledOnce()
    expect(guest.loadURL).toHaveBeenLastCalledWith('about:blank')
    expect(events).toContainEqual({
      type: 'failed',
      id: 'b',
      url: 'https://blocked.example/page',
      error: expect.stringContaining('BROWSER_VIEW_NAVIGATION_DENIED'),
    })
    expect(navigate('file:///etc/passwd').preventDefault).toHaveBeenCalledOnce()
    expect(navigate('https://blocked.example/frame', false).preventDefault).not.toHaveBeenCalled()

    guest.loadURL.mockClear()
    await service.navigate('b', 'https://blocked.example/other')
    expect(guest.loadURL).toHaveBeenCalledExactlyOnceWith('about:blank')
    await service.navigate('b', 'https://allowed.example/next')
    expect(guest.loadURL).toHaveBeenLastCalledWith('https://allowed.example/next')
    expect(view(0)!.webContents.loadURL).toHaveBeenCalledTimes(1)
  })

  it('reports navigation, title, loading, and failure events', async () => {
    const { service, contents, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    const webContents = contents[0]!
    webContents.emit('did-start-loading')
    webContents.emit('page-title-updated', {}, 'Example Domain')
    webContents.emit('did-navigate', {}, 'https://example.com/', 200, 'OK')
    webContents.emit('did-navigate-in-page', {}, 'https://example.com/#top', true)
    webContents.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', 'https://nope.example/', true)
    webContents.emit('did-fail-load', {}, -3, 'ERR_ABORTED', 'https://example.com/', true)
    webContents.emit('did-stop-loading')
    expect(events).toEqual([
      { type: 'loading', id: 'a', loading: true },
      { type: 'title', id: 'a', title: 'Example Domain' },
      { type: 'navigated', id: 'a', url: 'https://example.com/' },
      { type: 'navigated', id: 'a', url: 'https://example.com/#top' },
      { type: 'failed', id: 'a', url: 'https://nope.example/', error: '-105: ERR_NAME_NOT_RESOLVED' },
      { type: 'loading', id: 'a', loading: false },
    ])
  })

  it('allowlists CDP commands and forwards debugger messages', async () => {
    const { service, contents, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    const { debugger: session } = contents[0]!
    await expect(service.command('missing', 'Page.enable')).rejects.toThrow('BROWSER_VIEW_UNKNOWN')
    await expect(service.command('a', 'Target.getTargets')).rejects.toThrow('BROWSER_VIEW_CDP_DENIED')
    await expect(service.command('a', 'Page.setDownloadBehavior', { behavior: 'allow' }))
      .rejects.toThrow('BROWSER_VIEW_CDP_DENIED')
    await expect(service.command('a', 'Page.navigate', { url: 'file:///etc/passwd' }))
      .rejects.toThrow('BROWSER_VIEW_CDP_DENIED')
    expect(session.attach).not.toHaveBeenCalled()

    session.sendCommand.mockResolvedValueOnce({ frameId: 'frame-1' })
    await expect(service.command('a', 'Page.navigate', { url: 'https://example.com/' }))
      .resolves.toEqual({ frameId: 'frame-1' })
    expect(session.attach).toHaveBeenCalledExactlyOnceWith('1.3')
    expect(session.sendCommand).toHaveBeenLastCalledWith('Page.navigate', { url: 'https://example.com/' })
    await service.command('a', 'Page.enable')
    expect(session.sendCommand).toHaveBeenLastCalledWith('Page.enable')
    expect(session.attach).toHaveBeenCalledOnce()

    session.emit('message', {}, 'Runtime.consoleAPICalled', { type: 'log', args: [] })
    expect(events).toContainEqual({
      type: 'cdp',
      id: 'a',
      method: 'Runtime.consoleAPICalled',
      params: { type: 'log', args: [] },
    })

    await service.close('a')
    expect(session.detach).toHaveBeenCalledOnce()
    await expect(service.command('a', 'Page.enable')).rejects.toThrow('BROWSER_VIEW_UNKNOWN')
  })

  it('applies zoom with a zoom-level fallback and focuses the page', async () => {
    const { service, contents } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    const webContents = contents[0]!
    await service.setZoom('a', 0.64)
    expect(webContents.setZoomFactor).toHaveBeenCalledExactlyOnceWith(0.64)
    webContents.setZoomFactor.mockImplementationOnce(() => { throw new Error('unsupported') })
    await service.setZoom('a', 2)
    expect(webContents.setZoomLevel).toHaveBeenLastCalledWith(1)
    await expect(service.setZoom('a', 0)).rejects.toThrow('BROWSER_VIEW_INVALID')
    await expect(service.setZoom('a', Number.NaN)).rejects.toThrow('BROWSER_VIEW_INVALID')
    await service.setZoom('missing', 1)
    await service.focus('a')
    await service.focus('missing')
    expect(webContents.focus).toHaveBeenCalledOnce()
  })

  it('releases closed, replaced, crashed, and owner-closed views exactly once', async () => {
    const { service, window, views, contents, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.createView({ id: 'b', owner: 'session-a' })
    await service.createView({ id: 'c', owner: 'session-b' })
    await service.createView({ id: 'd', owner: 'session-b' })

    await service.close('a')
    await service.close('a')
    expect(events.filter(event => event.type === 'closed')).toEqual([{ type: 'closed', id: 'a', reason: 'closed' }])
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(views[0])
    expect(contents[0]!.close).toHaveBeenCalledExactlyOnceWith({ waitForBeforeUnload: false })

    // Replacing an id reports no close of its own; views[4] is the new 'b'.
    await service.createView({ id: 'b', owner: 'session-a' })
    expect(contents[1]!.close).toHaveBeenCalledOnce()
    expect(events.filter(event => event.type === 'closed')).toHaveLength(1)

    contents[2]!.emit('render-process-gone', {}, { reason: 'crashed' })
    contents[2]!.emit('destroyed')
    await service.close('c')
    expect(events.at(-1)).toEqual({ type: 'closed', id: 'c', reason: 'crashed' })

    await service.closeOwner('session-b')
    expect(events.filter(event => event.type === 'closed').map(event => 'id' in event && event.id))
      .toEqual(['a', 'c', 'd'])

    window.emit('closed')
    expect(events.at(-1)).toEqual({ type: 'closed', id: 'b', reason: 'closed' })
    const applied = views[4]!.setVisible.mock.calls.length
    await service.setBounds('b', { x: 0, y: 0, width: 10, height: 10 })
    await service.setVisible('b', true)
    expect(views[4]!.setVisible.mock.calls.length).toBe(applied)
  })

  it('releases every view when the shell generation goes away', async () => {
    const { service, views, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.createView({ id: 'b', owner: 'session-b' })
    service.closeAll()
    expect(events.filter(event => event.type === 'closed')).toHaveLength(2)
    expect(views[0]!.webContents.close).toHaveBeenCalledOnce()
    expect(views[1]!.webContents.close).toHaveBeenCalledOnce()
  })

  it('follows the window of the active shell generation', async () => {
    const { service, window, view, setWindow, events } = fixture()
    await service.createView({ id: 'a', owner: 'session-a' })
    await service.setBounds('a', { x: 5, y: 5, width: 100, height: 100 })
    await service.setVisible('a', true)
    expect(view().setBounds).toHaveBeenLastCalledWith({ x: 5, y: 41, width: 100, height: 100 })

    const next = createWindow()
    next.getContentSize.mockReturnValue([800, 600])
    window.emit('closed')
    setWindow(next)
    expect(events.at(-1)).toEqual({ type: 'closed', id: 'a', reason: 'closed' })

    await service.setBounds('a', { x: 5, y: 5, width: 100, height: 100 })
    expect(view().setBounds).toHaveBeenCalledOnce()

    await service.createView({ id: 'b', owner: 'session-a' })
    await service.setBounds('b', { x: 5, y: 5, width: 1000, height: 1000 })
    await service.setVisible('b', true)
    expect(next.contentView.addChildView).toHaveBeenCalledTimes(2)
    expect(view(1)!.setBounds).toHaveBeenLastCalledWith({ x: 5, y: 41, width: 795, height: 559 })
  })

  it('keeps a failing subscriber from breaking the service', async () => {
    const { service, contents, log } = fixture()
    service.subscribe(() => { throw new Error('subscriber failed') })
    await service.createView({ id: 'a', owner: 'session-a' })
    contents[0]!.emit('did-start-loading')
    expect(log).toHaveBeenCalledWith(expect.stringContaining('subscriber failed'))
  })

  it('stops reporting to an unsubscribed listener', async () => {
    const { service, contents } = fixture()
    const seen: DesktopNativeBrowserEvent[] = []
    const unsubscribe = service.subscribe(event => { seen.push(event) })
    unsubscribe()
    unsubscribe()
    await service.createView({ id: 'a', owner: 'session-a' })
    contents[0]!.emit('did-start-loading')
    expect(seen).toHaveLength(0)
  })
})
