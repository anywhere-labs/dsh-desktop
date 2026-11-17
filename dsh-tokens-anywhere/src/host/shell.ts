/**
 * The Desktop's half of the Anywhere account, where DSH Next serves it as `desktopTokensAnywhere` (dsh-desktop-next
 * src/host/tokens-anywhere-shell.ts): the built-in sign-in window, and sealing the refresh token with the OS credential
 * store, which only its main process can reach. Without it (an ordinary `dsh web`, tests) no window is shown, as the
 * page links the authorize page for the browser, and nothing is sealed, so the refresh token lasts as long as the Host.
 */
import type { AnywhereLocalFile } from '../account.ts'

/** What DSH Next's shell does for the sign-in. */
export interface TokensAnywhereDesktop {
  /** Show an attempt's authorize page; its navigation to `callback` is handed back to the Host's listener. */
  openLogin(url: string, callback: string): void
  /** Close the sign-in window; `focus` brings the application forward. */
  closeLogin(focus: boolean): void
  /** Seal a secret, or undefined where the OS credential store is unavailable. */
  seal(value: string): Promise<string | undefined>
  /** Open a sealed secret, or undefined where the store cannot (another device, a reset keychain). */
  open(sealed: string): Promise<string | undefined>
  /** The user closed the sign-in window before the attempt ended. */
  onLoginClosed(listener: () => void): () => void
  /** Tokens Anywhere's link opened DSH; one that came before anybody listened goes to the first listener. */
  onLinkOpened(listener: () => void): () => void
  /** Show one of the account's local files in the file manager. */
  revealFile?(file: AnywhereLocalFile): void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopTokensAnywhere: TokensAnywhereDesktop
  }
}

/** How long a stored sealed token waits at startup for the Desktop, which may load after this plugin. */
const DESKTOP_WAIT_MS = 5_000

export class AnywhereShell {
  private desktop: TokensAnywhereDesktop | undefined
  private readonly waiting = new Set<() => void>()
  private disposed = false

  /**
   * @param closed - the user closed the sign-in window before the attempt ended.
   * @param requested - Tokens Anywhere's link opened DSH.
   */
  constructor(private readonly closed: () => void, private readonly requested: () => void) {}

  /**
   * Use the Desktop's service while it lasts.
   * @returns its release, for the effect that holds it.
   */
  attach(desktop: TokensAnywhereDesktop): () => void {
    this.desktop = desktop
    const stop = [desktop.onLoginClosed(() => { this.closed() }), desktop.onLinkOpened(() => { this.requested() })]
    this.wake()
    return () => {
      for (const off of stop) off()
      if (this.desktop === desktop) this.desktop = undefined
    }
  }

  openLogin(url: string, callback: string): void {
    if (!this.disposed) this.desktop?.openLogin(url, callback)
  }

  closeLogin(focus: boolean): void {
    if (!this.disposed) this.desktop?.closeLogin(focus)
  }

  /** Whether the Desktop can show the account's local files. */
  get revealsFiles(): boolean {
    return !this.disposed && this.desktop?.revealFile !== undefined
  }

  revealFile(file: AnywhereLocalFile): void {
    if (!this.disposed) this.desktop?.revealFile?.(file)
  }

  /** Seal a secret, or undefined where nothing can. */
  async seal(value: string): Promise<string | undefined> {
    const desktop = this.disposed ? undefined : this.desktop
    return desktop === undefined ? undefined : await desktop.seal(value).catch(() => undefined)
  }

  /** Open a sealed secret, giving a Desktop that is still loading a moment to arrive. */
  async open(sealed: string): Promise<string | undefined> {
    const desktop = this.disposed ? undefined : this.desktop ?? await this.arrival()
    return desktop === undefined ? undefined : await desktop.open(sealed).catch(() => undefined)
  }

  private arrival(): Promise<TokensAnywhereDesktop | undefined> {
    return new Promise((resolve) => {
      const done = (): void => {
        clearTimeout(timer)
        this.waiting.delete(done)
        resolve(this.disposed ? undefined : this.desktop)
      }
      const timer = setTimeout(done, DESKTOP_WAIT_MS)
      timer.unref()
      this.waiting.add(done)
    })
  }

  private wake(): void {
    for (const done of [...this.waiting]) done()
  }

  dispose(): void {
    this.disposed = true
    this.wake()
  }
}
