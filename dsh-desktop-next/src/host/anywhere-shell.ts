/**
 * The Electron shell's half of the Anywhere account, over the Host's IPC channel (see ../host-process.ts): the
 * built-in sign-in window, and sealing the refresh token with the OS credential store, which only the main process
 * can reach. Without a shell (tests, a Host started by hand) the window is never shown and nothing is sealed.
 */
type Connection = Pick<NodeJS.Process, 'on' | 'off' | 'send' | 'connected'>

/** The first use of the OS credential store may ask the user, who needs time to answer. */
const SECRET_TIMEOUT_MS = 2 * 60_000

export class AnywhereShell {
  private nextId = 1
  private disposed = false
  private readonly pending = new Map<number, { resolve(value: string | undefined): void }>()

  /**
   * @param closed - the user closed the sign-in window before the attempt ended.
   * @param requested - Tokens Anywhere's link opened DSH.
   */
  constructor(private readonly connection: Connection | undefined, private readonly closed: () => void, private readonly requested: () => void) {
    connection?.on('message', this.receive)
  }

  private post(message: object): void {
    if (this.disposed || this.connection?.connected !== true || this.connection.send === undefined) return
    this.connection.send(message, () => {})
  }

  /** Show an attempt's authorize page; its navigation to `callback` is handed back to the Host's listener. */
  openLogin(url: string, callback: string): void {
    this.post({ type: 'anywhere-login', action: 'open', url, callback })
  }

  /** Close the sign-in window; `focus` brings the application forward. */
  closeLogin(focus: boolean): void {
    this.post({ type: 'anywhere-login', action: 'close', focus })
  }

  /** Seal a secret, or undefined where the OS credential store is unavailable. */
  seal(value: string): Promise<string | undefined> {
    return this.secret('seal', value)
  }

  /** Open a sealed secret, or undefined where the store cannot (another device, a reset keychain). */
  open(sealed: string): Promise<string | undefined> {
    return this.secret('open', sealed)
  }

  private secret(action: 'seal' | 'open', value: string): Promise<string | undefined> {
    if (this.disposed || this.connection?.connected !== true || this.connection.send === undefined) return Promise.resolve(undefined)
    const requestId = this.nextId++
    return new Promise((resolve) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); resolve(undefined) }, SECRET_TIMEOUT_MS)
      this.pending.set(requestId, { resolve: (result) => { clearTimeout(timer); this.pending.delete(requestId); resolve(result) } })
      this.connection!.send!({ type: 'anywhere-secret', requestId, action, value }, (error) => {
        if (error) this.pending.get(requestId)?.resolve(undefined)
      })
    })
  }

  private receive = (message: unknown): void => {
    if (typeof message !== 'object' || message === null || !('type' in message)) return
    if (message.type === 'anywhere-login-closed') { this.closed(); return }
    if (message.type === 'anywhere-login-requested') { this.requested(); return }
    if (message.type !== 'anywhere-secret-result') return
    const result = message as { requestId?: unknown; value?: unknown }
    if (typeof result.requestId !== 'number') return
    this.pending.get(result.requestId)?.resolve(typeof result.value === 'string' ? result.value : undefined)
  }

  dispose(): void {
    this.disposed = true
    this.connection?.off('message', this.receive)
    for (const pending of [...this.pending.values()]) pending.resolve(undefined)
  }
}
