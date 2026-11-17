/** Electron-only tray, materials, app icon and user-turn notifications. */
import { unpackedPath } from './asar-archive-policy.ts'
import { join } from 'node:path'
import { Menu, nativeImage, nativeTheme, Notification, Tray, type BrowserWindow, type Dock, type NativeImage } from 'electron'
import type { DesktopAppIcon } from './app-icon.ts'
import { desktopMenu } from './desktop-menu.ts'
import { startupNoticeCopy, type DesktopStartupNotice } from './host-startup-limit.ts'
import { roleApplicationMenuTemplate } from './menu-locale.ts'
import { notificationCopy, notificationEnabled } from './notifications.ts'
import type { DesktopCommand, DesktopPreferences, DesktopState, DesktopNotification } from './desktop-contract.ts'
import { windowMaterial } from './window-material.ts'
import { IPC } from './ipc.ts'
import { updateLabel } from './update-state.ts'

export function applyWindowMaterial(window: BrowserWindow, preferences: DesktopPreferences): void {
  const material = windowMaterial(preferences)
  if (process.platform === 'darwin') window.setVibrancy(material === 'transparent' ? 'sidebar' : null)
  window.setBackgroundColor(material === 'off' ? nativeTheme.shouldUseDarkColors ? '#1b1b1c' : '#f9fafb' : '#00000000')
  window.webContents.send(IPC.material, material)
}

/** icons:export writes the classic set into its own directory below `build` and `assets`. */
function appIconFile(root: string, directory: 'build' | 'assets', icon: DesktopAppIcon, name: string): string {
  return unpackedPath(join(root, directory, ...icon === 'classic' ? ['classic'] : [], name))
}

/**
 * @param root - The application directory.
 * @param platform - `process.platform`.
 * @param icon - The chosen artwork.
 * @param dark - Whether the system theme is dark. Only the default whale tail has a Dark rendition; the classic
 * composition already has the system-dark fill, so it looks the same either way.
 * @returns The icon of windows: every ICO frame on Windows, the full image on Linux, and none on macOS. Shortcuts and
 * the Linux desktop entry show the same files.
 */
export function appWindowIcon(root: string, platform: NodeJS.Platform, icon: DesktopAppIcon, dark = false): string | undefined {
  if (platform === 'darwin') return undefined
  return appIconFile(root, 'build', icon, `app-icon${icon === 'default' && dark ? '-dark' : ''}.${platform === 'win32' ? 'ico' : 'png'}`)
}

/**
 * @param root - The application directory.
 * @param packaged - Whether the app runs from its package.
 * @param icon - The chosen artwork.
 * @returns The Dock image, or null for the bundle's own layered icon, which follows the system's icon
 * appearances. An unpackaged Electron has no bundle icon of ours, so development always gets an image.
 */
export function appDockIcon(root: string, packaged: boolean, icon: DesktopAppIcon): string | null {
  return packaged && icon === 'default' ? null : appIconFile(root, 'build', icon, 'app-icon-mac.png')
}

/**
 * @param root - The application directory.
 * @param platform - `process.platform`.
 * @param icon - The chosen artwork.
 * @returns The tray image: a template the macOS menu bar tints, or the colored image elsewhere.
 */
export function appTrayIcon(root: string, platform: NodeJS.Platform, icon: DesktopAppIcon): string {
  return appIconFile(root, 'assets', icon, platform === 'darwin' ? 'tray-iconTemplate.png' : 'tray-icon-blue.png')
}

export class NativeDesktop {
  private tray: Tray | undefined
  private readonly notifications = new Set<Notification>()
  /** The artwork the Dock, window frames and tray show, and whether windows show its Dark rendition; set by the first refresh. */
  private appIcon: DesktopAppIcon | undefined
  private dark: boolean | undefined
  constructor(private readonly options: {
    root: string; language(): string; state(): DesktopState; window(): BrowserWindow | undefined
    show(): void; run(command: DesktopCommand): void; warn(error: unknown): void
    /** The saved app icon; read on every refresh, so it must stay cheap. */
    appIcon(): DesktopAppIcon
    /**
     * Whether Windows and Linux show the Dark rendition, as macOS does with the bundle's layered icon while the system
     * appearance is dark. Read on every refresh; call {@link NativeDesktop.appearanceChanged} when the theme changes.
     */
    dark(): boolean
    /** Whether the app runs from its package, whose bundle icon the Dock shows unless told otherwise. */
    packaged: boolean
    /** Every open window: their frame icons follow the app icon on Windows and Linux. */
    windows(): readonly BrowserWindow[]
    /** The macOS Dock; undefined elsewhere. */
    dock(): Pick<Dock, 'setIcon'> | undefined
    /** Show the icon outside the running app as well: the shortcuts and desktop entry the installed package shows. */
    installed?(icon: DesktopAppIcon, dark: boolean): void
  }) {}
  get available(): boolean { return !!this.tray && !this.tray.isDestroyed() }
  createTray(): void {
    this.syncAppIcon()
    try {
      this.tray = new Tray(this.trayImage(this.appIcon ?? 'default'))
      this.tray.on('click', this.options.show)
      this.tray.on('double-click', this.options.show)
      this.refresh()
    } catch (error) { this.options.warn(error) }
  }
  /**
   * Give a window created after the last change the current frame icon; windows the shell creates already carry it.
   * @param window - A new window, such as the sign-in window.
   */
  decorateWindow(window: BrowserWindow): void {
    const frame = this.appIcon === undefined ? undefined : appWindowIcon(this.options.root, process.platform, this.appIcon, this.dark)
    if (frame === undefined) return
    try { window.setIcon(frame) } catch (error) { this.options.warn(error) }
  }
  /** Follow a change of the system theme with the window icons, shortcuts and desktop entry. */
  appearanceChanged(): void { this.syncAppIcon() }
  items() { return desktopMenu(this.options.state(), this.options.language(), this.options.show, this.options.run) }
  refresh(): void {
    this.syncAppIcon()
    if (process.platform !== 'win32') Menu.setApplicationMenu(Menu.buildFromTemplate(
      roleApplicationMenuTemplate(this.items(), this.options.language()),
    ))
    if (!this.available) return
    const state = this.options.state()
    this.tray!.setToolTip(`DSH NEXT · ${state.selected} · ${state.phase}${state.updates && state.updates.phase !== 'idle' ? ` · ${updateLabel(state.updates, this.options.language())}` : ''}`)
    if (process.platform === 'darwin') {
      const progress = state.updates
      this.tray!.setTitle(progress?.phase === 'downloading'
        ? progress.total ? `${Math.min(100, Math.floor((progress.received ?? 0) / progress.total * 100))}%` : `${Math.floor((progress.received ?? 0) / 1048576)} MB`
        : progress?.phase === 'ready' ? '✓' : '')
    }
    this.tray!.setContextMenu(Menu.buildFromTemplate(this.items()))
  }
  private trayImage(icon: DesktopAppIcon): NativeImage {
    const image = nativeImage.createFromPath(appTrayIcon(this.options.root, process.platform, icon))
    if (image.isEmpty()) throw new Error('Tray icon is unavailable')
    if (process.platform === 'darwin') image.setTemplateImage(true)
    return image
  }
  /**
   * Show the saved app icon wherever the running app can: the Dock, every window frame and the tray, then hand it on
   * for what the installed package shows. Every refresh follows a state change and every theme change calls
   * {@link NativeDesktop.appearanceChanged}, so a saved choice or a new theme shows at once; an unchanged choice and
   * theme change nothing, and the first refresh of a launch applies them again.
   */
  private syncAppIcon(): void {
    const icon = this.options.appIcon()
    const dark = this.options.dark()
    const previous = this.appIcon
    if (icon === previous && dark === this.dark) return
    this.appIcon = icon
    this.dark = dark
    const { root, packaged } = this.options
    try {
      if (process.platform === 'darwin' && icon !== previous) {
        const image = appDockIcon(root, packaged, icon)
        // A launch leaves the Dock to the bundle's own layered icon, as releases before this choice did. Only a switch
        // back from another icon hands it back, with an empty image that Electron passes to NSApp as nil.
        if (image !== null) this.options.dock()?.setIcon(image)
        else if (previous !== undefined) this.options.dock()?.setIcon(nativeImage.createEmpty())
      }
      const frame = appWindowIcon(root, process.platform, icon, dark)
      if (frame !== undefined) for (const window of this.options.windows()) if (!window.isDestroyed()) window.setIcon(frame)
      // The tray keeps its colored glyph in either theme.
      if (icon !== previous && this.available) this.tray!.setImage(this.trayImage(icon))
    } catch (error) { this.options.warn(error) }
    try { this.options.installed?.(icon, dark) } catch (error) { this.options.warn(error) }
  }
  notify(message: DesktopNotification): void {
    const state = this.options.state()
    const window = this.options.window()
    if (!Notification.isSupported() || !notificationEnabled(state.preferences, message.outcome) || window?.isFocused()) return
    const notification = new Notification(notificationCopy(message, this.options.language()))
    this.notifications.add(notification)
    notification.once('click', this.options.show)
    notification.once('close', () => this.notifications.delete(notification))
    notification.once('failed', (_event, error) => { this.notifications.delete(notification); this.options.warn(error) })
    notification.show()
    if (this.notifications.size > 10) { const oldest = this.notifications.values().next().value!; oldest.close(); this.notifications.delete(oldest) }
  }
  /**
   * Say once that a Host start allowed more than a minute is still going, and where recovery is: the
   * Windows tray icon is often hidden among the overflow icons.
   * @returns Withdraws the notification once the start settles.
   */
  notifyStartupSlow(notice: DesktopStartupNotice): () => void {
    if (!Notification.isSupported()) return () => {}
    const notification = new Notification(startupNoticeCopy(notice, this.options.language(), process.platform, this.available))
    this.notifications.add(notification)
    notification.once('click', this.options.show)
    notification.once('close', () => this.notifications.delete(notification))
    notification.once('failed', (_event, error) => { this.notifications.delete(notification); this.options.warn(error) })
    notification.show()
    return () => { if (this.notifications.delete(notification)) notification.close() }
  }
  notifyUpdate(version: string, onSelect: () => void): void {
    if (!Notification.isSupported()) { onSelect(); return }
    const zh = this.options.language().toLowerCase().startsWith('zh')
    const notification = new Notification({
      title: 'DSH NEXT',
      body: zh ? `发现新版本 v${version}，点击下载更新。` : `DSH NEXT v${version} is available. Click to download the update.`,
    })
    this.notifications.add(notification)
    notification.once('click', () => { this.options.show(); onSelect() })
    notification.once('close', () => this.notifications.delete(notification))
    notification.once('failed', (_event, error) => { this.notifications.delete(notification); this.options.warn(error) })
    notification.show()
    if (this.notifications.size > 10) { const oldest = this.notifications.values().next().value!; oldest.close(); this.notifications.delete(oldest) }
  }
  close(): void {
    this.tray?.destroy(); this.tray = undefined
    for (const item of this.notifications) item.close()
    this.notifications.clear()
  }
}
