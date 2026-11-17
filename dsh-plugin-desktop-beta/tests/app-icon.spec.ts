/** The app icon choice: the files it names, where it is saved, and what the native shell changes at once. */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { BrowserWindow } from 'electron'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, expect, it, vi } from 'vitest'
import { appIconDescription, appIconLabel, DESKTOP_APP_ICONS, isDesktopAppIcon } from '../src/app-icon.ts'
import { NextAppIconSetting } from '../src/client/app-icon-setting.tsx'
import { DEFAULT_PREFERENCES, SAFE_MODE_PREFERENCES, type DesktopState } from '../src/desktop-contract.ts'
import { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { appDockIcon, appTrayIcon, appWindowIcon, NativeDesktop } from '../src/native-desktop.ts'

const trays = vi.hoisted(() => [] as { images: string[] }[])
vi.mock('electron', () => ({
  Menu: { buildFromTemplate: (items: unknown) => items, setApplicationMenu() {} },
  Notification: class { static isSupported(): boolean { return false } },
  nativeTheme: { shouldUseDarkColors: false },
  nativeImage: {
    createFromPath: (path: string) => ({ path, isEmpty: () => false, setTemplateImage() {} }),
    createEmpty: () => ({ path: '', isEmpty: () => true }),
  },
  Tray: class {
    readonly images: string[]
    constructor(image: { path: string }) { this.images = [image.path]; trays.push(this) }
    setImage(image: { path: string }): void { this.images.push(image.path) }
    on(): void {}
    setToolTip(): void {}
    setTitle(): void {}
    setContextMenu(): void {}
    isDestroyed(): boolean { return false }
    destroy(): void {}
  },
}))

const root = fileURLToPath(new URL('..', import.meta.url))
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
const directories: string[] = []
afterEach(async () => {
  Object.defineProperty(process, 'platform', platform)
  trays.length = 0
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
})

const state = (appIcon: DesktopState['preferences']['appIcon']): DesktopState => ({
  selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [],
  preferences: { ...DEFAULT_PREFERENCES, appIcon }, features: { market: false, remoteControl: false },
  phase: 'ready', busy: false, failure: '', safeMode: false, home: '/fixture', platform: process.platform,
  version: '0.1.0-dev.0', trayAvailable: true, notificationsAvailable: true,
  browserUrl: null, lan: null, checkpoint: null, logs: '',
})

it('offers the default and classic icons and refuses anything else', () => {
  expect(DESKTOP_APP_ICONS).toEqual(['default', 'classic'])
  expect(DESKTOP_APP_ICONS.every(isDesktopAppIcon)).toBe(true)
  for (const value of ['Classic', 'whale-tail', '', null, undefined, 1]) expect(isDesktopAppIcon(value)).toBe(false)
  expect(DESKTOP_APP_ICONS.map(icon => appIconLabel(icon, true))).toEqual(['默认', '经典'])
  expect(DESKTOP_APP_ICONS.map(icon => appIconLabel(icon, false))).toEqual(['Default', 'Classic'])
  // Each platform says what the installed package keeps, so the default icon left there is no surprise.
  expect(appIconDescription('darwin', true)).toContain('访达')
  expect(appIconDescription('win32', true)).toContain('程序文件本身仍显示默认图标')
  expect(appIconDescription('linux', false)).toContain('AppImage changes only')
})

it('names a file icons:export committed for every choice on every platform', () => {
  for (const icon of DESKTOP_APP_ICONS) {
    expect(appWindowIcon(root, 'darwin', icon)).toBeUndefined()
    for (const target of ['win32', 'linux'] as const) expect(existsSync(appWindowIcon(root, target, icon)!), `${icon} ${target} frame`).toBe(true)
    for (const target of ['darwin', 'win32', 'linux'] as const) expect(existsSync(appTrayIcon(root, target, icon)), `${icon} ${target} tray`).toBe(true)
    expect(existsSync(appDockIcon(root, false, icon)!), `${icon} Dock`).toBe(true)
  }
  expect(appWindowIcon(root, 'win32', 'classic')).toBe(join(root, 'build', 'classic', 'app-icon.ico'))
  expect(appTrayIcon(root, 'darwin', 'classic')).toBe(join(root, 'assets', 'classic', 'tray-iconTemplate.png'))
  // A packaged default leaves the Dock to the bundle's layered icon; development has no bundle icon of ours.
  expect(appDockIcon(root, true, 'default')).toBeNull()
  expect(appDockIcon(root, false, 'default')).toBe(join(root, 'build', 'app-icon-mac.png'))
  expect(appDockIcon(root, true, 'classic')).toBe(join(root, 'build', 'classic', 'app-icon-mac.png'))
  // Native code reads the copies unpacked beside the archive.
  const archive = join(tmpdir(), 'Resources', 'app.asar')
  expect(appTrayIcon(archive, 'linux', 'classic')).toBe(join(`${archive}.unpacked`, 'assets', 'classic', 'tray-icon-blue.png'))
  // A dark system theme shows the whale tail's Dark rendition; the classic icon looks the same in both, with one image.
  expect(appWindowIcon(root, 'win32', 'default', true)).toBe(join(root, 'build', 'app-icon-dark.ico'))
  expect(appWindowIcon(root, 'linux', 'default', true)).toBe(join(root, 'build', 'app-icon-dark.png'))
  expect(appWindowIcon(root, 'win32', 'classic', true)).toBe(appWindowIcon(root, 'win32', 'classic'))
  expect(appWindowIcon(root, 'darwin', 'default', true)).toBeUndefined()
  for (const target of ['win32', 'linux'] as const) expect(existsSync(appWindowIcon(root, target, 'default', true)!), `${target} dark frame`).toBe(true)
})

it('saves the icon on its own, announces it at once and keeps Safe Mode on the default', async () => {
  const runtime = async (prepare?: (home: string) => Promise<void>) => {
    const home = await mkdtemp(join(tmpdir(), 'next-app-icon-'))
    directories.push(home)
    await prepare?.(home)
    const onChange = vi.fn()
    const value = new NextDesktopRuntime({
      home, root: home, executable: process.execPath, addresses: () => ['127.0.0.1'],
      certificate: async () => { throw new Error('No LAN certificate in this test') },
      onFailure() {}, onChange, onRestart() {}, onTerminal() {}, onNotification() {},
    })
    return { runtime: value, home, onChange }
  }
  const { runtime: normal, home, onChange } = await runtime()
  normal.initialize()
  expect(normal.state().preferences.appIcon).toBe('default')
  normal.saveAppIcon('classic')
  expect(normal.state().preferences.appIcon).toBe('classic')
  expect(onChange).toHaveBeenCalledTimes(1)
  // Setup saves it before any other preference exists; released builds never read this file.
  expect(JSON.parse(readFileSync(join(home, 'desktop-preferences-extra.json'), 'utf8'))).toEqual({ appIcon: 'classic' })
  expect(existsSync(join(home, 'desktop-preferences.json'))).toBe(false)
  expect(() => normal.saveAppIcon('whale-tail')).toThrow('Invalid app icon')
  expect(onChange).toHaveBeenCalledTimes(1)
  await normal.close()

  const { runtime: restarted } = await runtime(home => writeFile(join(home, 'desktop-preferences-extra.json'), JSON.stringify({ appIcon: 'classic' })))
  restarted.initialize()
  expect(restarted.preferences.appIcon).toBe('classic')
  await restarted.close()

  // A broken preference file opens recovery, but the shortcuts keep the icon saved apart from it.
  const { runtime: broken } = await runtime(async home => {
    await writeFile(join(home, 'desktop-preferences.json'), '{broken')
    await writeFile(join(home, 'desktop-preferences-extra.json'), JSON.stringify({ appIcon: 'classic' }))
  })
  broken.initialize()
  expect(broken.state().failureStage).toBe('runtime-bootstrap')
  expect(broken.preferences.appIcon).toBe('classic')
  await broken.close()

  const { runtime: safe } = await runtime(home => writeFile(join(home, 'desktop-preferences-extra.json'), JSON.stringify({ appIcon: 'classic' })))
  safe.safeMode = true
  safe.initialize()
  expect(SAFE_MODE_PREFERENCES.appIcon).toBe('default')
  expect(safe.preferences.appIcon).toBe('default')
  expect(() => safe.saveAppIcon('classic')).toThrow('fixed in Safe Mode')
  await safe.close()
})

for (const target of ['darwin', 'win32'] as const) {
  it(`shows a saved choice in the ${target === 'darwin' ? 'Dock' : 'window frames'} and the tray at once, and leaves an unchanged one alone`, () => {
    Object.defineProperty(process, 'platform', { ...platform, value: target })
    let current = state('default')
    let dark = false
    const dock = { setIcon: vi.fn() }
    const open = { isDestroyed: () => false, setIcon: vi.fn() }
    const closed = { isDestroyed: () => true, setIcon: vi.fn() }
    const late = { isDestroyed: () => false, setIcon: vi.fn() }
    const warn = vi.fn()
    const installed = vi.fn()
    const native = new NativeDesktop({
      root, language: () => 'en', state: () => current, window: () => undefined, show() {}, run() {}, warn,
      appIcon: () => current.preferences.appIcon, dark: () => dark, packaged: true, windows: () => [open, closed] as unknown as BrowserWindow[],
      dock: () => target === 'darwin' ? dock : undefined, installed,
    })
    const tray = target === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png'
    native.createTray()
    expect(trays).toHaveLength(1)
    expect(trays[0]!.images).toEqual([join(root, 'assets', tray)])
    // Each launch hands the saved choice on once, so shortcuts an installer recreated follow it again.
    expect(installed.mock.calls).toEqual([['default', false]])
    if (target === 'win32') expect(open.setIcon).toHaveBeenCalledExactlyOnceWith(join(root, 'build', 'app-icon.ico'))
    // A launch on the default leaves the Dock to the bundle's own layered icon, as releases before the choice did.
    expect(dock.setIcon).not.toHaveBeenCalled()
    open.setIcon.mockClear()

    current = state('classic')
    native.refresh()
    expect(trays[0]!.images.at(-1)).toBe(join(root, 'assets', 'classic', tray))
    if (target === 'darwin') {
      expect(dock.setIcon).toHaveBeenLastCalledWith(join(root, 'build', 'classic', 'app-icon-mac.png'))
      expect(open.setIcon).not.toHaveBeenCalled()
    } else {
      expect(open.setIcon).toHaveBeenCalledExactlyOnceWith(join(root, 'build', 'classic', 'app-icon.ico'))
      expect(closed.setIcon).not.toHaveBeenCalled()
      expect(dock.setIcon).not.toHaveBeenCalled()
    }
    native.decorateWindow(late as unknown as BrowserWindow)
    if (target === 'win32') expect(late.setIcon).toHaveBeenCalledExactlyOnceWith(join(root, 'build', 'classic', 'app-icon.ico'))
    else expect(late.setIcon).not.toHaveBeenCalled()

    const changes = trays[0]!.images.length
    native.refresh()
    expect(trays[0]!.images).toHaveLength(changes)
    expect(installed.mock.calls).toEqual([['default', false], ['classic', false]])

    current = state('default')
    installed.mockImplementationOnce(() => { throw new Error('Fixture: shortcuts unavailable') })
    native.refresh()
    expect(installed.mock.calls).toEqual([['default', false], ['classic', false], ['default', false]])
    expect(warn).toHaveBeenCalledExactlyOnceWith(new Error('Fixture: shortcuts unavailable'))
    warn.mockClear()
    expect(trays[0]!.images.at(-1)).toBe(join(root, 'assets', tray))
    // An empty image hands the Dock back to the bundle's own layered icon.
    if (target === 'darwin') expect(dock.setIcon).toHaveBeenLastCalledWith(expect.objectContaining({ path: '' }))
    else expect(open.setIcon).toHaveBeenLastCalledWith(join(root, 'build', 'app-icon.ico'))

    // A dark system theme shows the Dark rendition in window frames and hands it on; the tray glyph and the Dock stay.
    const images = trays[0]!.images.length
    const docked = dock.setIcon.mock.calls.length
    open.setIcon.mockClear()
    dark = true
    native.appearanceChanged()
    expect(installed.mock.calls.at(-1)).toEqual(['default', true])
    if (target === 'win32') expect(open.setIcon).toHaveBeenCalledExactlyOnceWith(join(root, 'build', 'app-icon-dark.ico'))
    else expect(open.setIcon).not.toHaveBeenCalled()
    expect(trays[0]!.images).toHaveLength(images)
    expect(dock.setIcon).toHaveBeenCalledTimes(docked)
    native.decorateWindow(late as unknown as BrowserWindow)
    if (target === 'win32') expect(late.setIcon).toHaveBeenLastCalledWith(join(root, 'build', 'app-icon-dark.ico'))
    // A theme event without a change, such as an accent color, changes nothing.
    const handed = installed.mock.calls.length
    native.appearanceChanged()
    expect(installed).toHaveBeenCalledTimes(handed)
    expect(warn).not.toHaveBeenCalled()
    native.close()
  })
}

it('lists both icons in Desktop settings with the saved one checked, and holds Safe Mode on the default', () => {
  const render = (appIcon: 'default' | 'classic', safeMode: boolean, language = 'zh-CN') => renderToStaticMarkup(createElement(NextAppIconSetting, {
    state: { preferences: { ...DEFAULT_PREFERENCES, appIcon }, platform: 'win32', safeMode }, language, run: vi.fn(async () => {}),
  }))
  const radios = (html: string) => [...html.matchAll(/<button([^>]*)><picture>(?:<source srcset="([^"]*)" media="\(prefers-color-scheme: dark\)"\/>)?<img src="([^"]*)"[^>]*\/><\/picture><span>([^<]*)<\/span><\/button>/giu)]
    .map(([, attributes, dark, preview, label]) => ({ label, preview, dark, checked: attributes!.includes('aria-checked="true"'), disabled: attributes!.includes('disabled') }))
  const saved = render('classic', false)
  expect(saved).toContain('应用图标')
  expect(saved).toContain(appIconDescription('win32', true))
  expect(saved).toMatch(/role="radiogroup" aria-labelledby="[^"]+"/u)
  // A dark theme shows the whale tail's Dark rendition, as the system does; the classic icon has one image.
  expect(radios(saved)).toEqual([
    { label: '默认', preview: expect.stringMatching(/\/build\/app-icon-preview\.png$/u), dark: expect.stringMatching(/\/build\/app-icon-preview-dark\.png$/u), checked: false, disabled: false },
    { label: '经典', preview: expect.stringMatching(/\/build\/classic\/app-icon-preview\.png$/u), dark: undefined, checked: true, disabled: false },
  ])
  const safe = render('default', true, 'en-US')
  expect(safe).toContain('Safe Mode always shows the default icon.')
  expect(radios(safe).map(({ label, checked, disabled }) => ({ label, checked, disabled }))).toEqual([
    { label: 'Default', checked: true, disabled: true }, { label: 'Classic', checked: false, disabled: true },
  ])
})
