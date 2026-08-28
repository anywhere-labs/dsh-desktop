/** Host-independent Electron recovery window for profile startup failures. */

import { app, BrowserWindow, screen, shell } from 'electron'
import { execFile } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  auxiliaryWindowChromeOptions,
  auxiliaryWindowHasCustomFrame,
} from './auxiliary-window-options.ts'
import { showDesktopDialog, showDesktopMessageBox } from './desktop-dialog-window.ts'
import type { DesktopLocale } from './runtime.ts'
import { applicationNeedsReveal, revealApplication } from './electron-reveal.ts'
import { desktopRestartConfirmationCopy } from './tray-locale.ts'
import {
  desktopRecoveryCopy,
  type DesktopRecoveryTab,
  type DesktopStartupFailureStage,
} from './recovery-copy.ts'
import {
  DesktopStartupRecoveryController,
  DesktopStartupRecoveryControllerError,
  type DesktopStartupRecoveryCheckpointPreview,
  type DesktopStartupRecoveryUninstallPreview,
  type DesktopStartupRecoverySnapshot,
} from './startup-recovery-controller.ts'

const RECOVERY_SCHEME = 'dsh-recovery:'
const RECOVERY_DOCUMENT = fileURLToPath(new URL('./native-ui/recovery.html', import.meta.url))
const DEFAULT_RECOVERY_WIDTH = 800
const DEFAULT_RECOVERY_HEIGHT = 760
const DEFAULT_RECOVERY_MIN_WIDTH = 680
const DEFAULT_RECOVERY_MIN_HEIGHT = 560
const RECOVERY_WORK_AREA_INSET = 48

type RecoveryWindowResult = 'restart' | 'quit'
type RecoveryNoticeTone = 'info' | 'success' | 'warning' | 'error'

export type { DesktopStartupFailureStage } from './recovery-copy.ts'

interface RecoveryNotice {
  readonly tone: RecoveryNoticeTone
  readonly title: string
  readonly body: string
}

interface RecoveryDiagnosticsState {
  readonly status: 'saving' | 'saved' | 'failed'
  readonly filename?: string
}

export interface DesktopStartupRecoveryWindowOptions {
  readonly controller?: DesktopStartupRecoveryController
  /** Fixed active-profile paths selected by the main process. */
  readonly configurationPaths?: DesktopStartupRecoveryConfigurationPaths
  readonly locale: DesktopLocale
  readonly failureStage: DesktopStartupFailureStage
  readonly failureDetail: string
  /** True when the user intentionally entered recovery before Host boot. */
  readonly requested?: boolean
  readonly exportDiagnostics: (signal: AbortSignal) => Promise<string>
  /** Open the launcher-owned terminal even when the Host did not start. */
  readonly openTerminal?: () => void | Promise<void>
  /** Main-process validated actions available from the failure generation. */
  readonly profileActions?: DesktopStartupRecoveryProfileActions
}

export interface DesktopStartupRecoveryProfile {
  readonly name: string
  readonly current: boolean
  readonly selectable: boolean
}

export interface DesktopStartupRecoveryProfileActions {
  /** Opaque per-window capability token; the main process must re-check it. */
  readonly token: string
  readonly list: () => readonly DesktopStartupRecoveryProfile[]
  readonly switchProfile: (name: string, token: string) => void | Promise<void>
  /** Open the isolated native creator; it accepts no filesystem path. */
  readonly openCreator: () => void | Promise<void>
}

export interface DesktopStartupRecoveryConfigurationPaths {
  readonly settingsDocument: string
  readonly profilePatch: string
  readonly profileManifest: string
  readonly profileDirectory: string
}

export interface DesktopStartupRecoveryScreenApi {
  getCursorScreenPoint(): { readonly x: number; readonly y: number }
  getDisplayNearestPoint(point: { readonly x: number; readonly y: number }): {
    readonly workAreaSize: { readonly width: number; readonly height: number }
  }
  getPrimaryDisplay(): {
    readonly workAreaSize: { readonly width: number; readonly height: number }
  }
}

export interface DesktopStartupRecoveryWindowBounds {
  readonly width: number
  readonly height: number
  readonly minWidth: number
  readonly minHeight: number
}

function validWorkAreaSize(
  value: { readonly width: number; readonly height: number } | undefined,
): { readonly width: number; readonly height: number } | undefined {
  if (value === undefined
    || !Number.isFinite(value.width)
    || !Number.isFinite(value.height)
    || value.width < 1
    || value.height < 1) return undefined
  return { width: Math.floor(value.width), height: Math.floor(value.height) }
}

function currentWorkAreaSize(
  screenApi: DesktopStartupRecoveryScreenApi,
): { readonly width: number; readonly height: number } | undefined {
  try {
    const current = validWorkAreaSize(
      screenApi.getDisplayNearestPoint(screenApi.getCursorScreenPoint()).workAreaSize,
    )
    if (current !== undefined) return current
  } catch {
    // Electron's screen API can be unavailable during an early-ready failure.
  }
  try {
    return validWorkAreaSize(screenApi.getPrimaryDisplay().workAreaSize)
  } catch {
    return undefined
  }
}

/** Clamp recovery dimensions to the current display, with the primary display as fallback. */
export function desktopStartupRecoveryWindowBounds(
  screenApi: DesktopStartupRecoveryScreenApi = screen,
): DesktopStartupRecoveryWindowBounds {
  const workArea = currentWorkAreaSize(screenApi)
  const width = workArea === undefined
    ? DEFAULT_RECOVERY_WIDTH
    : Math.min(DEFAULT_RECOVERY_WIDTH, Math.max(1, workArea.width - RECOVERY_WORK_AREA_INSET))
  const height = workArea === undefined
    ? DEFAULT_RECOVERY_HEIGHT
    : Math.min(DEFAULT_RECOVERY_HEIGHT, Math.max(1, workArea.height - RECOVERY_WORK_AREA_INSET))
  return {
    width,
    height,
    minWidth: Math.min(DEFAULT_RECOVERY_MIN_WIDTH, width),
    minHeight: Math.min(DEFAULT_RECOVERY_MIN_HEIGHT, height),
  }
}

export interface DesktopStartupRecoveryViewModel {
  readonly locale: DesktopLocale
  readonly failureStage: DesktopStartupFailureStage
  readonly failureDetail: string
  readonly requested?: boolean
  readonly snapshot?: DesktopStartupRecoverySnapshot
  readonly snapshotError?: string
  readonly diagnostics: RecoveryDiagnosticsState
  readonly notice?: RecoveryNotice
  readonly busy: boolean
  readonly restartReady: boolean
  readonly activeTab: DesktopRecoveryTab
  readonly configurationAvailable: boolean
  readonly profiles?: readonly DesktopStartupRecoveryProfile[]
  readonly profileActionToken?: string
  readonly terminalAvailable?: boolean
  readonly profileCreatorAvailable?: boolean
}

/** Parse only the fixed action origin used by the local shadcn recovery document. */
export function parseDesktopStartupRecoveryAction(
  href: string,
): { readonly action: string; readonly id?: string; readonly name?: string } | undefined {
  let url: URL
  try { url = new URL(href) } catch { return undefined }
  if (url.protocol !== RECOVERY_SCHEME
    || url.username.length > 0
    || url.password.length > 0
    || url.port.length > 0
    || url.pathname !== ''
    || url.hash.length > 0) return undefined
  const action = url.hostname
  const allowed = new Set([
    'preview-uninstall',
    'preview-checkpoint',
    'open-checkpoint',
    'export-diagnostics',
    'show-diagnostics',
    'open-settings-document',
    'open-profile-patch',
    'open-profile-manifest',
    'open-profile-directory',
    'open-terminal',
    'open-profile-creator',
    'switch-profile',
    'restart',
    'quit',
  ])
  if (!allowed.has(action)) return undefined
  const keys = [...url.searchParams.keys()]
  if (keys.some(key => key !== 'id' && key !== 'name') || url.searchParams.getAll('id').length > 1 || url.searchParams.getAll('name').length > 1) return undefined
  const id = url.searchParams.get('id') ?? undefined
  const needsId = action.startsWith('preview-') || action === 'switch-profile' || action === 'open-checkpoint'
  if (needsId !== (id !== undefined)) return undefined
  if (id !== undefined && (action === 'preview-checkpoint' || action === 'open-checkpoint')) {
    if (!/^slot-[123]$/u.test(id)) return undefined
  } else if (id !== undefined && (id.length < 8 || id.length > 160)) return undefined
  const name = url.searchParams.get('name') ?? undefined
  if (action === 'switch-profile') {
    if (name === undefined || name.length === 0 || Buffer.byteLength(name, 'utf8') > 255 || name.includes('/') || name.includes('\\') || /[\0\r\n]/u.test(name)) return undefined
  } else if (name !== undefined) return undefined
  return { action, ...(id === undefined ? {} : { id }), ...(name === undefined ? {} : { name }) }
}

/** One native recovery window whose renderer has no Node, IPC, or network capability. */
export class DesktopStartupRecoveryWindow {
  private window: BrowserWindow | undefined
  private snapshot: DesktopStartupRecoverySnapshot | undefined
  private snapshotError: string | undefined
  private diagnostics: RecoveryDiagnosticsState = { status: 'saving' }
  private diagnosticPath: string | undefined
  private diagnosticTask: Promise<string> | undefined
  private readonly diagnosticAbort = new AbortController()
  private notice: RecoveryNotice | undefined
  private busy = false
  private restartReady = false
  private activeTab: DesktopRecoveryTab = 'plugins'
  private profiles: readonly DesktopStartupRecoveryProfile[] | undefined
  private resolveResult: ((result: RecoveryWindowResult) => void) | undefined
  private settled = false

  constructor(private readonly options: DesktopStartupRecoveryWindowOptions) {}

  /** Open the local recovery document and settle only on explicit restart, quit, or close. */
  async run(): Promise<RecoveryWindowResult> {
    const copy = desktopRecoveryCopy(this.options.locale)
    const result = new Promise<RecoveryWindowResult>(resolve => { this.resolveResult = resolve })
    try {
      this.snapshot = await this.options.controller?.snapshot()
    } catch (cause) {
      this.snapshotError = cause instanceof Error ? cause.message : String(cause)
    }
    this.refreshProfiles()
    const window = new BrowserWindow({
      title: copy.title,
      ...auxiliaryWindowChromeOptions(),
      ...desktopStartupRecoveryWindowBounds(),
      show: false,
      autoHideMenuBar: true,
      backgroundColor: '#202124',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        nodeIntegrationInSubFrames: false,
        sandbox: true,
        webSecurity: true,
        webviewTag: false,
        spellcheck: false,
        partition: 'dsh-recovery',
      },
    })
    this.window = window
    window.accessibleTitle = copy.title
    window.removeMenu()
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-attach-webview', event => { event.preventDefault() })
    const navigate = (event: Electron.Event, href: string): void => {
      const action = parseDesktopStartupRecoveryAction(href)
      event.preventDefault()
      if (action !== undefined) void this.handleAction(action)
    }
    window.webContents.on('will-navigate', navigate)
    window.webContents.on('will-redirect', navigate)
    const show = (): void => { revealApplication(window) }
    const activate = (): void => {
      if (applicationNeedsReveal(window)) show()
    }
    app.on('activate', activate)
    if (process.platform === 'darwin') app.on('did-become-active', activate)
    window.once('ready-to-show', show)
    window.on('closed', () => {
      app.off('activate', activate)
      if (process.platform === 'darwin') app.off('did-become-active', activate)
      this.window = undefined
      this.finish('quit')
    })
    await this.render()
    void this.startDiagnosticExport().catch(() => {})
    return await result
  }

  /** Bring an already open recovery window to the foreground. */
  show(): void {
    if (this.window === undefined || this.window.isDestroyed()) return
    revealApplication(this.window)
  }

  private async handleAction(action: { readonly action: string; readonly id?: string; readonly name?: string }): Promise<void> {
    if (this.busy || this.settled) return
    const copy = desktopRecoveryCopy(this.options.locale)
    try {
      if (action.action === 'preview-uninstall' && action.id !== undefined) {
        this.activeTab = 'plugins'
        const preview = await this.requireController().previewUninstall(action.id)
        if (await this.confirmRecoveryAction('uninstall', preview)) {
          await this.runBusy(async () => {
            const result = await this.requireController().executeUninstall(preview.previewId)
            this.notice = {
              tone: 'success',
              title: result.packageName,
              body: copy.uninstalledSuccess,
            }
            this.restartReady = true
            await this.refreshSnapshot()
          })
        }
      } else if (action.action === 'preview-checkpoint' && action.id !== undefined) {
        this.activeTab = 'rollback'
        const preview = await this.requireController().previewCheckpointRestore(action.id as `slot-${1 | 2 | 3}`)
        if (await this.confirmRecoveryAction('checkpoint', preview)) {
          await this.runBusy(async () => {
            const result = await this.requireController().executeCheckpointRestore(preview.previewId)
            const slotNumber = result.slotId.slice(-1)
            const slotLabel = this.options.locale === 'zh' ? `槽位 ${slotNumber}` : `Slot ${slotNumber}`
            this.notice = {
              tone: 'success',
              title: slotLabel,
              body: copy.rollbackSuccess(slotLabel),
            }
            this.restartReady = true
            await this.refreshSnapshot()
          })
        }
      } else if (action.action === 'open-checkpoint' && action.id !== undefined) {
        this.activeTab = 'rollback'
        await this.requireController().openCheckpoint(action.id as `slot-${1 | 2 | 3}`)
      } else if (action.action === 'export-diagnostics') {
        this.activeTab = 'diagnostics'
        await this.startDiagnosticExport().catch(() => {})
      } else if (action.action === 'show-diagnostics' && this.diagnosticPath !== undefined) {
        this.activeTab = 'diagnostics'
        shell.showItemInFolder(this.diagnosticPath)
      } else if (action.action === 'open-terminal') {
        if (this.options.openTerminal === undefined) throw new Error('DSH Terminal is unavailable for this startup stage.')
        await this.options.openTerminal()
      } else if (action.action === 'open-profile-creator') {
        this.activeTab = 'profiles'
        if (this.options.profileActions === undefined) throw new Error('Profile creation is unavailable for this startup stage.')
        await this.options.profileActions.openCreator()
      } else if (action.action === 'switch-profile' && action.id !== undefined && action.name !== undefined) {
        this.activeTab = 'profiles'
        const actions = this.options.profileActions
        if (actions === undefined) throw new Error('Profile switching is unavailable for this startup stage.')
        const profileName = action.name
        const actionToken = action.id
        await this.runBusy(async () => {
          await actions.switchProfile(profileName, actionToken)
          this.notice = {
            tone: 'success',
            title: profileName,
            body: copy.profileSelectedSuccess,
          }
          this.restartReady = true
          this.refreshProfiles()
        })
      } else if (action.action === 'open-settings-document') {
        this.activeTab = 'diagnostics'
        await this.openConfigurationPath('settingsDocument')
      } else if (action.action === 'open-profile-patch') {
        this.activeTab = 'diagnostics'
        await this.openConfigurationPath('profilePatch')
      } else if (action.action === 'open-profile-manifest') {
        this.activeTab = 'diagnostics'
        await this.openConfigurationPath('profileManifest')
      } else if (action.action === 'open-profile-directory') {
        this.activeTab = 'diagnostics'
        await this.openConfigurationPath('profileDirectory')
      } else if (action.action === 'restart') {
        const copy = desktopRestartConfirmationCopy(this.options.locale)
        const window = this.window
        if (window === undefined || window.isDestroyed()) return
        const result = await showDesktopMessageBox({
          type: 'question',
          title: copy.title,
          message: copy.message,
          detail: copy.detail,
          buttons: [copy.confirm, copy.cancel],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        }, window)
        if (result.response === 0) this.finish('restart')
        return
      } else if (action.action === 'quit') {
        await this.ensureDiagnostics()
        this.finish('quit')
        return
      }
    } catch (cause) {
      this.notice = {
        tone: 'error',
        title: copy.title,
        body: copy.actionFailed,
      }
      if (action.action === 'preview-checkpoint' || action.action === 'preview-uninstall') {
        await this.showOperationFailure(cause, action.action).catch(() => {})
      }
    }
    await this.render()
  }

  private async showOperationFailure(
    cause: unknown,
    action: 'preview-checkpoint' | 'preview-uninstall',
  ): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const copy = desktopRecoveryCopy(this.options.locale)
    const error = cause instanceof DesktopStartupRecoveryControllerError ? cause : undefined
    const stage = error?.operationStage ?? 'checkpoint-restore'
    const message = error?.message ?? (cause instanceof Error ? cause.message : String(cause))
    const detail = [
      `${copy.operationStage}: ${copy.operationStageLabels[stage]}`,
      `${copy.errorCode}: ${error?.code ?? 'operation-failed'}`,
      '',
      message,
      ...(error?.diagnosticDetail === undefined
        ? []
        : ['', copy.technicalDetails, error.diagnosticDetail]),
    ].join('\n')
    await showDesktopDialog({
      type: 'error',
      title: action === 'preview-checkpoint' ? copy.rollbackFailedTitle : copy.uninstallFailedTitle,
      message: action === 'preview-checkpoint' ? copy.rollbackFailedMessage : copy.uninstallFailedMessage,
      detail,
      buttons: [copy.close],
      defaultId: 0,
      cancelId: 0,
      presentation: 'diagnostic',
    }, window)
  }

  private async confirmRecoveryAction(
    kind: 'uninstall' | 'checkpoint',
    preview: DesktopStartupRecoveryUninstallPreview | DesktopStartupRecoveryCheckpointPreview,
  ): Promise<boolean> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return false
    const copy = desktopRecoveryCopy(this.options.locale)
    const slotNumber = 'slotId' in preview ? preview.slotId.slice(-1) : undefined
    const message = 'packageName' in preview
      ? preview.packageName
      : this.options.locale === 'zh' ? `槽位 ${slotNumber}` : `Slot ${slotNumber}`
    const checkpointTime = 'capturedAt' in preview && !Number.isNaN(Date.parse(preview.capturedAt))
      ? new Date(preview.capturedAt).toLocaleString(this.options.locale === 'zh' ? 'zh-CN' : 'en-US')
      : copy.unknown
    const result = await showDesktopMessageBox({
      type: kind === 'uninstall' ? 'warning' : 'question',
      title: kind === 'uninstall'
        ? copy.confirmUninstall
        : copy.confirmRollback,
      message,
      detail: kind === 'uninstall'
        ? copy.confirmUninstallBody
        : copy.confirmRollbackBody(checkpointTime),
      buttons: [
        kind === 'uninstall' ? copy.uninstall : copy.confirmRollbackAction,
        copy.cancel,
      ],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    }, window)
    return result.response === 0
  }
  private async runBusy(operation: () => Promise<void>): Promise<void> {
    this.busy = true
    await this.render()
    try { await operation() } finally { this.busy = false }
  }

  private async refreshSnapshot(): Promise<void> {
    try {
      this.snapshot = await this.requireController().snapshot()
      this.snapshotError = undefined
    } catch (cause) {
      this.snapshotError = cause instanceof Error ? cause.message : String(cause)
    }
  }

  private refreshProfiles(): void {
    try {
      this.profiles = this.options.profileActions?.list()
    } catch {
      this.profiles = undefined
    }
  }

  private async ensureDiagnostics(): Promise<boolean> {
    try {
      await this.startDiagnosticExport()
      return true
    } catch {
      return false
    }
  }

  private startDiagnosticExport(): Promise<string> {
    if (this.diagnostics.status === 'saved' && this.diagnosticPath !== undefined) {
      return Promise.resolve(this.diagnosticPath)
    }
    if (this.diagnosticTask !== undefined) return this.diagnosticTask

    const task = this.saveDiagnostics()
    this.diagnosticTask = task
    void task.catch(() => {
      if (this.diagnosticTask === task) this.diagnosticTask = undefined
    })
    return task
  }

  private async saveDiagnostics(): Promise<string> {
    this.diagnostics = { status: 'saving' }
    await this.render()
    try {
      const path = await this.options.exportDiagnostics(this.diagnosticAbort.signal)
      this.diagnosticPath = path
      this.diagnostics = { status: 'saved', filename: basename(path) }
      await this.render()
      return path
    } catch (cause) {
      this.diagnostics = { status: 'failed' }
      this.notice = {
        tone: 'error',
        title: desktopRecoveryCopy(this.options.locale).diagnostics,
        body: desktopRecoveryCopy(this.options.locale).diagnosticsFailed,
      }
      await this.render()
      throw cause
    }
  }

  private async render(): Promise<void> {
    const window = this.window
    if (window === undefined || window.isDestroyed()) return
    const notice = this.notice
    const model: DesktopStartupRecoveryViewModel = {
      locale: this.options.locale,
      failureStage: this.options.failureStage,
      failureDetail: this.options.failureDetail,
      ...(this.options.requested === true ? { requested: true } : {}),
      ...(this.snapshot === undefined ? {} : { snapshot: this.snapshot }),
      ...(this.snapshotError === undefined ? {} : { snapshotError: this.snapshotError }),
      diagnostics: this.diagnostics,
      ...(notice === undefined ? {} : { notice }),
      busy: this.busy,
      restartReady: this.restartReady,
      activeTab: this.activeTab,
      configurationAvailable: this.options.configurationPaths !== undefined,
      ...(this.profiles === undefined ? {} : { profiles: this.profiles }),
      ...(this.options.profileActions === undefined ? {} : { profileActionToken: this.options.profileActions.token }),
      ...(this.options.openTerminal === undefined ? {} : { terminalAvailable: true }),
      ...(this.options.profileActions === undefined ? {} : { profileCreatorAvailable: true }),
    }
    const state = Buffer.from(JSON.stringify(model), 'utf8').toString('base64url')
    await window.loadFile(RECOVERY_DOCUMENT, {
      query: {
        state,
        locale: this.options.locale,
        platform: process.platform,
        frame: String(auxiliaryWindowHasCustomFrame()),
      },
    })
    if (this.notice === notice) this.notice = undefined
  }

  private finish(result: RecoveryWindowResult): void {
    if (this.settled) return
    this.settled = true
    this.diagnosticAbort.abort(new DOMException('Recovery window closed.', 'AbortError'))
    const window = this.window
    this.window = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    this.resolveResult?.(result)
    this.resolveResult = undefined
  }

  private requireController(): DesktopStartupRecoveryController {
    if (this.options.controller === undefined) {
      throw new Error('Desktop plugin recovery actions are unavailable for this startup stage.')
    }
    return this.options.controller
  }

  private async openConfigurationPath(
    kind: keyof DesktopStartupRecoveryConfigurationPaths,
  ): Promise<void> {
    const path = this.options.configurationPaths?.[kind]
    if (path === undefined) throw new Error('Desktop profile configuration is unavailable for this startup stage.')
    if (kind === 'settingsDocument') {
      await mkdir(dirname(path), { recursive: true, mode: 0o700 })
      try {
        await writeFile(path, '', { flag: 'wx', mode: 0o600 })
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'EEXIST') throw cause
      }
    }
    if (kind === 'settingsDocument' && process.platform === 'darwin') {
      await new Promise<void>((resolve, reject) => {
        execFile('/usr/bin/open', ['-t', path], { windowsHide: true }, cause => {
          if (cause === null) resolve()
          else reject(cause)
        })
      })
      return
    }
    const error = await shell.openPath(path)
    if (error.length > 0) throw new Error(error)
  }
}

export default DesktopStartupRecoveryWindow
