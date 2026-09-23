/** OS permission policy kept independent of Electron for headless validation. */
import { desktopPermission, type DesktopPermission, type DesktopPermissionSnapshot, type DesktopPermissionStatus } from './permissions.ts'

export interface PermissionPlatform {
  readonly platform: string
  status(permission: DesktopPermission): DesktopPermissionStatus
  microphone(): Promise<boolean>
  screen(): Promise<void>
  accessibility(): Promise<void>
  openSettings(url: string): Promise<void>
}

export class NativePermissions {
  private readonly pending = new Map<DesktopPermission, Promise<DesktopPermissionSnapshot>>()
  constructor(private readonly native: PermissionPlatform) {}

  query(value: unknown): DesktopPermissionSnapshot {
    const permission = desktopPermission(value)
    const status = this.native.platform === 'darwin' || this.native.platform === 'win32' ? this.native.status(permission) : 'unknown'
    return { permission, status,
      canRequest: this.native.platform === 'darwin' && (status === 'not-determined' || status === 'unknown'),
      canOpenSettings: this.settingsUrl(permission) !== undefined,
    }
  }

  request(value: unknown): Promise<DesktopPermissionSnapshot> {
    const permission = desktopPermission(value)
    const pending = this.pending.get(permission)
    if (pending) return pending
    const current = this.query(permission)
    if (!current.canRequest) return Promise.resolve(current)
    const request = (async () => {
      if (permission === 'microphone') await this.native.microphone()
      else if (permission === 'screen') await this.native.screen()
      else await this.native.accessibility()
      return this.query(permission)
    })().finally(() => this.pending.delete(permission))
    this.pending.set(permission, request)
    return request
  }

  async openSettings(value: unknown): Promise<void> {
    const url = this.settingsUrl(desktopPermission(value))
    if (!url) throw new Error('This platform has no Desktop permission settings shortcut')
    await this.native.openSettings(url)
  }

  private settingsUrl(permission: DesktopPermission): string | undefined {
    if (this.native.platform === 'darwin') {
      const pane = { microphone: 'Privacy_Microphone', screen: 'Privacy_ScreenCapture', accessibility: 'Privacy_Accessibility' }[permission]
      return `x-apple.systempreferences:com.apple.preference.security?${pane}`
    }
    if (this.native.platform === 'win32' && permission === 'microphone') return 'ms-settings:privacy-microphone'
    return undefined
  }
}
