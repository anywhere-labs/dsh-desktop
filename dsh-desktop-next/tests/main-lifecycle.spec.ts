/** Native lifecycle contracts exercised without starting Electron or a Host. */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES, SAFE_MODE_PREFERENCES } from '../src/desktop-contract.ts'
import type { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { NextProfiles } from '../src/profiles.ts'
import { NextRecovery } from '../src/recovery.ts'

const originalMonitors = new Set(process.listeners('uncaughtExceptionMonitor'))
afterEach(() => { for (const listener of process.listeners('uncaughtExceptionMonitor')) if (!originalMonitors.has(listener)) process.off('uncaughtExceptionMonitor', listener) })

const fixture = vi.hoisted(() => ({
  windows: [] as any[], trays: [] as any[], handlers: new Map<string, (...args: any[]) => any>(),
  load: vi.fn(), report: vi.fn(), plugin: vi.fn(), pluginDone: vi.fn(), diagnosticAppend: vi.fn(),
  terminalTarget: vi.fn(), openTerminal: vi.fn(), popup: vi.fn(), registerSchemes: vi.fn(),
  crashStart: vi.fn(), memory: { start: vi.fn(), stop: vi.fn(), settle: vi.fn(), incident: vi.fn(), hostMemory: vi.fn(), hostExited: vi.fn() },
  stop: vi.fn(async () => {}),
  close: vi.fn(async () => {}), start: vi.fn(async () => {}), preferences: { closeToTray: true, browserAccess: false, networkExposure: 'loopback' as 'loopback' | 'lan' },
  phase: 'ready' as 'ready' | 'error',
  needsOnboarding: false, corruptProfile: false, restart: vi.fn(), hostReady: false,
  appPaths: new Map<string, string>(), lockPaths: [] as string[], ownsInstance: true,
  locationRoot: '',
  runtimeOptions: undefined as ConstructorParameters<typeof NextDesktopRuntime>[0] | undefined,
  runtime: undefined as { actionFailure: string } | undefined,
  failureReportFile: vi.fn(async (): Promise<string | undefined> => undefined),
  onPermission: undefined as ConstructorParameters<typeof NextDesktopRuntime>[0]['onPermission'],
  startupElevation: { relaunched: false, state: {} } as ReturnType<typeof import('../src/windows-elevation.ts').deElevateAtStartup>,
  elevation: undefined as import('../src/windows-elevation.ts').WindowsElevation | undefined,
}))
// Token queries and the de-elevated restart are Win32 calls; the lifecycle only sees their results.
vi.mock('../src/windows-elevation.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/windows-elevation.ts')>(),
  deElevateAtStartup: () => fixture.startupElevation,
  windowsElevation: () => { if (!fixture.elevation) throw new Error('No token fixture'); return fixture.elevation },
}))
// Every launch gets its own anchor for the in-app data-directory choice and the last-launch record.
vi.mock('../src/data-directory.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/data-directory.ts')>(),
  dataDirectoryLocationRoot: () => fixture.locationRoot,
}))
// The macOS answer comes from a subprocess, which would outlive a test and report into the next one.
vi.mock('../src/system-proxy-configuration.ts', () => ({ readSystemProxyConfiguration: async () => 'unknown' }))
vi.mock('../src/desktop-runtime.ts', async () => { const { NextProfiles } = await import('../src/profiles.ts'); const { NextRecovery } = await import('../src/recovery.ts'); return { NextDesktopRuntime: class {
  preferences = { ...DEFAULT_PREFERENCES }
  busy = false
  selected = 'desktop'
  safeMode = false
  recoveryMode = false
  backend = { stop: fixture.stop, get host() { return fixture.hostReady ? {} : undefined }, get state() { return { phase: fixture.phase } } }
  startup = Promise.resolve()
  get auth() { return fixture.hostReady ? { url: 'http://127.0.0.1:1234/' } : undefined }
  async injections() { return [] }
  profiles: NextProfiles
  recovery: import('../src/recovery.ts').NextRecovery
  diagnostics = { append: fixture.diagnosticAppend, flush: vi.fn(), hostChunk: vi.fn(), record: fixture.diagnosticAppend, operation: vi.fn(() => vi.fn()), begin: vi.fn(), end: vi.fn(), pendingOperations: vi.fn(() => []) }
  memory = fixture.memory
  actionFailure = ''
  failureReportFile = fixture.failureReportFile
  constructor(options: ConstructorParameters<typeof NextDesktopRuntime>[0]) {
    fixture.runtimeOptions = options
    fixture.runtime = this
    fixture.preferences = this.preferences; fixture.onPermission = options.onPermission
    this.profiles = new NextProfiles(options.home)
    this.recovery = new NextRecovery(this.profiles)
    this.profiles.ensure('desktop')
    if (!fixture.needsOnboarding) this.profiles.finishOnboarding('desktop')
    if (fixture.corruptProfile) writeFileSync(join(this.profiles.directory('desktop'), 'package.json'), '{broken')
  }
  initialize() { if (this.safeMode) Object.assign(this.preferences, SAFE_MODE_PREFERENCES) }
  writePreferences(next: typeof DEFAULT_PREFERENCES) { Object.assign(this.preferences, next) }
  start = fixture.start
  close = fixture.close
  async restart(change: () => Promise<void>) { await fixture.stop(); await change(); this.recoveryMode = false; await fixture.restart() }
  terminalTarget = fixture.terminalTarget
  browserLinks() { return { localUrl: null, lanUrls: [] } }
  state() { return { selected: 'desktop', profiles: ['desktop'], unavailableProfiles: [], features: fixture.corruptProfile ? { remoteControl: false, market: true } : this.profiles.features(this.selected),
    preferences: this.preferences, phase: this.recoveryMode ? 'recovery' : fixture.phase, busy: this.busy, failure: 'Fixture Host failure', safeMode: this.safeMode,
    home: 'temporary', browserUrl: null, lan: null, checkpoint: null, logs: '' } }
  report = fixture.report
} } })
vi.mock('../src/extensions.ts', async importOriginal => {
  const { EventEmitter } = await import('node:events')
  return { ...await importOriginal<typeof import('../src/extensions.ts')>(), createPackageRunner: () => ({
    runPlugin: (...args: unknown[]) => { fixture.plugin(...args); return { stdout: new EventEmitter(), stderr: new EventEmitter(), done: fixture.pluginDone() } },
    dispose: async () => {},
  }) }
})
vi.mock('../src/desktop-terminal.ts', async importOriginal => ({ ...await importOriginal<typeof import('../src/desktop-terminal.ts')>(), openDesktopTerminal: fixture.openTerminal }))
vi.mock('electron', async () => {
  const { EventEmitter } = await import('node:events')
  const app = Object.assign(new EventEmitter(), {
    setName() {}, setPath: (name: string, path: string) => fixture.appPaths.set(name, path), getPath: (name: string) => fixture.appPaths.get(name) ?? process.env.DSH_DESKTOP_NEXT_HOME, getLocale: () => 'en-US', getPreferredSystemLanguages: () => ['zh-Hans-CN', 'en-US'], isReady: () => true, whenReady: async () => {},
    requestSingleInstanceLock: () => { fixture.lockPaths.push(fixture.appPaths.get('userData')!); return fixture.ownsInstance }, exit: vi.fn(), relaunch: vi.fn(), focus: vi.fn(), quit: vi.fn(() => app.emit('before-quit', { preventDefault() {} })),
    getAppMetrics: () => [],
  })
  class BrowserWindow extends EventEmitter {
    visible = false
    loadedUrls: string[] = []
    webContents = Object.assign(new EventEmitter(), { id: fixture.windows.length + 1,
      mainFrame: { url: '' }, getURL: () => this.webContents.mainFrame.url, setWindowOpenHandler() {}, send: vi.fn(), isDestroyed: () => false,
      setIgnoreMenuShortcuts() {}, isFocused: () => true, executeJavaScript: vi.fn(async () => true) })
    size: { width: number, height: number }
    minSize: { width: number, height: number }
    position: { x: number, y: number }
    maximized = false
    constructor(readonly options: any) {
      super()
      this.size = { width: options.width, height: options.height }
      this.minSize = { width: options.minWidth, height: options.minHeight }
      this.position = { x: options.x ?? 0, y: options.y ?? 0 }
      fixture.windows.push(this)
    }
    destroyed = false
    isDestroyed() { return this.destroyed }
    isMinimized() { return false }
    isFocused() { return false }
    isVisible() { return this.visible }
    isFullScreen() { return false }
    isMaximized() { return this.maximized }
    maximize() { this.maximized = true; this.visible = true; this.emit('maximize') }
    getNormalBounds() { return { ...this.position, ...this.size } }
    show() { this.visible = true }
    hide() { this.visible = false }
    focus() {}
    setSize(width: number, height: number) { this.size = { width, height } }
    setResizable() {}
    setMinimumSize(width: number, height: number) { this.minSize = { width, height } }
    close() { this.destroy() }
    destroy() { this.destroyed = true; this.visible = false; this.emit('closed') }
    setVibrancy() {}
    setBackgroundColor() {}
    setBackgroundMaterial() {}
    setTitleBarOverlay = vi.fn()
    setProgressBar = vi.fn()
    async loadURL(url: string) {
      this.webContents.mainFrame.url = url; this.loadedUrls.push(url)
      this.webContents.emit('did-start-navigation', {}, url, false, true)
      await fixture.load(this, url)
      if (!this.destroyed) this.webContents.emit('did-finish-load')
    }
  }
  class Tray extends EventEmitter {
    destroyed = false
    menu: any
    tooltip = ''
    constructor() { super(); fixture.trays.push(this) }
    isDestroyed() { return this.destroyed }
    setToolTip(value: string) { this.tooltip = value }
    setTitle() {}
    setContextMenu(menu: any) { this.menu = menu }
    destroy() { this.destroyed = true }
  }
  return { app, BrowserWindow, Tray, autoUpdater: Object.assign(new EventEmitter(), { setFeedURL: vi.fn(), checkForUpdates: vi.fn(), quitAndInstall: vi.fn() }), net: { fetch: vi.fn() },
    crashReporter: { start: fixture.crashStart },
    Notification: class { static isSupported() { return false } },
    clipboard: {}, dialog: { showMessageBox: vi.fn(async () => ({ response: 0 })), showMessageBoxSync: vi.fn(() => 0), showOpenDialog: vi.fn(async () => ({ canceled: true, filePaths: [] })) }, shell: { showItemInFolder: vi.fn() }, safeStorage: {}, nativeTheme: { shouldUseDarkColors: true, on() {} },
    nativeImage: { createFromPath: () => ({ isEmpty: () => false, setTemplateImage() {} }) },
    // Templates stay plain arrays for tray assertions; the popup spy is non-enumerable.
    Menu: { buildFromTemplate: (items: any) => Object.defineProperty(items, 'popup', { value: (options: unknown) => fixture.popup(items, options), configurable: true }), setApplicationMenu() {} },
    protocol: { registerSchemesAsPrivileged: fixture.registerSchemes, handle() {} },
    session: { defaultSession: { webRequest: { onBeforeSendHeaders() {} }, setPermissionCheckHandler() {}, setPermissionRequestHandler() {}, setDisplayMediaRequestHandler() {}, on() {} } },
    systemPreferences: { getMediaAccessStatus: () => 'not-determined', askForMediaAccess: vi.fn(async () => false), isTrustedAccessibilityClient: () => false },
    screen: { getDisplayMatching: () => ({ workArea: { x: 0, y: 25, width: 1728, height: 1092 } }) },
    desktopCapturer: { getSources: vi.fn(async () => []) },
    ipcMain: { removeHandler: (name: string) => fixture.handlers.delete(name), handle: (name: string, action: (...args: any[]) => any) => fixture.handlers.set(name, action), on: (name: string, action: (...args: any[]) => any) => fixture.handlers.set(name, action) },
  }
})

beforeEach(async () => {
  vi.resetModules()
  fixture.windows.length = 0; fixture.trays.length = 0; fixture.handlers.clear()
  fixture.appPaths.clear(); fixture.lockPaths.length = 0; fixture.ownsInstance = true; fixture.runtimeOptions = undefined
  fixture.runtime = undefined; fixture.failureReportFile.mockReset().mockResolvedValue(undefined)
  fixture.locationRoot = mkdtempSync(join(tmpdir(), 'next-location-root-'))
  fixture.phase = 'ready'
  fixture.needsOnboarding = false; fixture.corruptProfile = false; fixture.restart.mockReset(); fixture.hostReady = false
  fixture.plugin.mockReset(); fixture.pluginDone.mockReset().mockResolvedValue({ exitCode: 0 });
  fixture.load.mockReset(); fixture.report.mockReset(); fixture.diagnosticAppend.mockReset();
  fixture.terminalTarget.mockReset(); fixture.openTerminal.mockClear(); fixture.popup.mockClear(); fixture.registerSchemes.mockClear()
  fixture.crashStart.mockReset(); for (const action of Object.values(fixture.memory)) action.mockReset()
  fixture.stop.mockReset().mockResolvedValue(undefined); fixture.start.mockClear(); fixture.close.mockReset().mockResolvedValue(undefined)
  fixture.startupElevation = { relaunched: false, state: {} }; fixture.elevation = undefined
  const { app, autoUpdater, dialog, shell } = await import('electron')
  autoUpdater.removeAllListeners()
  app.removeAllListeners()
  vi.mocked(app.relaunch).mockClear()
  vi.mocked(app.quit).mockClear()
  vi.mocked(app.exit).mockClear()
  vi.mocked(dialog.showMessageBoxSync).mockClear()
  vi.mocked(shell.showItemInFolder).mockClear()
})

afterEach(() => {
  for (const window of fixture.windows) if (!window.destroyed) window.destroy()
  rmSync(fixture.locationRoot, { recursive: true, force: true })
})

it('repairs a crashed renderer and fences old document reports while preserving its Host', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-renderer-repair-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.hostReady = true
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    const sender = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const boot = fixture.handlers.get('dsh-next:boot')!
    const report = fixture.handlers.get('dsh-next:renderer-status')!
    vi.useFakeTimers({ shouldClearNativeTimers: true })
    const first = await boot(sender)
    report(sender, first.documentId, 'healthy')
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer', event: 'renderer.navigation', fields: { cause: 'open', initiator: 'none' } }))
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer', event: 'renderer.ready', fields: { cause: 'open' } }))
    main.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 })
    main.webContents.emit('did-fail-load', {}, -2, 'same crash', 'dsh-app://app/', true)
    await vi.advanceTimersByTimeAsync(0)
    expect(main.loadedUrls).toHaveLength(2)
    expect(fixture.stop).not.toHaveBeenCalled()
    expect(fixture.report).not.toHaveBeenCalled()
    expect(fixture.start).toHaveBeenCalledOnce()
    expect(fixture.windows).toHaveLength(1)
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({
      source: 'renderer', event: 'process-gone', fields: { reason: 'crashed', exitCode: -1073741819 },
    }))
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer', event: 'renderer.navigation', fields: { cause: 'recovery', initiator: 'none' } }))
    const second = await boot(sender)
    expect(second.documentId).not.toBe(first.documentId)
    fixture.diagnosticAppend.mockClear()
    report(sender, first.documentId, 'healthy')
    fixture.handlers.get('dsh-next:failed')!(sender, 'late old boot failure', first.documentId)
    expect(fixture.diagnosticAppend).not.toHaveBeenCalled()
    report(sender, second.documentId, 'healthy')
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ event: 'renderer.recovery.healthy', fields: { attempt: 1 } }))
    expect(() => report(sender, second.documentId, 'made-up-status')).toThrow('Invalid renderer status')
    expect(() => report({ ...sender, senderFrame: {} }, second.documentId, 'healthy')).toThrow()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(main.loadedUrls).toHaveLength(2)
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('uses the existing recovery assistant only after exhausting automatic renderer repair', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-renderer-exhausted-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.hostReady = true
  fixture.report.mockImplementation(() => fixture.runtimeOptions!.onFailure())
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    vi.useFakeTimers()
    for (const delay of [0, 1000, 3000]) {
      main.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 })
      await vi.advanceTimersByTimeAsync(delay)
      expect(fixture.stop).not.toHaveBeenCalled()
    }
    expect(main.loadedUrls).toHaveLength(4)
    main.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 })
    expect(fixture.report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Renderer recovery exhausted: Renderer: crashed' }), 'renderer-startup')
    expect(fixture.memory.incident).toHaveBeenCalledTimes(4)
    expect(fixture.memory.incident).toHaveBeenLastCalledWith({ process: 'renderer', reason: 'crashed', exitCode: -1073741819 })
    expect(fixture.stop).toHaveBeenCalledOnce()
    expect(main.destroyed).toBe(true)
    expect(fixture.windows[1].loadedUrls[0]).toContain('#recovery')
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('records who started each main-window document, and reports exhaustion after a mounted interface as a runtime failure', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-renderer-navigation-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.hostReady = true
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    const sender = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const boot = fixture.handlers.get('dsh-next:boot')!
    const report = fixture.handlers.get('dsh-next:renderer-status')!
    const fields = (event: string) => fixture.diagnosticAppend.mock.calls.map(([record]) => record).filter(record => record?.event === event).map(record => record.fields)
    report(sender, (await boot(sender)).documentId, 'healthy')
    // A navigation the Desktop did not start, such as a page script reloading the document.
    main.webContents.emit('did-start-navigation', { initiator: {} }, 'dsh-app://app/', false, true)
    main.webContents.emit('did-finish-load')
    report(sender, (await boot(sender)).documentId, 'healthy')
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'reload' })
    report(sender, (await boot(sender)).documentId, 'healthy')
    expect(fields('renderer.navigation')).toEqual([
      { cause: 'open', initiator: 'none' }, { cause: 'page', initiator: 'frame' }, { cause: 'reload', initiator: 'none' },
    ])
    expect(fields('renderer.ready')).toEqual([{ cause: 'open' }, { cause: 'page' }, { cause: 'reload' }])
    expect(fields('renderer.recovery.healthy')).toEqual([])
    fixture.report.mockImplementation(() => fixture.runtimeOptions!.onFailure())
    vi.useFakeTimers()
    for (const delay of [0, 1000, 3000]) {
      main.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 })
      await vi.advanceTimersByTimeAsync(delay)
    }
    main.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 })
    expect(fixture.report).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: 'Renderer recovery exhausted: Renderer: crashed' }), 'renderer-runtime')
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it.each(['close', 'quit', 'host-failure'] as const)('cancels pending renderer repair on %s', async action => {
  const home = mkdtempSync(join(tmpdir(), 'next-renderer-cancel-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    vi.useFakeTimers()
    main.webContents.emit('render-process-gone', {}, { reason: 'crashed', exitCode: -1073741819 })
    if (action === 'close') main.destroy()
    else if (action === 'quit') { const { app } = await import('electron'); app.quit() }
    else fixture.runtimeOptions!.onFailure()
    await vi.advanceTimersByTimeAsync(31_000)
    expect(main.loadedUrls).toHaveLength(1)
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('starts Safe Mode with fresh desktop and Chromium state while preserving normal state and its instance lock', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-desktop-state-'))
  const normalState = join(home, 'electron-user-data')
  const safeState = join(normalState, 'safe-mode')
  mkdirSync(safeState, { recursive: true })
  const preferences = join(home, 'desktop-preferences.json')
  writeFileSync(preferences, '{broken normal settings')
  writeFileSync(join(normalState, 'normal-session'), 'keep normal session')
  writeFileSync(join(safeState, 'previous-session'), 'discard previous safe session')
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-safe-mode')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    expect(fixture.lockPaths).toEqual([normalState])
    expect(fixture.appPaths.get('userData')).toBe(safeState)
    expect(fixture.appPaths.get('sessionData')).toBe(safeState)
    expect(fixture.runtimeOptions).toMatchObject({ home, stateHome: safeState })
    expect(existsSync(join(safeState, 'previous-session'))).toBe(false)
    expect(fixture.preferences).toEqual(SAFE_MODE_PREFERENCES)
    expect(fixture.windows[0].options.transparent).not.toBe(true)
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    await expect(fixture.handlers.get('dsh-next:command')!(sender, { type: 'preferences', preferences: DEFAULT_PREFERENCES })).rejects.toThrow('固定')
    expect(fixture.stop).not.toHaveBeenCalled()
    const { app } = await import('electron')
    app.quit()
    await vi.waitFor(() => expect(existsSync(safeState)).toBe(false))
    expect(readFileSync(preferences, 'utf8')).toBe('{broken normal settings')
    expect(readFileSync(join(normalState, 'normal-session'), 'utf8')).toBe('keep normal session')
  } finally {
    process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it.each([false, true])('does not create or reset safe desktop state owned by another instance (existing: %s)', async existing => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-second-instance-'))
  const safeState = join(home, 'electron-user-data', 'safe-mode')
  if (existing) {
    mkdirSync(safeState, { recursive: true })
    writeFileSync(join(safeState, 'running-session'), 'keep running session')
  }
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-safe-mode')
  fixture.ownsInstance = false
  try {
    await import('../src/main.ts')
    expect(fixture.windows).toHaveLength(0)
    expect(fixture.start).not.toHaveBeenCalled()
    expect(fixture.appPaths.get('userData')).toBe(join(home, 'electron-user-data'))
    expect(existsSync(safeState)).toBe(existing)
    if (existing) expect(readFileSync(join(safeState, 'running-session'), 'utf8')).toBe('keep running session')
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('preserves safe desktop state and blocks relaunch when final Host shutdown fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-close-failure-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-safe-mode')
  const logError = vi.spyOn(console, 'error').mockImplementation(() => {})
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    fixture.close.mockRejectedValueOnce(new Error('Host cannot close'))
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'normal-mode' })
    const { app } = await import('electron')
    await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(1))
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(existsSync(join(home, 'electron-user-data', 'safe-mode'))).toBe(true)
  } finally {
    logError.mockRestore()
    process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it('captures scoped client errors with either Electron console-message signature without crashing on missing text', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-console-message-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const consoleMessage = fixture.windows[0].webContents
    // Startup records how the login-shell environment and locale were resolved before any Host starts.
    await vi.waitFor(() => expect(fixture.diagnosticAppend.mock.calls.filter(([record]) => record?.event === 'shell-environment.resolved')).toEqual([[expect.objectContaining({ source: 'desktop' })]]))
    fixture.diagnosticAppend.mockClear()
    Object.assign(fixture.preferences, { developerLogging: true })
    consoleMessage.emit('console-message', {}, 2, '[next-ui-diagnostic] aa=false')
    consoleMessage.emit('console-message', { message: "slot entry crashed in 'sidebar.footer.action': error" })
    consoleMessage.emit('console-message', {}, 2)
    consoleMessage.emit('console-message', {}, 2, 'unrelated output')
    expect(fixture.diagnosticAppend).toHaveBeenCalledTimes(3)
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer', event: 'console', message: '[next-ui-diagnostic] aa=false', level: 'warn', developer: true }))
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'renderer', level: 'error', developer: false }))
  } finally {
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it('keeps the Windows caption buttons transparent so full-window official surfaces show beneath them', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-windows-caption-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    expect(window.options.titleBarOverlay).toEqual({ height: 40, color: '#00000000', symbolColor: '#f9fafb' })
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const appearance = fixture.handlers.get('dsh-next:windows-appearance')!
    // The recorded preload reports the language, the sidebar fill and the primary label color.
    appearance(sender, 'zh-CN', 'rgba(27, 27, 28, 1)', 'rgba(249, 250, 251, 1)')
    expect(window.setTitleBarOverlay).toHaveBeenCalledWith({ color: '#00000000', symbolColor: 'rgba(249, 250, 251, 1)' })
    appearance(sender, 'zh-CN', 'rgba(27, 27, 28, 1)', 'red')
    appearance({ ...sender, senderFrame: { url: 'dsh-app://app/' } }, 'zh-CN', 'rgba(27, 27, 28, 1)', 'rgba(15, 17, 21, 1)')
    expect(window.setTitleBarOverlay).toHaveBeenCalledOnce()
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it('pops the official editing context menu with Windows labels in the application language', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-context-menu-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const editFlags = { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false }
    window.webContents.emit('context-menu', {}, { isEditable: true, selectionText: '', editFlags })
    expect(fixture.popup).toHaveBeenCalledWith([
      { role: 'undo', enabled: true, label: '撤销', accelerator: '' },
      { role: 'redo', enabled: false, label: '重做', accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'cut', enabled: true, label: '剪切', accelerator: '' },
      { role: 'copy', enabled: true, label: '复制', accelerator: '' },
      { role: 'paste', enabled: true, label: '粘贴', accelerator: '' },
      { type: 'separator', accelerator: '' },
      { role: 'selectAll', enabled: true, label: '全选', accelerator: '' },
    ], { window })
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    fixture.handlers.get('dsh-next:locale')!(sender, 'en')
    window.webContents.emit('context-menu', {}, { isEditable: false, selectionText: 'DSH', editFlags })
    expect(fixture.popup).toHaveBeenLastCalledWith([{ role: 'copy', enabled: true, label: 'Copy', accelerator: '' }], { window })
    window.webContents.emit('context-menu', {}, { isEditable: false, selectionText: '', editFlags })
    expect(fixture.popup).toHaveBeenCalledTimes(2)
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'controls', page: 'profiles' })
    const controls = fixture.windows[1]
    controls.webContents.emit('context-menu', {}, { isEditable: true, selectionText: '', editFlags: { ...editFlags, canUndo: false } })
    expect(fixture.popup).toHaveBeenLastCalledWith(expect.arrayContaining([
      { role: 'undo', enabled: false, label: 'Undo', accelerator: '' },
      { role: 'paste', enabled: true, label: 'Paste', accelerator: '' },
    ]), { window: controls })
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it('exits before claiming the instance when an elevated Windows launch restarted de-elevated', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-de-elevated-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.startupElevation = { relaunched: true }
  try {
    await import('../src/main.ts')
    const { app } = await import('electron')
    expect(app.exit).toHaveBeenCalledWith(0)
    expect(fixture.lockPaths).toEqual([])
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(fixture.windows).toHaveLength(0)
    expect(fixture.start).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it('explains the first Windows GPU launch failure in a native dialog, records it and quits', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-sandbox-gpu-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.startupElevation = { relaunched: false, state: { elevation: { elevated: true, type: 'full' }, kept: 'shell-other-user' } }
  fixture.elevation = { elevated: true, type: 'full' }
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const { app, dialog } = await import('electron')
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({
      source: 'electron', event: 'elevation.kept', level: 'warn', fields: { reason: 'shell-other-user', win32Code: null },
    }))
    const gpu = { type: 'GPU', reason: 'launch-failed', exitCode: 18 }
    // Other platforms and other children keep Chromium's own handling.
    app.emit('child-process-gone', {}, gpu)
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'launch-failed', exitCode: 18, serviceName: 'audio.mojom.AudioService' })
    app.emit('child-process-gone', {}, { ...gpu, reason: 'crashed', exitCode: -2147483645 })
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
    app.emit('child-process-gone', {}, gpu)
    app.emit('child-process-gone', {}, gpu)
    expect(dialog.showMessageBoxSync).toHaveBeenCalledOnce()
    const options = vi.mocked(dialog.showMessageBoxSync).mock.calls[0]![0]
    expect(options).toMatchObject({ type: 'error', title: 'DSH NEXT 无法启动', buttons: ['退出'], noLink: true })
    expect(options.message).toContain('GPU 进程')
    expect(options.detail).toContain('以普通权限自动重新启动没有成功')
    expect(options.detail).toContain('「以管理员身份运行此程序」')
    expect(options.detail).toContain('错误码：18')
    expect(options.detail).toContain('--no-sandbox')
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({
      source: 'electron', event: 'sandbox.launch-failed', level: 'error', fields: { process: 'gpu', code: 18, elevated: true, elevationType: 'full' },
    }))
    expect(app.exit).toHaveBeenCalledOnce()
    expect(app.exit).toHaveBeenCalledWith(1)
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it('starts local-only Crashpad before any window and turns renderer and child failures into memory incidents', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-memory-incidents-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const { app } = await import('electron')
    expect(fixture.crashStart).toHaveBeenCalledExactlyOnceWith({ productName: 'DSH NEXT', uploadToServer: false, globalExtra: expect.objectContaining({ appVersion: expect.any(String) }) })
    // Safe Mode swaps userData for disposable state; dumps stay beside the normal launch.
    expect(fixture.appPaths.get('crashDumps')).toBe(join(home, 'electron-user-data', 'Crashpad'))
    expect(fixture.memory.start).toHaveBeenCalledOnce()
    const main = fixture.windows[0]
    main.webContents.emit('render-process-gone', {}, { reason: 'clean-exit', exitCode: 0 })
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'clean-exit', exitCode: 0, serviceName: 'audio.mojom.AudioService' })
    expect(fixture.memory.incident).not.toHaveBeenCalled()
    main.webContents.emit('render-process-gone', {}, { reason: 'oom', exitCode: -536870904 })
    app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 34 })
    expect(fixture.memory.incident.mock.calls).toEqual([
      [{ process: 'renderer', reason: 'oom', exitCode: -536870904 }],
      [{ process: 'child', type: 'GPU', reason: 'crashed', exitCode: 34 }],
    ])
    expect(fixture.memory.stop).not.toHaveBeenCalled()
    app.quit()
    expect(fixture.memory.stop).toHaveBeenCalledOnce()
    // Quitting ends every child process; that is not memory evidence.
    app.emit('child-process-gone', {}, { type: 'Utility', reason: 'killed', exitCode: 1, serviceName: 'network.mojom.NetworkService' })
    expect(fixture.memory.incident).toHaveBeenCalledTimes(2)
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('explains a Windows renderer launch failure only for the Desktop windows', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-sandbox-renderer-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const { app, dialog } = await import('electron')
    Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
    const failed = { reason: 'launch-failed', exitCode: 18 }
    app.emit('render-process-gone', {}, { id: 999 }, failed)
    app.emit('render-process-gone', {}, fixture.windows[0].webContents, { reason: 'crashed', exitCode: 1 })
    expect(dialog.showMessageBoxSync).not.toHaveBeenCalled()
    app.emit('render-process-gone', {}, fixture.windows[0].webContents, failed)
    expect(dialog.showMessageBoxSync).toHaveBeenCalledOnce()
    const options = vi.mocked(dialog.showMessageBoxSync).mock.calls[0]![0]
    expect(options.message).toContain('渲染进程')
    // Without a token fixture the elevation is unknown, and the dialog says so.
    expect(options.detail).toContain('无法确认')
    expect(app.exit).toHaveBeenCalledWith(1)
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it.each(['normal', '--next-safe-mode'])('stages an explicit update before hiding windows, and preserves its installer until handoff in %s', async mode => {
  const home = mkdtempSync(join(tmpdir(), 'next-install-update-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  const argv = [...process.argv]
  if (mode !== 'normal') process.argv.push(mode)
  let stageReady!: () => void
  const stagedPath = () => join(fixture.appPaths.get('userData')!, 'staged-update')
  const stage = vi.fn(() => new Promise<void>(resolve => { stageReady = () => { writeFileSync(stagedPath(), 'installer'); resolve() } }))
  const launch = vi.fn(async () => { expect(readFileSync(stagedPath(), 'utf8')).toBe('installer') })
  vi.doMock('../src/update-installer.ts', () => ({ NextUpdateInstaller: class { stage = stage; launch = launch } }))
  vi.doMock('../src/updates.ts', () => ({ NextUpdates: class {
    constructor(private options: { install(): Promise<void> }) {}
    snapshot() { return { phase: 'ready', version: '2.0.20-next.1', installable: true } }
    start() {}
    dispose = async () => {}
    install = () => this.options.install()
  } }))
  let closed!: () => void
  fixture.close.mockImplementationOnce(() => new Promise<void>(resolve => { closed = resolve }))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]; window.visible = true
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'install-update' })
    expect(stage).toHaveBeenCalledOnce(); expect(fixture.close).not.toHaveBeenCalled(); expect(window.visible).toBe(true)
    stageReady()
    await vi.waitFor(() => expect(fixture.close).toHaveBeenCalledOnce())
    expect(window.visible).toBe(false); expect(launch).not.toHaveBeenCalled()
    closed()
    await vi.waitFor(() => expect(launch).toHaveBeenCalledOnce())
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.doUnmock('../src/update-installer.ts'); vi.doUnmock('../src/updates.ts')
    process.argv.splice(0, process.argv.length, ...argv)
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it.each(['timeout', 'failure'] as const)('still launches a staged update before forced exit when shutdown hits %s', async outcome => {
  const home = mkdtempSync(join(tmpdir(), 'next-install-update-forced-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...platform, value: 'darwin' })
  const stagedPath = () => join(fixture.appPaths.get('userData')!, 'staged-update')
  const stage = vi.fn(async () => { writeFileSync(stagedPath(), 'installer') })
  const launch = vi.fn(async () => { expect(readFileSync(stagedPath(), 'utf8')).toBe('installer') })
  vi.doMock('../src/update-installer.ts', () => ({ NextUpdateInstaller: class { stage = stage; launch = launch } }))
  vi.doMock('../src/updates.ts', () => ({ NextUpdates: class {
    constructor(private options: { install(): Promise<void> }) {}
    snapshot() { return { phase: 'ready', version: '2.0.20-next.1', installable: true } }
    start() {}
    dispose = async () => {}
    install = () => this.options.install()
  } }))
  let finishClose!: () => void
  if (outcome === 'timeout') {
    fixture.close.mockImplementationOnce(() => new Promise<void>(resolve => { finishClose = resolve }))
  } else {
    fixture.close.mockRejectedValueOnce(new Error('Host did not exit'))
  }
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const { app } = await import('electron')
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    if (outcome === 'timeout') vi.useFakeTimers()
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'install-update' })
    expect(stage).toHaveBeenCalledOnce()
    if (outcome === 'timeout') {
      await vi.advanceTimersByTimeAsync(4_999)
      expect(launch).not.toHaveBeenCalled()
      expect(app.exit).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(launch).toHaveBeenCalledOnce()
      expect(app.exit).toHaveBeenCalledExactlyOnceWith(1)
      expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'electron', event: 'shutdown.timeout', level: 'error' }))
      finishClose()
      await vi.advanceTimersByTimeAsync(10_000)
      expect(launch).toHaveBeenCalledOnce()
      expect(app.exit).toHaveBeenCalledOnce()
    } else {
      await vi.waitFor(() => expect(app.exit).toHaveBeenCalledExactlyOnceWith(1))
      expect(launch).toHaveBeenCalledOnce()
      expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'electron', event: 'shutdown.failed', level: 'error' }))
    }
  } finally {
    Object.defineProperty(process, 'platform', platform)
    vi.useRealTimers()
    vi.doUnmock('../src/update-installer.ts'); vi.doUnmock('../src/updates.ts')
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it.each(['darwin', 'win32'] as const)('reopens the main window at its saved bounds, maximized again on %s, and saves each settled change', async platformName => {
  const home = mkdtempSync(join(tmpdir(), 'main-window-restore-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
  Object.defineProperty(process, 'platform', { ...platform, value: platformName })
  const statePath = join(home, 'desktop-window-state.json')
  const saved = (): unknown => JSON.parse(readFileSync(statePath, 'utf8'))
  writeFileSync(statePath, JSON.stringify({ version: 1, bounds: { x: 120, y: 90, width: 1400, height: 860 }, maximized: true }))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    expect(window.options).toMatchObject({ x: 120, y: 90, width: 1400, height: 860, minWidth: 800, minHeight: 580 })
    vi.useFakeTimers()
    const maximize = vi.spyOn(window, 'maximize')
    const show = vi.spyOn(window, 'show')
    window.emit('ready-to-show')
    expect(window).toMatchObject({ maximized: true, visible: true })
    // macOS zooms after the first show; Windows and Linux show the hidden window maximized.
    expect(maximize.mock.invocationCallOrder[0]! > show.mock.invocationCallOrder[0]!).toBe(platformName === 'darwin')
    window.maximized = false
    window.position = { x: 200, y: 150 }
    window.size = { width: 1300, height: 800 }
    window.emit('unmaximize'); window.emit('move'); window.emit('resize')
    await vi.advanceTimersByTimeAsync(249)
    expect(saved()).toMatchObject({ bounds: { x: 120 }, maximized: true })
    await vi.advanceTimersByTimeAsync(1)
    expect(saved()).toEqual({ version: 1, bounds: { x: 200, y: 150, width: 1300, height: 800 }, maximized: false })
    window.maximized = true
    window.emit('maximize')
    await vi.advanceTimersByTimeAsync(250)
    expect(saved()).toEqual({ version: 1, bounds: { x: 200, y: 150, width: 1300, height: 800 }, maximized: true })
    // Closing to the tray captures the window before hiding it, without waiting for the delay.
    window.maximized = false
    window.position = { x: 260, y: 170 }
    window.emit('unmaximize')
    window.emit('close', { preventDefault() {} })
    expect(window.visible).toBe(false)
    expect(saved()).toEqual({ version: 1, bounds: { x: 260, y: 170, width: 1300, height: 800 }, maximized: false })
    // A hidden window is not a layout to reopen, whatever it reports.
    window.maximized = true
    window.emit('resize')
    await vi.advanceTimersByTimeAsync(250)
    expect(saved()).toMatchObject({ maximized: false })
    fixture.trays[0].emit('click')
    expect(window.visible).toBe(true)
    // Quitting captures the window before hiding it for shutdown.
    window.maximized = false
    window.position = { x: 300, y: 200 }
    window.emit('move')
    const { app } = await import('electron')
    app.quit()
    expect(window.visible).toBe(false)
    expect(saved()).toEqual({ version: 1, bounds: { x: 300, y: 200, width: 1300, height: 800 }, maximized: false })
  } finally {
    vi.useRealTimers()
    Object.defineProperty(process, 'platform', platform)
    vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true })
  }
})

it.each([
  ['unusable', { version: 1, bounds: { x: 0, y: 0, width: 0, height: 800 }, maximized: true }, { width: 1280, height: 840 }, ['failed to restore main-window state: main-window dimensions must be positive safe integers', 'warn']],
  ['off-screen', { version: 1, bounds: { x: 4000, y: -900, width: 2400, height: 1600 }, maximized: false }, { x: 0, y: 25, width: 1728, height: 1092 }, undefined],
])('opens the main window inside the current work area when its saved state is %s', async (_name, state, expected, warning) => {
  const home = mkdtempSync(join(tmpdir(), 'main-window-fallback-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  writeFileSync(join(home, 'desktop-window-state.json'), JSON.stringify(state))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    expect({ x: window.options.x, y: window.options.y, width: window.options.width, height: window.options.height }).toEqual({ x: undefined, y: undefined, ...expected })
    window.emit('ready-to-show')
    expect(window.maximized).toBe(false)
    if (warning) expect(fixture.diagnosticAppend).toHaveBeenCalledWith(...warning)
    else expect(fixture.diagnosticAppend).not.toHaveBeenCalledWith(expect.stringContaining('main-window state'), 'warn')
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('retains the Host when hiding to tray, restores the window, keeps failed-Host controls, validates IPC, and stops on explicit quit', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-main-native-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const tray = fixture.trays[0]
    expect(tray.menu[0].label).toBe('打开 DSH NEXT')
    expect(tray.menu.at(-1).accelerator).toBe('CmdOrCtrl+Q')
    expect(tray.menu.some((item: any) => item.accelerator === 'CmdOrCtrl+,')).toBe(true)
    const preventDefault = vi.fn()
    window.visible = true
    window.emit('close', { preventDefault })
    expect(preventDefault).toHaveBeenCalledOnce()
    expect(window.visible).toBe(false)
    expect(fixture.close).not.toHaveBeenCalled()
    tray.emit('click')
    expect(window.visible).toBe(true)
    const state = fixture.handlers.get('dsh-next:state')!
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    expect(state(sender).phase).toBe('ready')
    expect(() => state({ ...sender, senderFrame: { url: 'dsh-app://app/' } })).toThrow('Rejected')
    expect(() => state({ sender: {}, senderFrame: { url: 'dsh-app://app/' } })).toThrow('Rejected')
    const browserLinks = fixture.handlers.get('dsh-next:browser-links')!
    const permissionQuery = fixture.handlers.get('dsh-next:permission-query')!
    expect(permissionQuery(sender, 'microphone').permission).toBe('microphone')
    expect(() => permissionQuery(sender, 'camera')).toThrow('Unsupported')
    expect(() => permissionQuery({ ...sender, senderFrame: {} }, 'screen')).toThrow('Rejected')
    const permissionRequest = fixture.handlers.get('dsh-next:permission-request')!
    window.webContents.executeJavaScript.mockResolvedValueOnce(false)
    await expect(permissionRequest(sender, 'microphone')).rejects.toThrow('user gesture')
    expect(browserLinks(sender)).toEqual({ localUrl: null, lanUrls: [] })
    expect(() => browserLinks({ ...sender, senderFrame: { url: 'dsh-app://app/' } })).toThrow('Rejected')
    expect(() => browserLinks({ sender: {}, senderFrame: { url: 'dsh-app://app/' } })).toThrow('Rejected')
    await expect(fixture.handlers.get('dsh-next:command')!(sender, { type: ['restart'] })).rejects.toThrow('Invalid Next command')
    await expect(fixture.handlers.get('dsh-next:command')!(sender, { type: 'controls', page: ['general'] })).rejects.toThrow('Invalid controls page')
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'controls' })
    expect(fixture.windows).toHaveLength(1)
    expect(window.visible).toBe(true)
    expect(window.webContents.send).toHaveBeenCalledWith('dsh-next:settings-open')
    const takeSettings = fixture.handlers.get('dsh-next:settings-take')!
    expect(() => takeSettings({ ...sender, senderFrame: {} })).toThrow('Rejected')
    expect(takeSettings(sender)).toBe('general')
    expect(takeSettings(sender)).toBeUndefined()
    tray.menu.find((item: any) => item.accelerator === 'CmdOrCtrl+,').click()
    expect(takeSettings(sender)).toBe('general')
    window.webContents.emit('before-input-event', { preventDefault() {} }, { type: 'keyDown', key: ',', meta: true })
    expect(takeSettings(sender)).toBe('general')
    expect(fixture.windows).toHaveLength(1)
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'controls', page: 'profiles' })
    expect(fixture.windows).toHaveLength(2)
    const controls = fixture.windows[1]
    expect(controls.webContents.mainFrame.url).toBe(`dsh-app://shell/index.html?locale=zh&platform=${process.platform}&frame=${process.platform !== 'linux'}#profiles`)
    expect(state({ sender: controls.webContents, senderFrame: controls.webContents.mainFrame }).failure).toBe('Fixture Host failure')
    expect(() => takeSettings({ sender: controls.webContents, senderFrame: controls.webContents.mainFrame })).toThrow('Rejected')
    fixture.phase = 'ready'
    fixture.handlers.get('dsh-next:locale')!({ ...sender, senderFrame: {} }, 'en')
    expect(tray.menu[0].label).toBe('打开 DSH NEXT')
    fixture.handlers.get('dsh-next:locale')!(sender, 'en')
    expect(tray.menu[0].label).toBe('Open DSH NEXT')
    const { app, dialog, systemPreferences, desktopCapturer } = await import('electron')
    const previousUrl = controls.webContents.mainFrame.url
    expect((await fixture.onPermission!('query', 'screen')).status).not.toBe('granted')
    expect(controls.webContents.mainFrame.url).toBe(previousUrl)
    expect(takeSettings(sender)).toBeUndefined()
    await fixture.onPermission!('request', 'screen')
    expect(takeSettings(sender)).toBe('permissions')
    await fixture.onPermission!('open-settings', 'microphone')
    expect(takeSettings(sender)).toBe('permissions')
    expect(controls.webContents.mainFrame.url).toBe(previousUrl)
    expect(fixture.windows).toHaveLength(2)
    expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled()
    expect(desktopCapturer.getSources).not.toHaveBeenCalled()
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'restart-recovery' })
    expect(fixture.close).not.toHaveBeenCalled()
    let finishClose!: () => void
    fixture.close.mockImplementationOnce(() => {
      expect(fixture.windows.every(window => !window.visible)).toBe(true)
      return new Promise<void>(resolve => { finishClose = resolve })
    })
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'restart-recovery' })
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(tray.destroyed).toBe(true)
    window.emit('ready-to-show')
    controls.emit('ready-to-show')
    app.emit('activate')
    expect(fixture.windows.every(window => !window.visible)).toBe(true)
    finishClose()
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledWith({ args: expect.arrayContaining(['--next-recovery']) }))
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it.each(['ready', 'error'] as const)('allows five seconds for native menu teardown when the Host is %s, then forces exit', async phase => {
  const home = mkdtempSync(join(tmpdir(), 'next-menu-exit-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.phase = phase
  let finishClose!: () => void
  fixture.close.mockImplementation(() => new Promise<void>(resolve => { finishClose = resolve }))
  fixture.stop.mockImplementation(() => new Promise<void>(() => {}))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.trays).toHaveLength(1))
    const { app } = await import('electron')
    const stopsBeforeQuit = fixture.stop.mock.calls.length
    vi.useFakeTimers()
    fixture.trays[0].menu.find((item: any) => item.accelerator === 'CmdOrCtrl+Q').click()
    await vi.advanceTimersByTimeAsync(0)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(app.exit).not.toHaveBeenCalled()
    expect(fixture.stop).toHaveBeenCalledTimes(stopsBeforeQuit)
    await vi.advanceTimersByTimeAsync(4_999)
    expect(app.exit).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(app.exit).toHaveBeenCalledExactlyOnceWith(1)
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ source: 'electron', event: 'shutdown.timeout', level: 'error' }))
    finishClose()
    await vi.advanceTimersByTimeAsync(10_000)
    expect(app.quit).toHaveBeenCalledOnce()
    expect(app.exit).toHaveBeenCalledOnce()
    expect(app.relaunch).not.toHaveBeenCalled()
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('cancels the forced-exit deadline after graceful menu shutdown', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-menu-graceful-exit-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  let finishClose!: () => void
  fixture.close.mockImplementation(() => new Promise<void>(resolve => { finishClose = resolve }))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.trays).toHaveLength(1))
    const { app } = await import('electron')
    vi.useFakeTimers()
    fixture.trays[0].menu.find((item: any) => item.accelerator === 'CmdOrCtrl+Q').click()
    await vi.advanceTimersByTimeAsync(4_999)
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(app.exit).not.toHaveBeenCalled()
    finishClose()
    await vi.advanceTimersByTimeAsync(0)
    expect(app.quit).toHaveBeenCalledTimes(2)
    await vi.advanceTimersByTimeAsync(10_000)
    expect(app.exit).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('boots recovery in the preferred OS language even when the app locale is English, without starting a Host', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-recovery-boot-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const controls = fixture.windows[0]
    expect(controls.webContents.mainFrame.url).toBe(`dsh-app://shell/index.html?locale=zh&platform=${process.platform}&frame=${process.platform !== 'linux'}#recovery`)
    const sender = { sender: controls.webContents, senderFrame: controls.webContents.mainFrame }
    expect(fixture.handlers.get('dsh-next:state')!(sender).phase).toBe('recovery')
    expect(fixture.trays[0].tooltip).toContain('recovery')
    expect(fixture.start).not.toHaveBeenCalled()
    fixture.trays[0].menu[0].click()
    expect(fixture.windows).toHaveLength(1)
    expect(fixture.start).not.toHaveBeenCalled()
    controls.visible = true
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'quit' })
    await vi.waitFor(() => expect(fixture.close).toHaveBeenCalledOnce())
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('retries safe-mode entry after background recovery cleanup failed', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-recovery-stop-retry-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const command = fixture.handlers.get('dsh-next:command')!
    fixture.stop.mockRejectedValueOnce(new Error('Host did not exit'))
    await command({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, { type: 'controls', page: 'recovery' })
    await vi.waitFor(() => expect(fixture.diagnosticAppend).toHaveBeenCalledWith('Error: Host did not exit', 'error'))
    const controls = fixture.windows[1]
    const sender = { sender: controls.webContents, senderFrame: controls.webContents.mainFrame }
    await expect(command(sender, { type: 'safe-mode' })).resolves.toBeUndefined()
    expect(fixture.stop).toHaveBeenCalledTimes(2)
    expect(fixture.restart).not.toHaveBeenCalled()
    const { app } = await import('electron')
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).toContain('--next-safe-mode')
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('shares a failed safe-mode request and retries termination before changing modes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-mode-retry-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const controls = fixture.windows[0]
    const sender = { sender: controls.webContents, senderFrame: controls.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    let rejectStop!: (error: Error) => void
    fixture.stop.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectStop = reject }))
    const requests = [command(sender, { type: 'safe-mode' }), command(sender, { type: 'safe-mode' })]
    const results = Promise.allSettled(requests)
    await vi.waitFor(() => expect(fixture.stop).toHaveBeenCalledOnce())
    rejectStop(new Error('Host still running'))
    expect(await results).toEqual([
      { status: 'rejected', reason: new Error('Host still running') },
      { status: 'rejected', reason: new Error('Host still running') },
    ])
    expect(fixture.handlers.get('dsh-next:state')!(sender).safeMode).toBe(false)
    expect(fixture.restart).not.toHaveBeenCalled()
    const { app } = await import('electron')
    expect(app.relaunch).not.toHaveBeenCalled()
    await expect(command(sender, { type: 'safe-mode' })).resolves.toBeUndefined()
    expect(fixture.stop).toHaveBeenCalledTimes(2)
    expect(fixture.restart).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).toContain('--next-safe-mode')
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('shares pending mode requests and allows a fresh relaunch request after cancellation', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-mode-request-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const controls = fixture.windows[0]
    const sender = { sender: controls.webContents, senderFrame: controls.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { app, dialog } = await import('electron')
    vi.mocked(dialog.showMessageBox).mockClear()
    let finishConfirmation!: (result: Electron.MessageBoxReturnValue) => void
    vi.mocked(dialog.showMessageBox).mockImplementationOnce(() => new Promise(resolve => { finishConfirmation = resolve }))
    const requests = [command(sender, { type: 'safe-mode' }), command(sender, { type: 'normal-mode' })]
    expect(dialog.showMessageBox).toHaveBeenCalledOnce()
    finishConfirmation({ response: 1, checkboxChecked: false })
    await Promise.all(requests)
    expect(fixture.stop).not.toHaveBeenCalled()
    await command(sender, { type: 'safe-mode' })
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).toContain('--next-safe-mode')
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(2)
    expect(fixture.restart).not.toHaveBeenCalled()
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('persists a Profile switch and relaunches the app only after hiding windows and closing its Host', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-profile-switch-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const manager = new NextProfiles(home)
    manager.create('work')
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { app, dialog } = await import('electron')
    await command(sender, { type: 'switch', name: 'desktop' })
    expect(app.quit).not.toHaveBeenCalled()
    await expect(command(sender, { type: 'switch', name: 'missing' })).rejects.toThrow('unavailable')
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await command(sender, { type: 'switch', name: 'work' })
    expect(manager.active).toBe('desktop')
    expect(app.quit).not.toHaveBeenCalled()
    window.visible = true
    let finishClose!: () => void
    fixture.close.mockImplementationOnce(() => {
      expect(window.visible).toBe(false)
      expect(new NextProfiles(home).active).toBe('work')
      return new Promise<void>(resolve => { finishClose = resolve })
    })
    await command(sender, { type: 'switch', name: 'work' })
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.restart).not.toHaveBeenCalled()
    expect(fixture.start).toHaveBeenCalledOnce()
    expect(window.loadedUrls).toEqual(['dsh-app://app/'])
    expect(app.relaunch).not.toHaveBeenCalled()
    finishClose()
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledWith({ args: expect.any(Array) }))
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).not.toContain('--next-recovery')
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).not.toContain('--next-safe-mode')
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it.each(['complete', 'official', 'skip'] as const)('shows first-run onboarding without a Host and saves before starting it on %s', async outcome => {
  const home = mkdtempSync(join(tmpdir(), 'next-onboarding-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.needsOnboarding = true
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const setup = fixture.handlers.get('dsh-desktop:setup-onboarding')!
    const manager = new NextProfiles(home)
    expect(window.webContents.mainFrame.url).toMatch(/#onboarding$/)
    expect(window.size).toEqual({ width: 1040, height: 720 })
    expect(window.minSize).toEqual({ width: 680, height: 560 })
    expect(fixture.start).not.toHaveBeenCalled()
    expect(fixture.handlers.get('dsh-next:state')!(sender)).toMatchObject({ onboarding: true, onboardingComputerUse: false })
    fixture.trays[0].menu[0].click()
    fixture.trays[0].menu.find((item: any) => item.accelerator === 'CmdOrCtrl+,').click()
    await command(sender, { type: 'restart-onboarding' })
    expect(fixture.windows).toHaveLength(1)
    expect(window.loadedUrls).toHaveLength(1)
    expect(fixture.start).not.toHaveBeenCalled()
    await expect(command(sender, { type: 'onboarding-complete', profile: 'other' })).rejects.toThrow('unavailable')
    expect(manager.onboardingRequired('desktop')).toBe(true)
    fixture.start.mockImplementationOnce(async () => {
      expect(manager.onboardingRequired('desktop')).toBe(false)
      expect(manager.features('desktop')).toEqual(outcome === 'skip'
        ? { market: false, remoteControl: false }
        : outcome === 'official'
          ? { market: false, officialMarket: true, remoteControl: false }
          : { market: false, dshMarket: true, remoteControl: true })
      expect(manager.computerUseEnabled('desktop')).toBe(outcome === 'complete')
      expect(fixture.preferences.browserAccess).toBe(outcome === 'complete')
      expect(fixture.preferences.networkExposure).toBe(outcome === 'complete' ? 'lan' : 'loopback')
    })
    await command(sender, outcome === 'skip' ? { type: 'onboarding-skip', profile: 'desktop' }
      : { type: 'onboarding-complete', profile: 'desktop', computerUse: outcome === 'complete',
        browserAccess: outcome === 'complete', networkExposure: outcome === 'complete' ? 'lan' : 'loopback',
        features: outcome === 'official'
          ? { market: false, officialMarket: true, remoteControl: false }
          : { market: false, dshMarket: true, remoteControl: true } })
    expect(fixture.start).toHaveBeenCalledOnce()
    expect(fixture.restart).not.toHaveBeenCalled()
    expect(window.destroyed).toBe(true)
    expect(fixture.windows).toHaveLength(2)
    const main = fixture.windows[1]
    const mainSender = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    expect(main.webContents.mainFrame.url).toBe('dsh-app://app/')
    expect(await setup(mainSender, { action: 'read' })).toMatchObject({
      required: false,
      accountPending: outcome !== 'skip',
      input: {
        market: outcome === 'skip' ? 'disabled' : outcome === 'official' ? 'official-market' : 'dsh-market',
        openBrowser: outcome === 'complete',
        networkExposure: outcome === 'complete' ? 'lan' : 'loopback',
      },
    })
    await expect(setup(mainSender, { action: 'finish', profile: 'desktop' })).rejects.toThrow('unavailable')
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('reopens setup through a confirmed relaunch without resetting the Profile or stopping the Host before hiding windows', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-onboarding-relaunch-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const manager = new NextProfiles(home)
    manager.finishOnboarding('desktop', { features: { market: false, dshMarket: true, remoteControl: true }, computerUse: true })
    const { app, dialog } = await import('electron')
    window.visible = true
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await command(sender, { type: 'restart-onboarding' })
    expect(app.quit).not.toHaveBeenCalled()
    expect(window.visible).toBe(true)
    expect(fixture.close).not.toHaveBeenCalled()
    let finishClose!: () => void
    fixture.close.mockImplementationOnce(() => {
      expect(window.visible).toBe(false)
      return new Promise<void>(resolve => { finishClose = resolve })
    })
    await command(sender, { type: 'restart-onboarding' })
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(app.relaunch).not.toHaveBeenCalled()
    expect(manager.onboardingRequired('desktop')).toBe(false)
    expect(manager.features('desktop')).toEqual({ market: false, dshMarket: true, remoteControl: true })
    expect(manager.computerUseEnabled('desktop')).toBe(true)
    finishClose()
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledWith({ args: expect.arrayContaining(['--next-onboarding']) }))
    expect(fixture.start).toHaveBeenCalledOnce()
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it.each(['complete', 'skip', 'close'] as const)('reopens a completed Profile with its saved choices and handles %s', async outcome => {
  const home = mkdtempSync(join(tmpdir(), 'next-onboarding-reopen-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-onboarding')
  try {
    const manager = new NextProfiles(home)
    manager.ensure('desktop')
    const features = { market: false, dshMarket: true, remoteControl: true }
    manager.finishOnboarding('desktop', { features, computerUse: true })
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    fixture.preferences.browserAccess = true
    fixture.preferences.networkExposure = 'lan'
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    expect(window.webContents.mainFrame.url).toMatch(/#onboarding$/)
    expect(fixture.start).not.toHaveBeenCalled()
    expect(fixture.handlers.get('dsh-next:state')!(sender)).toMatchObject({ onboarding: true, onboardingComputerUse: true, features, preferences: { browserAccess: true, networkExposure: 'lan' } })
    // Reopening is a launch mode, not a deletion of the completion record.
    expect(manager.onboardingRequired('desktop')).toBe(false)
    if (outcome === 'close') {
      window.close()
      expect(fixture.start).not.toHaveBeenCalled()
    } else {
      await command(sender, outcome === 'skip' ? { type: 'onboarding-skip', profile: 'desktop' }
        : { type: 'onboarding-complete', profile: 'desktop', features: { market: true, remoteControl: false }, computerUse: false, browserAccess: false })
      expect(fixture.start).toHaveBeenCalledOnce()
      expect(fixture.windows[1].webContents.mainFrame.url).toBe('dsh-app://app/')
    }
    expect(manager.features('desktop')).toEqual(outcome === 'complete' ? { market: true, remoteControl: false } : features)
    expect(manager.computerUseEnabled('desktop')).toBe(outcome !== 'complete')
    expect(fixture.preferences.browserAccess).toBe(outcome !== 'complete')
    expect(fixture.preferences.networkExposure).toBe(outcome === 'complete' ? 'loopback' : 'lan')
    expect(manager.onboardingRequired('desktop')).toBe(false)
    if (outcome !== 'close') {
      const { app } = await import('electron')
      const main = fixture.windows[1]
      await command({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, { type: 'restart-app' })
      await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalled())
      expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).not.toContain('--next-onboarding')
    }
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it.each(['--next-recovery', '--next-safe-mode'])('keeps %s independent of onboarding and clears its flag when switching Profiles', async mode => {
  const home = mkdtempSync(join(tmpdir(), 'next-onboarding-bypass-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.needsOnboarding = true
  const argv = [...process.argv]
  process.argv.push(mode, '--next-onboarding')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const manager = new NextProfiles(home)
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    expect(window.webContents.mainFrame.url).not.toContain('#onboarding')
    expect(manager.onboardingRequired('desktop')).toBe(true)
    expect(fixture.handlers.get('dsh-next:state')!(sender).onboarding).toBe(false)
    const command = fixture.handlers.get('dsh-next:command')!
    await expect(command(sender, { type: 'onboarding-skip', profile: 'desktop' })).rejects.toThrow('unavailable')
    await expect(command(sender, { type: 'restart-onboarding' })).rejects.toThrow('unavailable')
    manager.create('work')
    await command(sender, { type: 'switch', name: 'work' })
    const { app } = await import('electron')
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalled())
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).not.toContain(mode)
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args).not.toContain('--next-onboarding')
    expect(manager.active).toBe('work')
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('opens recovery instead of onboarding when a Profile manifest is broken', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-onboarding-broken-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.needsOnboarding = true; fixture.corruptProfile = true
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    expect(fixture.windows[0].webContents.mainFrame.url).toMatch(/#recovery$/)
    expect(fixture.start).not.toHaveBeenCalled()
    expect(fixture.trays).toHaveLength(1)
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('does not mark an unfinished flow complete when its window closes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-onboarding-close-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  fixture.needsOnboarding = true
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    fixture.windows[0].close()
    expect(new NextProfiles(home).onboardingRequired('desktop')).toBe(true)
    const { app } = await import('electron')
    app.emit('activate')
    expect(fixture.windows).toHaveLength(2)
    expect(fixture.windows[1].webContents.mainFrame.url).toMatch(/#onboarding$/)
    expect(fixture.start).not.toHaveBeenCalled()
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it.each([false, true])('only safe mode permits the main window alongside recovery (safe=%s)', async safe => {
  const home = mkdtempSync(join(tmpdir(), 'next-recovery-windows-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  if (safe) process.argv.push('--next-safe-mode')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    const command = fixture.handlers.get('dsh-next:command')!
    await command({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, { type: 'controls', page: 'recovery' })
    const recovery = fixture.windows[1]
    expect(recovery.webContents.mainFrame.url).toMatch(/#recovery$/)
    expect(main.destroyed).toBe(!safe)
    expect(fixture.stop).toHaveBeenCalledTimes(safe ? 0 : 1)
    const { app } = await import('electron')
    app.emit('activate')
    expect(fixture.windows).toHaveLength(2)
    if (!safe) {
      const sender = { sender: recovery.webContents, senderFrame: recovery.webContents.mainFrame }
      expect(fixture.handlers.get('dsh-next:state')!(sender).phase).toBe('recovery')
      await command(sender, { type: 'restart' })
      expect(recovery.destroyed).toBe(true)
      expect(fixture.windows[2].webContents.mainFrame.url).toBe('dsh-app://app/')
      expect(fixture.windows[2].loadedUrls).toEqual(['dsh-app://app/'])
    }
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it('routes terminal commands by their authenticated window, ignoring a forged source in the payload', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-terminal-routing-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-safe-mode')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    const sender = { sender: main.webContents, senderFrame: main.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    fixture.terminalTarget.mockImplementation(repair => ({ homeDir: repair ? home : join(home, 'safe'),
      profileDir: join(repair ? home : join(home, 'safe'), 'profiles', 'desktop'), profileName: 'desktop', mode: repair ? 'recovery' : 'safe' }))
    await command(sender, { type: 'terminal', source: 'shell' })
    expect(fixture.terminalTarget).toHaveBeenLastCalledWith(false)
    const safe = fixture.openTerminal.mock.calls.at(-1)![0]
    expect(safe).toMatchObject({ homeDir: join(home, 'safe'), mode: 'safe' })
    await command(sender, { type: 'controls', page: 'recovery' })
    const recovery = fixture.windows[1]
    await command({ sender: recovery.webContents, senderFrame: recovery.webContents.mainFrame }, { type: 'terminal', source: 'app' })
    expect(fixture.terminalTarget).toHaveBeenLastCalledWith(true)
    const original = fixture.openTerminal.mock.calls.at(-1)![0]
    expect(original).toMatchObject({ homeDir: home, mode: 'recovery' })
    expect(original.stateDir).not.toBe(safe.stateDir)
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it.each(['cancelled', 'retired', 'failed'] as const)('handles %s main-window navigation without confusing it with a Host failure', async kind => {
  const home = mkdtempSync(join(tmpdir(), 'next-navigation-failure-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  let rejectLoad!: (error: Error) => void
  fixture.load.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectLoad = reject }))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const main = fixture.windows[0]
    if (kind === 'retired') {
      await fixture.handlers.get('dsh-next:command')!({ sender: main.webContents, senderFrame: main.webContents.mainFrame }, { type: 'controls', page: 'recovery' })
      expect(main.destroyed).toBe(true)
    }
    const error = Object.assign(new Error(kind === 'cancelled' ? 'ERR_ABORTED (-3)' : 'ERR_FAILED (-2)'),
      { code: kind === 'cancelled' ? 'ERR_ABORTED' : 'ERR_FAILED', errno: kind === 'cancelled' ? -3 : -2 })
    rejectLoad(error)
    // Flush the loadURL and navigation-handler promise chain.
    await new Promise(resolve => setImmediate(resolve))
    expect(fixture.report).not.toHaveBeenCalled()
    if (kind === 'failed') {
      await vi.waitFor(() => expect(main.loadedUrls).toHaveLength(2))
      expect(fixture.stop).not.toHaveBeenCalled()
    }
    if (kind === 'retired') {
      main.webContents.emit('did-fail-load', {}, -2, 'retired navigation', 'dsh-app://app/', true)
      expect(fixture.report).not.toHaveBeenCalled()
    }
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it.each([
  ['--next-recovery', 'safe-mode'],
  ['--next-safe-mode', 'normal-mode'],
] as const)('relaunches instead of reloading the current process from %s via %s', async (mode, type) => {
  const home = mkdtempSync(join(tmpdir(), 'next-recovery-safe-navigation-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push(mode)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const initial = fixture.windows[0]
    const sender = { sender: initial.webContents, senderFrame: initial.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { app } = await import('electron')
    const navigation = [...initial.loadedUrls]
    let finishClose!: () => void
    initial.visible = true
    fixture.close.mockImplementationOnce(() => {
      expect(initial.visible).toBe(false)
      return new Promise<void>(resolve => { finishClose = resolve })
    })
    await command(sender, { type })
    expect(fixture.windows).toHaveLength(1)
    expect(initial.loadedUrls).toEqual(navigation)
    expect(fixture.restart).not.toHaveBeenCalled()
    expect(app.relaunch).not.toHaveBeenCalled()
    finishClose()
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    const args = vi.mocked(app.relaunch).mock.calls[0]![0]!.args!
    expect(args.includes('--next-safe-mode')).toBe(type === 'safe-mode')
    expect(args).not.toContain('--next-recovery')
    expect(fixture.report).not.toHaveBeenCalled()
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it.each([
  ['restart', true],
  ['recover', false],
] as const)('relaunches Safe Mode via %s with the correct next startup mode', async (type, remainSafe) => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-recovery-relaunch-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-safe-mode')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    await fixture.handlers.get('dsh-next:command')!(sender, { type })
    const { app } = await import('electron')
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    expect(fixture.restart).not.toHaveBeenCalled()
    expect(vi.mocked(app.relaunch).mock.calls[0]![0]!.args!.includes('--next-safe-mode')).toBe(remainSafe)
    expect(existsSync(join(home, 'electron-user-data', 'safe-mode'))).toBe(false)
    expect(new NextProfiles(home).selectable('desktop')).toBe(true)
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('relaunches into Desktop setup after Profile repair and shows where the previous configuration is', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-profile-repair-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const profiles = new NextProfiles(home)
    expect(profiles.onboardingRequired('desktop')).toBe(false)
    const { app, dialog, shell } = await import('electron')
    // Continue past the confirmation, then ask to see the backup.
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false }).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await fixture.handlers.get('dsh-next:command')!(sender, { type: 'recover' })
    const backup = new NextRecovery(profiles).repairBackup('desktop')!.directory
    const announcement = vi.mocked(dialog.showMessageBox).mock.calls.at(-1)!.at(-1) as { detail: string }
    expect(announcement.detail).toContain(backup)
    expect(shell.showItemInFolder).toHaveBeenCalledWith(backup)
    expect(profiles.onboardingRequired('desktop')).toBe(true)
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    const args = vi.mocked(app.relaunch).mock.calls[0]![0]!.args!
    expect(args).not.toContain('--next-recovery')
    expect(args).not.toContain('--next-safe-mode')
    expect(fixture.restart).not.toHaveBeenCalled()
    expect(fixture.report).not.toHaveBeenCalled()
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it.each(['--next-safe-mode', '--next-recovery'])('restarts the whole app in normal mode from the recovery footer after %s', async mode => {
  const home = mkdtempSync(join(tmpdir(), 'next-recovery-footer-restart-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push(mode, '--next-onboarding')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const initial = fixture.windows[0]
    const command = fixture.handlers.get('dsh-next:command')!
    await command({ sender: initial.webContents, senderFrame: initial.webContents.mainFrame }, { type: 'controls', page: 'recovery' })
    const recovery = fixture.windows.at(-1)
    const sender = { sender: recovery.webContents, senderFrame: recovery.webContents.mainFrame }
    const { app, dialog } = await import('electron')
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    await command(sender, { type: 'recovery-action', action: 'restart' })
    expect(app.quit).not.toHaveBeenCalled()
    let finishClose!: () => void
    fixture.windows.forEach(window => { window.visible = true })
    const navigations = fixture.windows.map(window => [...window.loadedUrls])
    fixture.close.mockImplementationOnce(() => {
      expect(fixture.windows.every(window => !window.visible)).toBe(true)
      return new Promise<void>(resolve => { finishClose = resolve })
    })
    await command(sender, { type: 'recovery-action', action: 'restart' })
    expect(fixture.close).toHaveBeenCalledOnce()
    expect(fixture.restart).not.toHaveBeenCalled()
    expect(fixture.windows.map(window => window.loadedUrls)).toEqual(navigations)
    expect(app.relaunch).not.toHaveBeenCalled()
    finishClose()
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    const args = vi.mocked(app.relaunch).mock.calls[0]![0]!.args!
    expect(args).not.toContain('--next-safe-mode')
    expect(args).not.toContain('--next-recovery')
    expect(args).not.toContain('--next-onboarding')
    expect(new NextProfiles(home).active).toBe('desktop')
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it.each(['success', 'cancel', 'failure'] as const)('restores a checkpoint with dependency reconciliation and accurate feedback: %s', async outcome => {
  const home = mkdtempSync(join(tmpdir(), 'next-checkpoint-feedback-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const manager = new NextProfiles(home), recovery = new NextRecovery(manager)
    const patch = join(manager.directory('desktop'), 'cordis.patch.yml')
    writeFileSync(patch, '# saved\n[]\n')
    recovery.checkpoint('desktop')
    const checkpoint = recovery.checkpoints('desktop')[0]!
    writeFileSync(patch, '# modified\n[]\n')
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const state = () => fixture.handlers.get('dsh-next:state')!(sender)
    const { dialog } = await import('electron')
    if (outcome === 'cancel') vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 1, checkboxChecked: false })
    let finish!: (value: { exitCode: number }) => void
    fixture.pluginDone.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const pending = command(sender, { type: 'recovery-action', action: 'preview-checkpoint', id: checkpoint.id })
    if (outcome === 'cancel') {
      await pending
      expect(fixture.plugin).not.toHaveBeenCalled()
      expect(readFileSync(patch, 'utf8')).toContain('modified')
      expect(state().recovery.notice).toBeUndefined()
      return
    }
    const failed = outcome === 'failure' ? expect(pending).rejects.toThrow('插件依赖安装失败') : undefined
    await vi.waitFor(() => expect(fixture.plugin).toHaveBeenCalled())
    // Recovery restores configuration without the lockfile, so its reconciling install must never
    // run frozen, which is what pnpm defaults to whenever it treats the environment as CI.
    expect(fixture.plugin.mock.calls[0]![0]).toEqual(['install', '--no-frozen-lockfile'])
    expect(fixture.plugin.mock.calls[0]![1]).toBe(manager.directory('desktop'))
    expect(readFileSync(patch, 'utf8')).toContain('saved')
    expect(state().busy).toBe(true)
    expect(state().recovery.notice).toBeUndefined()
    finish({ exitCode: outcome === 'success' ? 0 : 1 })
    if (failed) await failed
    else await pending
    expect(state().busy).toBe(false)
    if (outcome === 'success') expect(state().recovery.notice).toMatchObject({ tone: 'success', body: expect.stringContaining('退出并重启') })
    else expect(state().recovery.notice).toBeUndefined()
    expect(fixture.start).not.toHaveBeenCalled()
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})


it('disables and re-enables a Profile bundle from recovery without running the package manager', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-bundle-selection-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const manager = new NextProfiles(home)
    const path = join(manager.directory('desktop'), 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    manifest.dsh.profile.bundles.push('my-plugin')
    manifest.dependencies = { ...manifest.dependencies, 'my-plugin': '1.0.0' }
    writeFileSync(path, JSON.stringify(manifest))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const state = () => fixture.handlers.get('dsh-next:state')!(sender)
    const { dialog } = await import('electron')
    vi.mocked(dialog.showMessageBox).mockClear()

    await command(sender, { type: 'recovery-action', action: 'preview-disable', id: 'my-plugin' })
    // Nothing is installed or removed, so a half-written package directory and a
    // Windows file lock can never block the one action that unblocks startup.
    expect(fixture.plugin).not.toHaveBeenCalled()
    const disabled = JSON.parse(readFileSync(path, 'utf8'))
    expect(disabled.dsh.profile.bundles).not.toContain('my-plugin')
    expect(disabled.dependencies['my-plugin']).toBe('1.0.0')
    expect(state().recovery.bundles.find((item: { packageName: string }) => item.packageName === 'my-plugin'))
      .toMatchObject({ status: 'disabled', toggle: 'enable' })
    expect(state().recovery.notice).toMatchObject({ tone: 'success' })

    await expect(command(sender, { type: 'recovery-action', action: 'preview-disable', id: 'my-plugin' }))
      .rejects.toThrow('cannot be changed')

    await command(sender, { type: 'recovery-action', action: 'preview-enable', id: 'my-plugin' })
    expect(JSON.parse(readFileSync(path, 'utf8')).dsh.profile.bundles).toContain('my-plugin')
    expect(dialog.showMessageBox).not.toHaveBeenCalled()
    expect(fixture.plugin).not.toHaveBeenCalled()
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('reveals the saved failure report, explains a missing one, and clears the previous failed action', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-failure-report-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { shell } = await import('electron')
    const logs = join(home, 'logs')
    const report = join(logs, 'dsh-desktop-next-failure-2026-10-29T10-30-00-000Z-host-boot.log')
    mkdirSync(logs, { recursive: true })
    writeFileSync(report, 'report')
    fixture.runtime!.actionFailure = 'Diagnostics export failed'
    fixture.failureReportFile.mockResolvedValueOnce(report)

    await command(sender, { type: 'recovery-action', action: 'show-failure-report' })
    expect(shell.showItemInFolder).toHaveBeenCalledWith(report)
    expect(fixture.runtime!.actionFailure).toBe('')

    await expect(command(sender, { type: 'recovery-action', action: 'show-failure-report' })).rejects.toThrow('诊断报告未能保存')
    rmSync(report)
    fixture.failureReportFile.mockResolvedValueOnce(report)
    await expect(command(sender, { type: 'recovery-action', action: 'show-failure-report' })).rejects.toThrow(`找不到诊断报告：${report}`)
    expect(shell.showItemInFolder).toHaveBeenCalledOnce()
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})

it('opens the window immediately without blocking on slow shell environment or system proxy probes', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-parallel-env-probe-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const proxyDeferred = Promise.withResolvers<{ HTTP_PROXY?: string }>()
  vi.doMock('../src/system-proxy.ts', async importOriginal => ({
    ...await importOriginal<typeof import('../src/system-proxy.ts')>(),
    probeSystemProxy: () => proxyDeferred.promise,
  }))
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    expect(fixture.runtimeOptions?.systemProxy?.()).toEqual({})
    let prepared = false
    const preparing = fixture.runtimeOptions!.prepareEnvironment!().then(() => { prepared = true })
    await Promise.resolve()
    expect(prepared).toBe(false)
    proxyDeferred.resolve({ HTTP_PROXY: 'http://127.0.0.1:7890' })
    await preparing
    expect(prepared).toBe(true)
    expect(fixture.runtimeOptions?.systemProxy?.()).toEqual({ HTTP_PROXY: 'http://127.0.0.1:7890' })
  } finally {
    vi.doUnmock('../src/system-proxy.ts')
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  }
})

it('starts reading the login-shell environment before Electron is ready, and reads it once', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-early-shell-env-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const read = vi.fn(async () => ({ updates: {}, source: 'process' as const, fallbackReason: 'not-packaged' as const }))
  vi.doMock('../src/shell-environment.ts', async importOriginal => ({
    ...await importOriginal<typeof import('../src/shell-environment.ts')>(),
    resolveDesktopShellEnvironment: read,
  }))
  const { app } = await import('electron')
  const ready = Promise.withResolvers<void>()
  app.whenReady = () => ready.promise
  try {
    await import('../src/main.ts')
    expect(read).toHaveBeenCalledOnce()
    expect(fixture.windows).toHaveLength(0)
    ready.resolve()
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    await fixture.runtimeOptions!.prepareEnvironment!()
    expect(read).toHaveBeenCalledOnce()
    // The Host starts only after both probes; the record says what each cost.
    expect(fixture.diagnosticAppend).toHaveBeenCalledWith(expect.objectContaining({ event: 'shell-environment.resolved',
      fields: expect.objectContaining({ shellMs: expect.any(Number), systemProxyMs: expect.any(Number), systemProxyConfiguration: expect.any(String) }) }))
  } finally {
    vi.doUnmock('../src/shell-environment.ts')
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  }
})

it('registers the application scheme with the V8 code cache', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-code-cache-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    expect(fixture.registerSchemes).toHaveBeenCalledExactlyOnceWith([{ scheme: 'dsh-app',
      privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } }])
  } finally {
    vi.unstubAllEnvs()
    rmSync(home, { recursive: true, force: true })
  }
})

const locationFile = () => join(fixture.locationRoot, 'desktop-next-location.json')
const recordedHome = () => (JSON.parse(readFileSync(join(fixture.locationRoot, 'desktop-next-last-home.json'), 'utf8')) as { home: string }).home

it('keeps the in-app data directory ahead of DSH_DESKTOP_NEXT_HOME and reports how it was chosen', async () => {
  const chosen = mkdtempSync(join(tmpdir(), 'next-chosen-home-')), variable = mkdtempSync(join(tmpdir(), 'next-variable-home-'))
  writeFileSync(locationFile(), JSON.stringify({ home: chosen }))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', variable)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    expect(fixture.runtimeOptions?.home).toBe(chosen)
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    expect(fixture.handlers.get('dsh-next:state')!(sender)).toMatchObject({
      dataDirectory: { source: 'desktop', environmentHome: variable }, recovery: { usingDefaultDirectory: false } })
    expect(recordedHome()).toBe(chosen)
  } finally { vi.unstubAllEnvs(); rmSync(chosen, { recursive: true, force: true }); rmSync(variable, { recursive: true, force: true }) }
})

it.each([{ response: 0, keeps: 'the last directory' }, { response: 1, keeps: 'this directory' }, { response: 2, keeps: 'neither' }] as const)(
  'asks before a relaunch that lost its data directory starts over, then keeps $keeps', async ({ response }) => {
    const previous = mkdtempSync(join(tmpdir(), 'next-last-home-')), fallback = mkdtempSync(join(tmpdir(), 'next-fallback-home-'))
    new NextProfiles(previous).ensure('desktop')
    writeFileSync(join(fixture.locationRoot, 'desktop-next-last-home.json'), JSON.stringify({ home: previous }))
    // The relaunch inherited no choice of the last directory: the choice file was removed and the
    // variable set later never reached it. A temporary directory stands in for the default home.
    vi.stubEnv('DSH_DESKTOP_NEXT_HOME', fallback)
    const { app, dialog } = await import('electron')
    vi.mocked(dialog.showMessageBox).mockClear().mockResolvedValueOnce({ response, checkboxChecked: false })
    try {
      await import('../src/main.ts')
      await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledOnce())
      expect(vi.mocked(dialog.showMessageBox).mock.calls[0]![0]).toMatchObject({ message: '数据目录与上次不同',
        detail: expect.stringContaining(`上次：${previous}\n`), buttons: ['改用上次的目录', '继续使用本次目录', '退出'], cancelId: 2 })
      if (response === 1) {
        await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
        expect(fixture.runtimeOptions?.home).toBe(fallback)
        expect(recordedHome()).toBe(fallback)
        expect(existsSync(locationFile())).toBe(false)
        expect(app.exit).not.toHaveBeenCalled()
        return
      }
      await vi.waitFor(() => expect(app.exit).toHaveBeenCalledWith(0))
      expect(fixture.windows).toHaveLength(0)
      expect(fixture.start).not.toHaveBeenCalled()
      expect(recordedHome()).toBe(previous)
      if (response === 0) {
        // A choice made in the app no longer depends on the environment a relaunch inherits.
        expect(JSON.parse(readFileSync(locationFile(), 'utf8'))).toEqual({ home: previous })
        expect(app.relaunch).toHaveBeenCalledOnce()
      } else {
        expect(existsSync(locationFile())).toBe(false)
        expect(app.relaunch).not.toHaveBeenCalled()
      }
    } finally { vi.unstubAllEnvs(); rmSync(previous, { recursive: true, force: true }); rmSync(fallback, { recursive: true, force: true }) }
  })

it('keeps a later launch from opening a window until the data-directory question is answered', async () => {
  const previous = mkdtempSync(join(tmpdir(), 'next-last-home-')), fallback = mkdtempSync(join(tmpdir(), 'next-fallback-home-'))
  new NextProfiles(previous).ensure('desktop')
  writeFileSync(join(fixture.locationRoot, 'desktop-next-last-home.json'), JSON.stringify({ home: previous }))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', fallback)
  const { app, dialog } = await import('electron')
  const answer = Promise.withResolvers<{ response: number; checkboxChecked: boolean }>()
  vi.mocked(dialog.showMessageBox).mockClear().mockReturnValueOnce(answer.promise)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(dialog.showMessageBox).toHaveBeenCalledOnce())
    app.emit('second-instance', {}, [])
    expect(fixture.windows).toHaveLength(0)
    answer.resolve({ response: 1, checkboxChecked: false })
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
  } finally { vi.unstubAllEnvs(); rmSync(previous, { recursive: true, force: true }); rmSync(fallback, { recursive: true, force: true }) }
})

it('changes the data directory from settings through the recovery checks and records it for the next launch', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-settings-home-')), target = mkdtempSync(join(tmpdir(), 'next-settings-target-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { app, dialog } = await import('electron')
    expect(fixture.handlers.get('dsh-next:state')!(sender)).toMatchObject({
      dataDirectory: { source: 'environment', environmentHome: home }, recovery: { usingDefaultDirectory: true } })
    await command(sender, { type: 'change-data-directory' })
    expect(existsSync(locationFile())).toBe(false)
    writeFileSync(join(target, 'unrelated.txt'), 'keep')
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [target] })
    await expect(command(sender, { type: 'change-data-directory' })).rejects.toThrow('empty directory')
    // A refused directory is reported where the user acted, not as a Host failure.
    expect(fixture.report).not.toHaveBeenCalled()
    rmSync(join(target, 'unrelated.txt'))
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [target] })
    await command(sender, { type: 'change-data-directory' })
    expect(JSON.parse(readFileSync(locationFile(), 'utf8'))).toEqual({ home: target })
    expect(recordedHome()).toBe(target)
    await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
  } finally { vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); rmSync(target, { recursive: true, force: true }) }
})

it.each([false, true])('restores the default from recovery by forgetting the in-app choice (directory changes: %s)', async changes => {
  const chosen = mkdtempSync(join(tmpdir(), 'next-chosen-home-')), variable = mkdtempSync(join(tmpdir(), 'next-variable-home-'))
  writeFileSync(locationFile(), JSON.stringify({ home: changes ? chosen : variable }))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', variable)
  const argv = [...process.argv]
  process.argv.push('--next-recovery')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { app } = await import('electron')
    expect(fixture.runtimeOptions?.home).toBe(changes ? chosen : variable)
    expect(fixture.handlers.get('dsh-next:state')!(sender)).toMatchObject({ dataDirectory: { source: 'desktop' }, recovery: { usingDefaultDirectory: false } })
    await command(sender, { type: 'recovery-action', action: 'restore-default-data-directory' })
    expect(existsSync(locationFile())).toBe(false)
    if (changes) {
      expect(recordedHome()).toBe(variable)
      await vi.waitFor(() => expect(app.relaunch).toHaveBeenCalledOnce())
    } else {
      // The chosen directory already is the default one: only the choice goes, without a restart.
      expect(fixture.handlers.get('dsh-next:state')!(sender)).toMatchObject({ dataDirectory: { source: 'environment' }, recovery: { usingDefaultDirectory: true } })
      expect(app.quit).not.toHaveBeenCalled()
    }
  } finally {
    process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs()
    rmSync(chosen, { recursive: true, force: true }); rmSync(variable, { recursive: true, force: true })
  }
})

it('backs up the data directory while the Host is stopped and starts it again, also when copying fails', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-backup-home-')), parent = mkdtempSync(join(tmpdir(), 'next-backup-parent-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    writeFileSync(join(home, 'settings.yaml'), 'kept: true\n')
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { dialog, shell } = await import('electron')
    vi.mocked(dialog.showMessageBox).mockClear()
    fixture.stop.mockImplementationOnce(async () => { expect(readdirSync(parent)).toEqual([]) })
    fixture.restart.mockImplementationOnce(async () => { expect(readdirSync(parent)).toHaveLength(1) })
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [parent] })
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0, checkboxChecked: false }).mockResolvedValueOnce({ response: 0, checkboxChecked: false })
    await command(sender, { type: 'backup-data-directory' })
    const [backup] = readdirSync(parent)
    expect(backup).toMatch(new RegExp(`^${basename(home)}-backup-\\d{8}-\\d{6}$`))
    expect(readFileSync(join(parent, backup!, 'settings.yaml'), 'utf8')).toBe('kept: true\n')
    expect(existsSync(join(parent, backup!, 'electron-user-data'))).toBe(false)
    expect(fixture.stop).toHaveBeenCalledOnce()
    expect(fixture.restart).toHaveBeenCalledOnce()
    expect(window.setProgressBar.mock.calls).toEqual([[2], [-1]])
    // The confirmation is modal to the main window and names the destination.
    expect(vi.mocked(dialog.showMessageBox).mock.calls[0]![0]).toBe(window)
    expect(vi.mocked(dialog.showMessageBox).mock.calls[0]!.at(-1)).toMatchObject({ message: '备份当前数据目录？', detail: expect.stringContaining(join(parent, backup!)) })
    await vi.waitFor(() => expect(shell.showItemInFolder).toHaveBeenCalledWith(join(parent, backup!)))

    // A backup inside the data directory is refused before the Host stops.
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [home] })
    await expect(command(sender, { type: 'backup-data-directory' })).rejects.toThrow('当前数据目录以外')
    expect(fixture.stop).toHaveBeenCalledOnce()

    // A copy that cannot complete leaves no partial backup and still starts the Host again.
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 9, 26, 17, 30, 5) })
    mkdirSync(join(parent, `${basename(home)}-backup-20261026-173005`))
    vi.mocked(dialog.showOpenDialog).mockResolvedValueOnce({ canceled: false, filePaths: [parent] })
    await expect(command(sender, { type: 'backup-data-directory' })).rejects.toThrow('备份未完成')
    expect(fixture.restart).toHaveBeenCalledTimes(2)
    expect(readdirSync(parent).sort()).toEqual([backup, `${basename(home)}-backup-20261026-173005`].sort())
    expect(fixture.report).not.toHaveBeenCalled()
  } finally { vi.useRealTimers(); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }); rmSync(parent, { recursive: true, force: true }) }
})

it('refuses data-directory changes and backups from Safe Mode', async () => {
  const home = mkdtempSync(join(tmpdir(), 'next-safe-data-directory-'))
  vi.stubEnv('DSH_DESKTOP_NEXT_HOME', home)
  const argv = [...process.argv]
  process.argv.push('--next-safe-mode')
  try {
    await import('../src/main.ts')
    await vi.waitFor(() => expect(fixture.windows).toHaveLength(1))
    const window = fixture.windows[0]
    const sender = { sender: window.webContents, senderFrame: window.webContents.mainFrame }
    const command = fixture.handlers.get('dsh-next:command')!
    const { dialog } = await import('electron')
    vi.mocked(dialog.showOpenDialog).mockClear()
    for (const type of ['change-data-directory', 'backup-data-directory'] as const) {
      await expect(command(sender, { type })).rejects.toThrow('恢复助手')
    }
    expect(dialog.showOpenDialog).not.toHaveBeenCalled()
    expect(existsSync(join(fixture.locationRoot, 'desktop-next-last-home.json'))).toBe(false)
  } finally { process.argv.splice(0, process.argv.length, ...argv); vi.unstubAllEnvs(); rmSync(home, { recursive: true, force: true }) }
})
