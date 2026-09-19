import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  const windows: Array<{
    options: unknown
    loadURL: ReturnType<typeof vi.fn>
    show: ReturnType<typeof vi.fn>
    focus: ReturnType<typeof vi.fn>
    restore: ReturnType<typeof vi.fn>
    close: ReturnType<typeof vi.fn>
    isDestroyed: ReturnType<typeof vi.fn>
    isMinimized: ReturnType<typeof vi.fn>
    loadFile: ReturnType<typeof vi.fn>
    once: ReturnType<typeof vi.fn>
    on: ReturnType<typeof vi.fn>
    removeMenu: ReturnType<typeof vi.fn>
    webContents: Record<string, ReturnType<typeof vi.fn>>
  }> = []
  class BrowserWindow {
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn(),
      off: vi.fn(),
      executeJavaScript: vi.fn(async () => {}),
    }
    readonly isDestroyed = vi.fn(() => false)
    readonly isMinimized = vi.fn(() => false)
    readonly show = vi.fn()
    readonly focus = vi.fn()
    readonly restore = vi.fn()
    readonly close = vi.fn()
    readonly loadFile = vi.fn(async () => {})
    readonly loadURL = vi.fn(async () => {})
    readonly once = vi.fn()
    readonly on = vi.fn()
    readonly removeMenu = vi.fn()
    accessibleTitle = ''
    constructor(readonly options: unknown) {
      windows.push(this as unknown as typeof windows[number])
    }
  }
  return {
    app: {
      isHidden: vi.fn(() => false),
      show: vi.fn(),
    },
    BrowserWindow,
    windows,
  }
})

vi.mock('electron', () => ({ app: electron.app, BrowserWindow: electron.BrowserWindow }))

import {
  ProfileCreateWindow,
  parseProfileCreateAction,
} from '../src/profile-create-window.ts'
import { auxiliaryWindowHasCustomFrame } from '../src/auxiliary-window-options.ts'

describe('ProfileCreateWindow', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('parses only local submit and cancel actions', () => {
    expect(parseProfileCreateAction('dsh-profile-create://submit?name=work')).toEqual({ action: 'submit', name: 'work' })
    expect(parseProfileCreateAction('dsh-profile-create://cancel')).toEqual({ action: 'cancel' })
    expect(parseProfileCreateAction('https://example.com/submit?name=work')).toBeUndefined()
    expect(parseProfileCreateAction('dsh-profile-create://submit?name=work&command=bad')).toBeUndefined()
  })

  it('creates one isolated window and focuses it on repeated opens', () => {
    const onSubmit = vi.fn(async () => {})
    const creator = new ProfileCreateWindow({ locale: 'en', onSubmit })
    creator.open()
    creator.open()
    expect(electron.windows).toHaveLength(1)
    expect(electron.windows[0]?.show).toHaveBeenCalledOnce()
    expect(electron.windows[0]?.focus).toHaveBeenCalledOnce()
    expect(electron.windows[0]?.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]native-ui[\\/]profile-create\.html$/u),
      {
        query: {
          locale: 'en',
          platform: process.platform,
          frame: String(auxiliaryWindowHasCustomFrame()),
        },
      },
    )
    expect(electron.windows[0]?.options).toEqual(expect.objectContaining({
      width: 480,
      height: 360,
      minWidth: 420,
      minHeight: 330,
      webPreferences: expect.objectContaining({
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        spellcheck: false,
        partition: 'dsh-profile-create',
      }),
    }))
    const webContents = electron.windows[0]!.webContents
    const deny = webContents.setWindowOpenHandler?.mock.calls[0]?.[0] as (() => unknown) | undefined
    expect(deny?.()).toEqual({ action: 'deny' })
    const attach = webContents.on?.mock.calls
      .find(([event]) => event === 'will-attach-webview')?.[1] as ((event: { preventDefault(): void }) => void) | undefined
    const attachEvent = { preventDefault: vi.fn() }
    attach?.(attachEvent)
    expect(attachEvent.preventDefault).toHaveBeenCalledOnce()
    expect(electron.windows[0]?.options).not.toHaveProperty('modal')
    expect(electron.windows[0]?.options).not.toHaveProperty('parent')
  })

  it('restores the hidden macOS application before showing the first profile window', () => {
    vi.spyOn(process, 'platform', 'get').mockReturnValue('darwin')
    electron.app.isHidden.mockReturnValue(true)
    const creator = new ProfileCreateWindow({ locale: 'en', onSubmit: async () => {} })
    creator.open()
    const window = electron.windows[0]
    window?.isMinimized.mockReturnValue(true)
    const ready = window?.once.mock.calls.find(([event]) => event === 'ready-to-show')?.[1]

    ready()

    expect(electron.app.show).toHaveBeenCalledOnce()
    expect(window?.restore).toHaveBeenCalledOnce()
    expect(window?.show).toHaveBeenCalledOnce()
    expect(window?.focus).toHaveBeenCalledOnce()
  })

  it('does not access destroyed web contents from the closed callback', () => {
    const creator = new ProfileCreateWindow({ locale: 'en', onSubmit: async () => {} })
    creator.open()
    const window = electron.windows[0]
    const closed = window?.on.mock.calls.find(([event]) => event === 'closed')?.[1] as (() => void) | undefined
    expect(closed).toBeTypeOf('function')
    if (window !== undefined) {
      Object.defineProperty(window, 'webContents', {
        configurable: true,
        get: () => { throw new TypeError('Object has been destroyed') },
      })
    }
    expect(() => closed?.()).not.toThrow()
  })

  it('notifies cancellation exactly once for an explicit cancel followed by close', () => {
    const onCancel = vi.fn()
    const creator = new ProfileCreateWindow({ locale: 'en', onSubmit: async () => {}, onCancel })
    creator.open()
    const window = electron.windows[0]
    const navigate = window?.webContents.on?.mock.calls
      .find(([event]) => event === 'will-navigate')?.[1] as ((event: { preventDefault(): void }, href: string) => void) | undefined
    const closed = window?.on.mock.calls.find(([event]) => event === 'closed')?.[1] as (() => void) | undefined

    navigate?.({ preventDefault: vi.fn() }, 'dsh-profile-create://cancel')
    closed?.()

    expect(onCancel).toHaveBeenCalledOnce()
    expect(window?.close).toHaveBeenCalledOnce()
  })

  it('notifies cancellation when the native window is closed', () => {
    const onCancel = vi.fn()
    const creator = new ProfileCreateWindow({ locale: 'en', onSubmit: async () => {}, onCancel })
    creator.open()
    const closed = electron.windows[0]?.on.mock.calls
      .find(([event]) => event === 'closed')?.[1] as (() => void) | undefined

    closed?.()

    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('does not report cancellation after a successful submission', async () => {
    const onSubmit = vi.fn(async () => {})
    const onCancel = vi.fn()
    const creator = new ProfileCreateWindow({ locale: 'en', onSubmit, onCancel })
    creator.open()
    const window = electron.windows[0]
    const navigate = window?.webContents.on?.mock.calls
      .find(([event]) => event === 'will-navigate')?.[1] as ((event: { preventDefault(): void }, href: string) => void) | undefined
    const closed = window?.on.mock.calls.find(([event]) => event === 'closed')?.[1] as (() => void) | undefined

    navigate?.({ preventDefault: vi.fn() }, 'dsh-profile-create://submit?name=new-work')
    await vi.waitFor(() => { expect(window?.close).toHaveBeenCalledOnce() })
    closed?.()

    expect(onSubmit).toHaveBeenCalledWith('new-work')
    expect(onCancel).not.toHaveBeenCalled()
  })
})
