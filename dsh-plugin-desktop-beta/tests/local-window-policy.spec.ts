import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const windows: BrowserWindow[] = []
  class BrowserWindow {
    readonly webListeners = new Map<string, Listener>()
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => { this.webListeners.set(event, listener) }),
    }
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) { windows.push(this) }
  }
  return { BrowserWindow, windows }
})

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow }))

import { createDesktopLocalWindow } from '../src/local-window-policy.ts'

describe('Desktop local-window policy', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('constructs a dedicated sandbox and denies popup and WebView attachment', () => {
    const window = createDesktopLocalWindow({
      title: 'Local action',
      width: 480,
      partition: 'dsh-local-action',
      preferredSizeMode: true,
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
})
