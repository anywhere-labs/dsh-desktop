import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const windows: BrowserWindow[] = []
  const popup = vi.fn()
  const buildFromTemplate = vi.fn((template: unknown[]) => ({ template, popup }))
  class BrowserWindow {
    readonly webListeners = new Map<string, Listener>()
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => { this.webListeners.set(event, listener) }),
    }
    readonly isDestroyed = vi.fn(() => false)
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) { windows.push(this) }
  }
  return { BrowserWindow, windows, popup, buildFromTemplate, locale: 'en-US' }
})

vi.mock('electron', () => ({
  app: { getLocale: () => electron.locale },
  BrowserWindow: electron.BrowserWindow,
  Menu: { buildFromTemplate: electron.buildFromTemplate },
}))

import { createDesktopLocalWindow } from '../src/local-window-policy.ts'

const editFlags = {
  canUndo: false,
  canRedo: false,
  canCut: true,
  canCopy: true,
  canPaste: false,
  canDelete: true,
  canSelectAll: true,
  canEditRichly: false,
}

describe('Desktop local-window policy', () => {
  beforeEach(() => {
    electron.windows.length = 0
    electron.locale = 'en-US'
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('constructs a dedicated sandbox and denies popup and WebView attachment', () => {
    const window = createDesktopLocalWindow({
      title: 'Local action',
      width: 480,
      partition: 'dsh-local-action',
      preferredSizeMode: true,
      locale: 'zh',
    }) as unknown as InstanceType<typeof electron.BrowserWindow>

    expect(window.options).toEqual({
      title: 'Local action',
      width: 480,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        spellcheck: false,
        enablePreferredSizeMode: true,
        partition: 'dsh-local-action',
      },
    })
    expect(window.options.webPreferences).not.toHaveProperty('preload')
    expect(window.options).not.toHaveProperty('locale')
    const deny = window.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as (() => unknown) | undefined
    expect(deny?.()).toEqual({ action: 'deny' })
    const event = { preventDefault: vi.fn() }
    window.webListeners.get('will-attach-webview')?.(event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it.each(['', 'persist:dsh-local-action', 'shared-session'])(
    'rejects the non-dedicated partition %j before window construction',
    (partition) => {
      expect(() => createDesktopLocalWindow({ partition })).toThrow('dedicated in-memory dsh-* partition')
      expect(electron.windows).toHaveLength(0)
    },
  )

  it('pops the official editing menu, labelling Windows roles in the window locale', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const window = createDesktopLocalWindow({
      partition: 'dsh-local-action',
      locale: 'zh',
    }) as unknown as InstanceType<typeof electron.BrowserWindow>
    const listener = window.webListeners.get('context-menu')
    expect(listener).toEqual(expect.any(Function))

    listener?.({}, { isEditable: true, selectionText: '', editFlags })
    expect(electron.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'undo', enabled: false, label: '撤销', accelerator: '' },
      { role: 'redo', enabled: false, label: '重做', accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'cut', enabled: true, label: '剪切', accelerator: '' },
      { role: 'copy', enabled: true, label: '复制', accelerator: '' },
      { role: 'paste', enabled: false, label: '粘贴', accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'selectAll', enabled: true, label: '全选', accelerator: '' },
    ])
    expect(electron.popup).toHaveBeenCalledWith({ window })

    listener?.({}, { isEditable: false, selectionText: '', editFlags })
    expect(electron.buildFromTemplate).toHaveBeenCalledOnce()
  })

  it('labels the menu from the Electron locale when the window has no Desktop copy', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    electron.locale = 'zh-CN'
    const window = createDesktopLocalWindow({
      partition: 'dsh-desktop-dialog',
    }) as unknown as InstanceType<typeof electron.BrowserWindow>

    window.webListeners.get('context-menu')?.({}, { isEditable: false, selectionText: 'Diagnostics', editFlags })
    expect(electron.buildFromTemplate).toHaveBeenCalledWith([
      { role: 'copy', enabled: true, label: '复制', accelerator: '' },
    ])
    expect(electron.popup).toHaveBeenCalledWith({ window })
  })

  it('keeps native role labels outside Windows', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    const window = createDesktopLocalWindow({
      partition: 'dsh-local-action',
      locale: 'zh',
    }) as unknown as InstanceType<typeof electron.BrowserWindow>

    window.webListeners.get('context-menu')?.({}, { isEditable: false, selectionText: 'DSH', editFlags })
    expect(electron.buildFromTemplate).toHaveBeenCalledWith([{ role: 'copy', enabled: true, accelerator: '' }])
  })
})
