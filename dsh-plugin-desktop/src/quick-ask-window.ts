/** Spotlight-style Quick Ask window and lifecycle-scoped global shortcuts. */

import { BrowserWindow, globalShortcut, screen } from 'electron'
import { fileURLToPath } from 'node:url'
import type { DesktopLocale, DesktopQuickLaunchRegistration, DesktopQuickLaunchSpec, DesktopQuickLaunchUpdate } from './runtime.ts'
import { isDesktopShortcut } from './quick-ask-shortcut.ts'

const QUICK_ASK_DOCUMENT = fileURLToPath(new URL('./native-ui/quick-ask.html', import.meta.url))
const QUICK_ASK_SCHEME = 'dsh-quick-ask:'
const MAX_PROMPT_BYTES = 64 * 1024

export interface QuickAskAction {
  readonly action: 'submit' | 'hide' | 'open-main' | 'sessions' | 'select-model'
  readonly prompt?: string
  readonly workspaceId?: string
  readonly sessionId?: string
  readonly model?: { readonly provider: string, readonly model: string }
}

export function parseQuickAskAction(href: string): QuickAskAction | undefined {
  let url: URL
  try { url = new URL(href) } catch { return undefined }
  if (url.protocol !== QUICK_ASK_SCHEME || url.username !== '' || url.password !== '' || url.port !== '' || url.pathname !== '' || url.hash !== '') return undefined
  const action = url.hostname
  const keys = [...url.searchParams.keys()]
  if (action === 'hide' || action === 'open-main') return keys.length === 0 ? { action } : undefined
  if (action === 'sessions') {
    const sessionId = url.searchParams.get('session')
    if (sessionId !== null && Buffer.byteLength(sessionId, 'utf8') > 256) return undefined
    return keys.every(key => key === 'session') ? { action, sessionId: sessionId ?? '' } : undefined
  }
  if (action === 'select-model') {
    const sessionId = url.searchParams.get('session')
    const provider = url.searchParams.get('provider')
    const model = url.searchParams.get('model')
    if (sessionId && provider && model && keys.length === 3) {
      return { action, sessionId, model: { provider, model } }
    }
    return undefined
  }
  if (action !== 'submit' || keys.some(key => key !== 'prompt' && key !== 'workspace' && key !== 'session' && key !== 'modelProvider' && key !== 'modelId')) return undefined
  const prompt = url.searchParams.get('prompt')
  if (prompt === null || Buffer.byteLength(prompt, 'utf8') > MAX_PROMPT_BYTES) return undefined
  const workspaceId = url.searchParams.get('workspace') ?? undefined
  const sessionId = url.searchParams.get('session') ?? undefined
  const modelProvider = url.searchParams.get('modelProvider') ?? undefined
  const modelId = url.searchParams.get('modelId') ?? undefined
  const model = (modelProvider && modelId) ? { provider: modelProvider, model: modelId } : undefined
  return {
    action,
    prompt,
    ...(workspaceId === undefined ? {} : { workspaceId }),
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(model === undefined ? {} : { model }),
  }
}

export interface QuickLaunchElectronAdapter {
  readonly BrowserWindow: typeof BrowserWindow
  readonly globalShortcut: Pick<typeof globalShortcut, 'register' | 'unregister'>
  readonly screen: Pick<typeof screen, 'getCursorScreenPoint' | 'getDisplayNearestPoint'>
}

const electron: QuickLaunchElectronAdapter = { BrowserWindow, globalShortcut, screen }

function localized(locale: DesktopLocale) {
  return locale === 'zh'
    ? { title: '快速任务', placeholder: '继续输入，按 Enter 发送', submit: '发送', open: '打开完整 DSH', workspace: '工作区', session: '会话', model: '模型', defaultModel: '默认模型', newSession: '新会话', defaultWorkspace: '默认目录', submitting: '正在思考…', accepted: '已完成', failed: '发送失败，请重试' }
    : { title: 'Quick Ask', placeholder: 'Continue the conversation, press Enter to send', submit: 'Send', open: 'Open DSH', workspace: 'Workspace', session: 'Session', model: 'Model', defaultModel: 'Default model', newSession: 'New session', defaultWorkspace: 'Default directory', submitting: 'Thinking…', accepted: 'Done', failed: 'Could not send. Try again.' }
}

function shortcutPairValid(quickAsk: string, mainWindow: string): boolean {
  return isDesktopShortcut(quickAsk) && isDesktopShortcut(mainWindow) && quickAsk !== mainWindow
}

/** Owns one Quick Ask window and exactly the two shortcuts it registers. */
export class QuickLaunchController implements DesktopQuickLaunchRegistration {
  private window: BrowserWindow | undefined
  private disposed = false
  private quickAskShortcut = ''
  private mainWindowShortcut = ''
  private sessionId: string | undefined
  private stopUpdates: (() => void) | undefined

  constructor(private spec: DesktopQuickLaunchSpec, private readonly adapter: QuickLaunchElectronAdapter = electron) {
    this.stopUpdates = spec.subscribe(update => { this.publishUpdate(update) })
    // Shortcut conflicts must not prevent the Desktop Host or tray from starting.
    this.update({ quickAskShortcut: spec.quickAskShortcut, mainWindowShortcut: spec.mainWindowShortcut })
  }

  update(update: DesktopQuickLaunchUpdate): { readonly ok: true } | { readonly ok: false, readonly action: 'quick-ask' | 'main-window', readonly reason: 'conflict' | 'unavailable' } {
    if (this.disposed) return { ok: false, action: 'quick-ask', reason: 'unavailable' }
    const quickAsk = update.quickAskShortcut
    const mainWindow = update.mainWindowShortcut
    if (!shortcutPairValid(quickAsk, mainWindow)) return { ok: false, action: 'quick-ask', reason: 'conflict' }
    if (quickAsk === this.quickAskShortcut && mainWindow === this.mainWindowShortcut) return { ok: true }

    const registered: string[] = []
    const priorQuick = this.quickAskShortcut
    const priorMain = this.mainWindowShortcut
    if (priorQuick) this.adapter.globalShortcut.unregister(priorQuick)
    if (priorMain) this.adapter.globalShortcut.unregister(priorMain)
    const restore = (): void => {
      for (const shortcut of registered) this.adapter.globalShortcut.unregister(shortcut)
      if (priorQuick) this.adapter.globalShortcut.register(priorQuick, () => { this.toggle() })
      if (priorMain) this.adapter.globalShortcut.register(priorMain, () => { this.spec.showMain() })
    }
    if (!this.adapter.globalShortcut.register(quickAsk, () => { this.toggle() })) {
      restore()
      return { ok: false, action: 'quick-ask', reason: 'unavailable' }
    }
    registered.push(quickAsk)
    if (!this.adapter.globalShortcut.register(mainWindow, () => { this.spec.showMain() })) {
      restore()
      return { ok: false, action: 'main-window', reason: 'unavailable' }
    }
    this.quickAskShortcut = quickAsk
    this.mainWindowShortcut = mainWindow
    return { ok: true }
  }

  refresh(spec: DesktopQuickLaunchSpec): void { this.spec = spec }

  toggle(): void {
    const window = this.ensureWindow()
    if (window.isVisible() && window.isFocused()) {
      window.hide()
      return
    }
    const point = this.adapter.screen.getCursorScreenPoint()
    const { workArea } = this.adapter.screen.getDisplayNearestPoint(point)
    const bounds = window.getBounds()
    window.setPosition(
      Math.round(workArea.x + (workArea.width - bounds.width) / 2),
      Math.round(workArea.y + Math.max(48, workArea.height * 0.18)),
      false,
    )
    window.show()
    window.focus()
    void window.webContents.executeJavaScript("window.dispatchEvent(new Event('dsh-quick-ask-focus'))", true).catch(() => {})
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    if (this.quickAskShortcut) this.adapter.globalShortcut.unregister(this.quickAskShortcut)
    if (this.mainWindowShortcut) this.adapter.globalShortcut.unregister(this.mainWindowShortcut)
    this.quickAskShortcut = ''
    this.mainWindowShortcut = ''
    this.stopUpdates?.()
    this.stopUpdates = undefined
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
  }

  private ensureWindow(): BrowserWindow {
    if (this.window !== undefined && !this.window.isDestroyed()) return this.window
    const copy = localized(this.spec.locale())
    const window = new this.adapter.BrowserWindow({
      width: 680,
      height: 214,
      resizable: true,
      minWidth: 520,
      minHeight: 320,
      maxWidth: 920,
      maxHeight: 760,
      frame: false,
      transparent: process.platform === 'darwin',
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: process.platform === 'darwin' ? '#00000000' : '#17191d',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        spellcheck: true,
      },
    })
    this.window = window
    window.removeMenu()
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    const navigate = (event: Electron.Event, href: string): void => {
      const action = parseQuickAskAction(href)
      event.preventDefault()
      if (action !== undefined) void this.handleAction(window, action)
    }
    window.webContents.on('will-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.on('blur', () => { if (!window.isDestroyed()) window.hide() })
    window.on('closed', () => { if (this.window === window) this.window = undefined })
    const workspaces = this.spec.workspaces()
    const sessions = this.spec.sessions()
    const models = this.spec.models()
    void window.loadFile(QUICK_ASK_DOCUMENT, {
      query: {
        locale: this.spec.locale(),
        copy: Buffer.from(JSON.stringify(copy)).toString('base64url'),
        workspaces: Buffer.from(JSON.stringify(workspaces)).toString('base64url'),
        sessions: Buffer.from(JSON.stringify(sessions)).toString('base64url'),
        models: Buffer.from(JSON.stringify(models)).toString('base64url'),
      },
    }).catch(() => { if (!window.isDestroyed()) window.destroy() })
    return window
  }

  private async handleAction(window: BrowserWindow, action: QuickAskAction): Promise<void> {
    if (action.action === 'hide') { window.hide(); return }
    if (action.action === 'open-main') { window.hide(); this.spec.showMain(); return }
    if (action.action === 'select-model' && action.sessionId && action.model) {
      await this.spec.selectModel?.(action.sessionId, action.model)
      return
    }
    if (action.action === 'sessions') {
      this.sessionId = action.sessionId || undefined
      const history = this.sessionId === undefined ? [] : this.spec.history(this.sessionId)
      const model = this.sessionId === undefined ? undefined : this.spec.sessionModel?.(this.sessionId)
      await window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('dsh-quick-ask-history',{detail:${JSON.stringify({ sessionId: this.sessionId ?? '', messages: history, model })}}))`, true).catch(() => {})
      return
    }
    const prompt = action.prompt?.trim() ?? ''
    if (!prompt) return
    try {
      const result = await this.spec.submit({
        prompt,
        ...(action.workspaceId === undefined ? {} : { workspaceId: action.workspaceId }),
        ...(action.sessionId === undefined ? {} : { sessionId: action.sessionId }),
        ...(action.model === undefined ? {} : { model: action.model }),
      })
      this.sessionId = result.sessionId
      if (window.isDestroyed()) return
      await window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('dsh-quick-ask-result',{detail:${JSON.stringify({ ok: true, sessionId: result.sessionId })}}))`, true)
    } catch {
      if (window.isDestroyed()) return
      await window.webContents.executeJavaScript("window.dispatchEvent(new CustomEvent('dsh-quick-ask-result',{detail:{ok:false}}))", true).catch(() => {})
    }
  }

  private publishUpdate(update: import('./runtime.ts').DesktopQuickAskUpdate): void {
    const window = this.window
    if (window === undefined || window.isDestroyed() || update.sessionId !== this.sessionId) return
    void window.webContents.executeJavaScript(`window.dispatchEvent(new CustomEvent('dsh-quick-ask-update',{detail:${JSON.stringify(update)}}))`, true).catch(() => {})
  }
}
