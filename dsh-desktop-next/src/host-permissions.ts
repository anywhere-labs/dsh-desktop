/** Private request/reply bridge. Host plugins cannot synthesize a renderer user gesture. */
import { desktopPermission, type DesktopPermissionAction, type DesktopPermissionSnapshot, type DesktopPermissions } from './permissions.ts'

type Connection = Pick<NodeJS.Process, 'on' | 'off' | 'send' | 'connected'>

export class HostPermissions implements DesktopPermissions {
  private nextId = 1
  private disposed = false
  private readonly pending = new Map<number, { permission: string; resolve(value: DesktopPermissionSnapshot): void; reject(error: Error): void }>()
  constructor(private readonly connection: Connection) {
    connection.on('message', this.receive)
    connection.on('disconnect', this.dispose)
  }
  query: DesktopPermissions['query'] = permission => this.call('query', permission)
  request: DesktopPermissions['request'] = permission => this.call('request', permission)
  openSettings: DesktopPermissions['openSettings'] = async permission => { await this.call('open-settings', permission) }

  private receive = (message: unknown): void => {
    if (!message || typeof message !== 'object' || !('type' in message) || message.type !== 'permission-result') return
    const result = message as { requestId?: unknown; snapshot?: unknown; error?: unknown }
    if (typeof result.requestId !== 'number') return
    const pending = this.pending.get(result.requestId)
    if (!pending) return
    if (typeof result.error === 'string') { pending.reject(new Error(result.error)); return }
    const value = result.snapshot as Partial<DesktopPermissionSnapshot> | null | undefined
    if (!value || value.permission !== pending.permission || !['not-determined', 'granted', 'denied', 'restricted', 'unknown'].includes(value.status ?? '')
      || typeof value.canRequest !== 'boolean' || typeof value.canOpenSettings !== 'boolean') {
      pending.reject(new Error('Invalid Desktop permission response')); return
    }
    pending.resolve(value as DesktopPermissionSnapshot)
  }

  private async call(action: DesktopPermissionAction, value: unknown): Promise<DesktopPermissionSnapshot> {
    const permission = desktopPermission(value)
    if (this.disposed || !this.connection.connected || !this.connection.send) throw new Error('Desktop permissions are unavailable')
    const requestId = this.nextId++
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await new Promise<DesktopPermissionSnapshot>((resolve, reject) => {
        this.pending.set(requestId, { permission, resolve, reject })
        timer = setTimeout(() => reject(new Error('Desktop permission request timed out')), 5000)
        this.connection.send!({ type: 'permission', requestId, action, permission }, error => { if (error) reject(error) })
      })
    } finally { clearTimeout(timer); this.pending.delete(requestId) }
  }

  dispose = (): void => {
    this.disposed = true
    this.connection.off('message', this.receive)
    this.connection.off('disconnect', this.dispose)
    for (const pending of this.pending.values()) pending.reject(new Error('Desktop permissions disconnected'))
    this.pending.clear()
  }
}
