import { beforeEach, describe, expect, it, vi } from 'vitest'

const electron = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void
  const windows: BrowserWindow[] = []
  class BrowserWindow {
    readonly listeners = new Map<string, Listener>()
    readonly onceListeners = new Map<string, Listener>()
    readonly webListeners = new Map<string, Listener>()
    accessibleTitle = ''
    readonly isDestroyed = vi.fn(() => false)
    readonly destroy = vi.fn()
    readonly removeMenu = vi.fn()
    readonly loadFile = vi.fn(async (
      _path: string,
      _options?: { readonly query: { readonly state: string } },
    ) => {})
    readonly webContents = {
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: Listener) => { this.webListeners.set(event, listener) }),
    }
    readonly once = vi.fn((event: string, listener: Listener) => { this.onceListeners.set(event, listener) })
    readonly on = vi.fn((event: string, listener: Listener) => { this.listeners.set(event, listener) })
    constructor(readonly options: Electron.BrowserWindowConstructorOptions) { windows.push(this) }
  }
  return { BrowserWindow, windows }
})

vi.mock('electron', () => ({ BrowserWindow: electron.BrowserWindow }))
vi.mock('../src/electron-reveal.ts', () => ({ revealApplication: vi.fn() }))

import {
  DesktopProfileSelectionWindow,
  parseDesktopProfileSelectionAction,
} from '../src/profile-selection-window.ts'

describe('Desktop Profile selection window', () => {
  beforeEach(() => {
    electron.windows.length = 0
    vi.clearAllMocks()
  })

  it('accepts only bounded local Profile actions', () => {
    expect(parseDesktopProfileSelectionAction('dsh-profile-selector://cancel')).toEqual({ action: 'cancel' })
    expect(parseDesktopProfileSelectionAction('dsh-profile-selector://create')).toEqual({ action: 'create' })
    expect(parseDesktopProfileSelectionAction('dsh-profile-selector://restart')).toEqual({ action: 'restart' })
    expect(parseDesktopProfileSelectionAction('dsh-profile-selector://switch?name=work')).toEqual({ action: 'switch', name: 'work' })
    expect(parseDesktopProfileSelectionAction('dsh-profile-selector://switch?name=../bad')).toBeUndefined()
    expect(parseDesktopProfileSelectionAction('dsh-profile-selector://switch?name=work&token=bad')).toBeUndefined()
    expect(parseDesktopProfileSelectionAction('https://profile-selector/switch?name=work')).toBeUndefined()
  })

  it('switches an existing Profile and waits for an explicit restart', async () => {
    let selected = 'desktop'
    const actions = {
      token: 'profile-action-token',
      list: () => ['desktop', 'work'].map(name => ({ name, current: name === selected, selectable: true })),
      switchProfile: vi.fn(async (name: string, token: string) => { expect(token).toBe('profile-action-token'); selected = name }),
      openCreator: vi.fn(),
    }
    const selector = new DesktopProfileSelectionWindow({ locale: 'zh', profileActions: actions })
    const result = selector.run()
    await vi.waitFor(() => { expect(electron.windows[0]?.loadFile).toHaveBeenCalled() })
    const window = electron.windows[0]!
    expect(window.options).toEqual(expect.objectContaining({ closable: false, frame: false }))
    expect(window.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/[\\/]native-ui[\\/]profile-selector\.html$/u),
      expect.objectContaining({ query: expect.objectContaining({ locale: 'zh' }) }),
    )

    const event = { preventDefault: vi.fn() }
    window.webListeners.get('will-navigate')?.(event, 'dsh-profile-selector://switch?name=work')

    await vi.waitFor(() => { expect(window.loadFile).toHaveBeenCalledTimes(3) })
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(actions.switchProfile).toHaveBeenCalledWith('work', 'profile-action-token')
    expect(window.destroy).not.toHaveBeenCalled()
    const selectionRender = window.loadFile.mock.calls.at(-1)?.[1]
    if (selectionRender === undefined) throw new Error('Profile selector state was not rendered')
    const selectionState = JSON.parse(Buffer.from(
      selectionRender.query.state,
      'base64url',
    ).toString('utf8')) as { readonly restartReady: boolean; readonly notice?: { readonly tone: string; readonly title: string; readonly body: string }; readonly profiles: readonly { readonly name: string; readonly current: boolean }[] }
    expect(selectionState.restartReady).toBe(true)
    expect(selectionState.profiles.find(profile => profile.name === 'work')?.current).toBe(true)
    expect(selectionState.notice).toEqual({
      tone: 'success',
      title: 'work',
      body: '已设为当前 Profile。请重启 DSH Desktop 以使用该 Profile。',
    })

    window.webListeners.get('will-navigate')?.({ preventDefault: vi.fn() }, 'dsh-profile-selector://restart')
    await expect(result).resolves.toBe('restart')
    expect(window.destroy).toHaveBeenCalledOnce()
  })

  it('keeps a newly created and selected Profile open until the user restarts', async () => {
    let selected = 'desktop'
    const actions = {
      token: 'profile-action-token',
      list: () => ['desktop', 'fresh'].map(name => ({ name, current: name === selected, selectable: true })),
      switchProfile: vi.fn(),
      openCreator: vi.fn(async () => { selected = 'fresh' }),
    }
    const selector = new DesktopProfileSelectionWindow({ locale: 'zh', profileActions: actions })
    const result = selector.run()
    await vi.waitFor(() => { expect(electron.windows[0]?.loadFile).toHaveBeenCalledTimes(1) })
    const window = electron.windows[0]!

    window.webListeners.get('will-navigate')?.({ preventDefault: vi.fn() }, 'dsh-profile-selector://create')

    await vi.waitFor(() => { expect(window.loadFile).toHaveBeenCalledTimes(3) })
    expect(actions.openCreator).toHaveBeenCalledOnce()
    expect(window.destroy).not.toHaveBeenCalled()
    const selectionRender = window.loadFile.mock.calls.at(-1)?.[1]
    if (selectionRender === undefined) throw new Error('Profile selector state was not rendered')
    const selectionState = JSON.parse(Buffer.from(
      selectionRender.query.state,
      'base64url',
    ).toString('utf8')) as { readonly restartReady: boolean; readonly notice?: { readonly tone: string; readonly title: string; readonly body: string }; readonly profiles: readonly { readonly name: string; readonly current: boolean }[] }
    expect(selectionState.restartReady).toBe(true)
    expect(selectionState.profiles.find(profile => profile.name === 'fresh')?.current).toBe(true)
    expect(selectionState.notice).toEqual({
      tone: 'success',
      title: 'fresh',
      body: '已设为当前 Profile。请重启 DSH Desktop 以使用该 Profile。',
    })

    window.webListeners.get('will-navigate')?.({ preventDefault: vi.fn() }, 'dsh-profile-selector://restart')
    await expect(result).resolves.toBe('restart')
  })

  it('returns to the Profile selector when new-Profile creation is cancelled', async () => {
    const actions = {
      token: 'profile-action-token',
      list: () => [{ name: 'desktop', current: true, selectable: true }],
      switchProfile: vi.fn(),
      openCreator: vi.fn(async () => {}),
    }
    const selector = new DesktopProfileSelectionWindow({ locale: 'en', profileActions: actions })
    const result = selector.run()
    await vi.waitFor(() => { expect(electron.windows[0]?.loadFile).toHaveBeenCalledTimes(1) })
    const window = electron.windows[0]!

    window.webListeners.get('will-navigate')?.({ preventDefault: vi.fn() }, 'dsh-profile-selector://create')
    await vi.waitFor(() => { expect(window.loadFile).toHaveBeenCalledTimes(3) })
    expect(actions.openCreator).toHaveBeenCalledOnce()
    window.webListeners.get('will-navigate')?.({ preventDefault: vi.fn() }, 'dsh-profile-selector://cancel')

    await expect(result).resolves.toBe('cancel')
  })
})
