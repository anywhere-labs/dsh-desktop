import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { BrowserWindow, Session } from 'electron'
import { installMediaPermissions } from '../src/electron-permissions.ts'
import type { NativePermissions } from '../src/native-permissions.ts'

const fixture = vi.hoisted(() => ({ sources: vi.fn(), select: 1, menu: [] as any[] }))
vi.mock('electron', () => ({
  desktopCapturer: { getSources: fixture.sources }, shell: {}, systemPreferences: {},
  Menu: { buildFromTemplate: (items: any[]) => {
    fixture.menu = items
    return { popup: ({ callback }: any) => { if (fixture.select >= 0) items[fixture.select].click(); callback() }, closePopup() {} }
  } },
}))
beforeEach(() => { fixture.sources.mockReset().mockResolvedValue([{ id: 'screen:1', name: 'Screen 1' }, { id: 'screen:2', name: 'Screen 2' }]); fixture.select = 1 })

function setup() {
  let check!: Parameters<Session['setPermissionCheckHandler']>[0]
  let request!: Parameters<Session['setPermissionRequestHandler']>[0]
  let display!: Parameters<Session['setDisplayMediaRequestHandler']>[0]
  let picker: unknown
  const owner = Object.assign(new EventEmitter(), {
    isDestroyed: () => false, isFocused: () => true,
    webContents: { getURL: () => 'dsh-app://app/', isDestroyed: () => false, mainFrame: {}, executeJavaScript: vi.fn(async () => true) },
  }) as unknown as BrowserWindow
  const permission = {
    query: vi.fn(() => ({ status: 'not-determined' })), request: vi.fn(async () => ({ status: 'granted' })),
  }
  installMediaPermissions({
    setPermissionCheckHandler: handler => { check = handler },
    setPermissionRequestHandler: handler => { request = handler },
    setDisplayMediaRequestHandler: (handler, options) => { display = handler; picker = options },
  } as Session, permission as unknown as NativePermissions, { window: () => owner, language: () => 'en', warn: vi.fn() })
  return { check: check!, request: request!, display: display!, owner, permission, picker }
}

it('keeps passive checks prompt-free and denies foreign frames and camera access', async () => {
  const { check, request, owner, permission } = setup()
  expect(check(owner.webContents, 'media', 'dsh-app://app', { isMainFrame: true, mediaType: 'audio' })).toBe(false)
  expect(permission.request).not.toHaveBeenCalled()
  const callback = vi.fn()
  request(owner.webContents, 'media', callback, { requestingUrl: 'https://example.com', isMainFrame: true, mediaTypes: ['audio'] })
  request(owner.webContents, 'media', callback, { requestingUrl: 'dsh-app://app/', isMainFrame: false, mediaTypes: ['audio'] })
  request(owner.webContents, 'media', callback, { requestingUrl: 'dsh-app://app/', isMainFrame: true, mediaTypes: ['video'] })
  expect(callback.mock.calls).toEqual([[false], [false], [false]])
  expect(permission.request).not.toHaveBeenCalled()
  request(owner.webContents, 'media', callback, { requestingUrl: 'dsh-app://app/', isMainFrame: true, mediaTypes: ['audio'] })
  await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith(true))
  expect(permission.request).toHaveBeenCalledWith('microphone')
})

it('requires a gesture for a new microphone request', async () => {
  const { request, owner, permission } = setup()
  vi.mocked(owner.webContents.executeJavaScript).mockResolvedValue(false)
  const callback = vi.fn()
  request(owner.webContents, 'media', callback, { requestingUrl: 'dsh-app://app/', isMainFrame: true, mediaTypes: ['audio'] })
  await vi.waitFor(() => expect(callback).toHaveBeenCalledWith(false))
  expect(permission.request).not.toHaveBeenCalled()
})

it('settles consent callbacks once when the requesting frame has gone away', async () => {
  const { request, display, owner } = setup()
  const microphone = vi.fn(() => { throw new Error('Frame gone') })
  const screen = vi.fn(() => { throw new Error('Frame gone') })
  request(owner.webContents, 'media', microphone, { requestingUrl: 'dsh-app://app/', isMainFrame: true, mediaTypes: ['audio'] })
  display({ frame: owner.webContents.mainFrame, securityOrigin: 'dsh-app://app', videoRequested: true, audioRequested: false, userGesture: true }, screen)
  await vi.waitFor(() => { expect(microphone).toHaveBeenCalledOnce(); expect(screen).toHaveBeenCalledOnce() })
})

it('uses the system picker or an explicit source selection and handles cancellation', async () => {
  const { display, owner, picker } = setup()
  expect(picker).toEqual({ useSystemPicker: true })
  const callback = vi.fn()
  const request = { frame: owner.webContents.mainFrame, securityOrigin: 'dsh-app://app', videoRequested: true, audioRequested: false, userGesture: true }
  fixture.select = 2
  display(request, callback)
  await vi.waitFor(() => expect(callback).toHaveBeenCalledWith({ video: { id: 'screen:2', name: 'Screen 2' } }))
  expect(fixture.sources).toHaveBeenCalledWith({ types: ['screen', 'window'], thumbnailSize: { width: 0, height: 0 } })
  fixture.select = -1
  display(request, callback)
  await vi.waitFor(() => expect(callback).toHaveBeenLastCalledWith({}))
  fixture.sources.mockClear()
  display({ ...request, userGesture: false }, callback)
  display({ ...request, frame: {} as Electron.WebFrameMain }, callback)
  expect(fixture.sources).not.toHaveBeenCalled()
})
