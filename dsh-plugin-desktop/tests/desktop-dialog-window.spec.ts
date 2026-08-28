import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const windows: BrowserWindow[] = []
  class BrowserWindow {
    readonly onceListeners = new Map<string, Listener>()
    readonly listeners = new Map<string, Listener>()
    readonly webListeners = new Map<string, Listener>()
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => { this.webListeners.set(event, listener) }),
    }
    accessibleTitle = ''
    readonly isDestroyed = vi.fn(() => false)
    readonly isMinimized = vi.fn(() => false)
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly restore = vi.fn()
    readonly removeMenu = vi.fn()
    readonly destroy = vi.fn()
    private bounds: Electron.Rectangle
    readonly getBounds = vi.fn(() => ({ ...this.bounds }))
    readonly setBounds = vi.fn((bounds: Electron.Rectangle) => { this.bounds = { ...bounds } })
    readonly setContentSize = vi.fn((width: number, height: number) => {
      // Model native/invisible chrome so the test distinguishes content size
      // from outer bounds instead of accidentally treating them as identical.
      this.bounds = { ...this.bounds, width: width + 8, height: height + 12 }
    })
    readonly loadFile = vi.fn(async () => {})
    readonly once = vi.fn((event: string, listener: Listener) => { this.onceListeners.set(event, listener) })
    readonly on = vi.fn((event: string, listener: Listener) => { this.listeners.set(event, listener) })
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) {
      this.bounds = {
        x: 0,
        y: 0,
        width: options.width ?? 800,
        height: options.height ?? 600,
      }
      windows.push(this)
    }
  }
  return {
    app: { isHidden: vi.fn(() => false), show: vi.fn() },
    BrowserWindow,
    windows,
  }
})

vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow }))

import {
  DesktopDialogWindow,
  parseDesktopDialogResponse,
} from '../src/desktop-dialog-window.ts'

describe('DesktopDialogWindow', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('accepts only bounded local response navigation', () => {
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=1', 2)).toBe(1)
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=2', 2)).toBeUndefined()
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=-1', 2)).toBeUndefined()
    expect(parseDesktopDialogResponse('dsh-desktop-dialog://response?id=1&command=bad', 2)).toBeUndefined()
    expect(parseDesktopDialogResponse('https://response/?id=1', 2)).toBeUndefined()
  })

  it('creates a frameless parented modal shadcn window and returns its explicit response', async () => {
    const parent = new electron.BrowserWindow({})
    const dialog = new DesktopDialogWindow({
      type: 'question',
      title: 'Restart DSH Desktop',
      message: 'Restart now?',
      detail: 'Running operations may be interrupted.',
      buttons: ['Restart', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
    }, parent as unknown as Electron.BrowserWindow)
    const result = dialog.run()
    await vi.waitFor(() => { expect(electron.windows).toHaveLength(2) })
    const window = electron.windows[1]
    expect(window?.options).toEqual(expect.objectContaining({
      parent,
      modal: true,
      frame: false,
      closable: false,
      resizable: false,
      height: 300,
      useContentSize: true,
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        enablePreferredSizeMode: true,
      }),
    }))
    expect(window?.options).not.toHaveProperty('minHeight')
    expect(window?.options).not.toHaveProperty('maxHeight')
    expect(window?.options).not.toHaveProperty('titleBarStyle')
    expect(window?.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]native-ui[\\/]desktop-dialog\.html$/u),
      expect.objectContaining({ query: expect.objectContaining({ platform: process.platform, frame: 'false' }) }),
    )
    const navigate = window?.webListeners.get('will-navigate')
    window?.onceListeners.get('ready-to-show')?.()
    expect(window?.show).not.toHaveBeenCalled()
    const preferredSize = window?.webListeners.get('preferred-size-changed')
    preferredSize?.({}, { width: 492, height: 134 })
    expect(window?.setContentSize).not.toHaveBeenCalled()
    window?.webListeners.get('did-finish-load')?.()
    expect(window?.setContentSize).toHaveBeenCalledWith(480, 166, false)
    expect(window?.setBounds).not.toHaveBeenCalled()
    expect(window?.show).toHaveBeenCalledOnce()
    const event = { preventDefault: vi.fn() }
    navigate?.(event, 'dsh-desktop-dialog://response?id=0')

    await expect(result).resolves.toEqual({ response: 0 })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(window?.destroy).toHaveBeenCalledOnce()
  })

  it('uses a larger scrollable presentation for detailed recovery failures', async () => {
    const parent = new electron.BrowserWindow({})
    const result = new DesktopDialogWindow({
      type: 'error',
      title: 'Rollback failed',
      message: 'Profile dependencies could not be rebuilt.',
      detail: 'Exit code: 1\n\nstderr:\nERR_PNPM_OUTDATED_LOCKFILE',
      buttons: ['Close'],
      defaultId: 0,
      cancelId: 0,
      presentation: 'diagnostic',
    }, parent as unknown as Electron.BrowserWindow).run()
    await vi.waitFor(() => { expect(electron.windows).toHaveLength(2) })
    const window = electron.windows[1]
    expect(window?.options).toEqual(expect.objectContaining({
      width: 680,
      height: 460,
      minWidth: 560,
      maxWidth: 860,
      parent,
      modal: true,
      frame: false,
    }))
    const loadCalls = window?.loadFile.mock.calls as unknown as readonly [
      string,
      { readonly query: { readonly state?: string } },
    ][] | undefined
    const query = loadCalls?.[0]?.[1].query
    expect(JSON.parse(Buffer.from(query?.state ?? '', 'base64url').toString('utf8'))).toMatchObject({
      presentation: 'diagnostic',
      detail: expect.stringContaining('ERR_PNPM_OUTDATED_LOCKFILE'),
    })
    window?.onceListeners.get('ready-to-show')?.()
    window?.webListeners.get('preferred-size-changed')?.({}, { width: 680, height: 390 })
    window?.webListeners.get('did-finish-load')?.()
    expect(window?.setContentSize).toHaveBeenCalledWith(680, 422, false)
    window?.webListeners.get('will-navigate')?.(
      { preventDefault: vi.fn() },
      'dsh-desktop-dialog://response?id=0',
    )
    await expect(result).resolves.toEqual({ response: 0 })
  })

  it('maps window close to the configured cancel response', async () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const result = new DesktopDialogWindow({
      title: 'Confirm',
      message: 'Continue?',
      buttons: ['Continue', 'Cancel'],
      cancelId: 1,
    }).run()
    await vi.waitFor(() => { expect(electron.windows).toHaveLength(1) })
    expect(electron.windows[0]?.options).toEqual(expect.objectContaining({
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 12 },
    }))
    expect(electron.windows[0]?.options).not.toHaveProperty('minHeight')
    expect(electron.windows[0]?.loadFile).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ query: expect.objectContaining({ frame: 'true' }) }),
    )
    electron.windows[0]?.listeners.get('closed')?.()
    await expect(result).resolves.toEqual({ response: 1 })
  })
})
