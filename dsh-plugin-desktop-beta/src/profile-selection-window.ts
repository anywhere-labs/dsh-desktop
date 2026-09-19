/** Isolated Profile chooser shared with the Recovery Assistant's Profile card. */

import type { BrowserWindow } from 'electron'
import { fileURLToPath } from 'node:url'
import {
  auxiliaryWindowChromeOptions,
  auxiliaryWindowHasCustomFrame,
} from './auxiliary-window-options.ts'
import { revealApplication } from './electron-reveal.ts'
import { createDesktopLocalWindow } from './local-window-policy.ts'
import { desktopRecoveryCopy } from './recovery-copy.ts'
import type { DesktopLocale } from './runtime.ts'
import type { DesktopStartupRecoveryProfileActions } from './startup-recovery-window.ts'

const PROFILE_SELECTOR_SCHEME = 'dsh-profile-selector:'
const PROFILE_SELECTOR_DOCUMENT = fileURLToPath(new URL('./native-ui/profile-selector.html', import.meta.url))
const MAX_PROFILE_NAME_BYTES = 255

export type DesktopProfileSelectionResult = 'restart' | 'cancel'

export interface DesktopProfileSelectionWindowOptions {
  readonly locale: DesktopLocale
  readonly profileActions: DesktopStartupRecoveryProfileActions
}

export interface DesktopProfileSelectionAction {
  readonly action: 'cancel' | 'create' | 'restart' | 'switch'
  readonly name?: string
}

/** Parse only bounded actions emitted by the local Profile selector document. */
export function parseDesktopProfileSelectionAction(href: string): DesktopProfileSelectionAction | undefined {
  let url: URL
  try { url = new URL(href) } catch { return undefined }
  if (url.protocol !== PROFILE_SELECTOR_SCHEME
    || url.username !== '' || url.password !== '' || url.port !== ''
    || url.pathname !== '' || url.hash !== '') return undefined
  const action = url.hostname
  const keys = [...url.searchParams.keys()]
  if (action === 'cancel' || action === 'create' || action === 'restart') {
    return keys.length === 0 ? { action } : undefined
  }
  if (action !== 'switch' || keys.length !== 1 || keys[0] !== 'name') return undefined
  const name = url.searchParams.get('name')
  if (name === null || name.length === 0 || Buffer.byteLength(name, 'utf8') > MAX_PROFILE_NAME_BYTES
    || name.includes('/') || name.includes('\\') || /[\0\r\n]/u.test(name)) return undefined
  return { action, name }
}

/** Profile-only startup surface; it does not expose Recovery tabs or operations. */
export class DesktopProfileSelectionWindow {
  private window: BrowserWindow | undefined
  private busy = false
  private notice: { readonly tone: 'success' | 'error'; readonly title: string; readonly body: string } | undefined
  private restartReady = false
  private settled = false
  private resolveResult: ((result: DesktopProfileSelectionResult) => void) | undefined
  private rejectResult: ((cause: unknown) => void) | undefined

  constructor(private readonly options: DesktopProfileSelectionWindowOptions) {}

  async run(): Promise<DesktopProfileSelectionResult> {
    const copy = desktopRecoveryCopy(this.options.locale)
    const result = new Promise<DesktopProfileSelectionResult>((resolve, reject) => {
      this.resolveResult = resolve
      this.rejectResult = reject
    })
    const window = createDesktopLocalWindow({
      partition: 'dsh-profile-selector',
      title: copy.tabs.profiles,
      ...auxiliaryWindowChromeOptions(process.platform, false),
      width: 640,
      height: 540,
      useContentSize: true,
      minWidth: 520,
      minHeight: 420,
      resizable: true,
      closable: false,
      maximizable: false,
      fullscreenable: false,
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#202124',
    })
    this.window = window
    window.accessibleTitle = copy.tabs.profiles
    window.removeMenu()
    const navigate = (event: Electron.Event, href: string): void => {
      event.preventDefault()
      const action = parseDesktopProfileSelectionAction(href)
      if (action !== undefined) void this.handleAction(action)
    }
    window.webContents.on('will-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    window.once('ready-to-show', () => {
      if (!this.settled && this.window === window && !window.isDestroyed()) revealApplication(window)
    })
    window.on('closed', () => {
      if (!this.settled) this.finish('cancel')
    })
    void this.render().catch(cause => { this.fail(cause) })
    return await result
  }

  show(): void {
    const window = this.window
    if (window !== undefined && !window.isDestroyed()) revealApplication(window)
  }

  private async handleAction(action: DesktopProfileSelectionAction): Promise<void> {
    if (this.busy || this.settled) return
    if (action.action === 'cancel') {
      this.finish('cancel')
      return
    }
    if (action.action === 'restart') {
      this.finish('restart')
      return
    }
    this.busy = true
    this.notice = undefined
    await this.render()
    const copy = desktopRecoveryCopy(this.options.locale)
    try {
      if (action.action === 'switch' && action.name !== undefined) {
        await this.options.profileActions.switchProfile(action.name, this.options.profileActions.token)
        this.restartReady = true
        this.notice = { tone: 'success', title: action.name, body: copy.profileSelectedSuccess }
      } else {
        const previous = this.options.profileActions.list().find(profile => profile.current)?.name
        await this.options.profileActions.openCreator()
        const selected = this.options.profileActions.list().find(profile => profile.current)?.name
        if (selected !== undefined && selected !== previous) {
          this.restartReady = true
          this.notice = { tone: 'success', title: selected, body: copy.profileSelectedSuccess }
        }
      }
    } catch {
      this.notice = { tone: 'error', title: copy.tabs.profiles, body: copy.actionFailed }
    }
    this.busy = false
    await this.render()
  }

  private async render(): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const notice = this.notice
    const state = Buffer.from(JSON.stringify({
      locale: this.options.locale,
      profiles: this.options.profileActions.list(),
      busy: this.busy,
      restartReady: this.restartReady,
      ...(notice === undefined ? {} : { notice }),
    }), 'utf8').toString('base64url')
    await window.loadFile(PROFILE_SELECTOR_DOCUMENT, {
      query: {
        state,
        locale: this.options.locale,
        platform: process.platform,
        frame: String(auxiliaryWindowHasCustomFrame(process.platform, false)),
      },
    })
    if (this.notice === notice) this.notice = undefined
  }

  private finish(result: DesktopProfileSelectionResult): void {
    if (this.settled) return
    this.settled = true
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    this.resolveResult?.(result)
    this.resolveResult = undefined
    this.rejectResult = undefined
  }

  private fail(cause: unknown): void {
    if (this.settled) return
    this.settled = true
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    this.rejectResult?.(cause)
    this.resolveResult = undefined
    this.rejectResult = undefined
  }
}
