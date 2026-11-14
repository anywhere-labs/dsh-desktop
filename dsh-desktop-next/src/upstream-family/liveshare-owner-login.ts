/**
 * The LiveShare owner sign-in popup of dsh 0.2.2 (`@deepseek-ai/dsh-experimental-liveshare`) in the Desktop window.
 *
 * The owner page reserves a blank window named `liveshare-owner-login`, points it at the Relay's
 * `/__liveshare/owner-authorize` page, and waits for the single-use code that page posts back to
 * `window.opener`. The Desktop window refuses every other `window.open`, so this one opens as a plain sandboxed
 * window without the Desktop preload, and it may only show web pages.
 *
 * The app protocol presents the page's requests to the Host with the Host's own origin, so the Host binds the
 * attempt to that origin and the authorize address asks the Relay to post the code there, where no window
 * listens. The popup therefore asks the Relay to post to the Desktop document's origin instead. The Host still
 * checks state, origin and PKCE when the page redeems the code. src/main.ts consumes this module as
 * `liveshareOwnerLogin` from src/upstream-family.ts.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, HandlerDetails, WebContents } from 'electron'

/** Name the owner page gives its sign-in popup. */
export const OWNER_LOGIN_FRAME = 'liveshare-owner-login'
/** Origin of the Desktop document, which receives the Relay's code. */
const APP_ORIGIN = 'dsh-app://app'
const AUTHORIZE_PATH = '/__liveshare/owner-authorize'

/** Where one navigation inside the sign-in popup may go. */
export type OwnerLoginNavigation =
  | { readonly kind: 'allow' }
  | { readonly kind: 'cancel' }
  /** The Relay's authorize page, addressed to post its code to the Desktop document. */
  | { readonly kind: 'redirect', readonly url: string }

/** What the popup needs from the Desktop window that opened it. */
export interface OwnerLoginGuardOptions {
  /** Current Host origin, or `undefined` while the Host is down. */
  hostOrigin(): string | undefined
  /** Hand a link the Relay page opens in a new window to the system browser. */
  openExternal(url: string): void
}

/**
 * Whether one `window.open` from the Desktop window is the owner sign-in popup. The page reserves the window
 * before it knows the Relay address, so the request names no address.
 * @param details - Electron's description of the request.
 * @returns true only for the blank window under the sign-in name.
 */
export function isOwnerLoginPopup(details: Pick<HandlerDetails, 'url' | 'frameName'>): boolean {
  return details.frameName === OWNER_LOGIN_FRAME && (details.url === 'about:blank' || details.url === '')
}

/**
 * Decide one navigation inside the sign-in popup.
 * @param value - navigation URL.
 * @param hostOrigin - current Host origin, or `undefined` while the Host is down.
 * @param mainFrame - whether the popup's page itself navigates, rather than a frame inside it.
 * @returns `redirect` for the Relay's authorize page addressed to the Host origin, `allow` for other web pages,
 *   else `cancel`.
 */
export function ownerLoginNavigation(value: string, hostOrigin: string | undefined, mainFrame = true): OwnerLoginNavigation {
  if (!URL.canParse(value)) return { kind: 'cancel' }
  const url = new URL(value)
  // Sign-in pages may build frames from local documents; the page itself stays on the web.
  if (['about:', 'data:', 'blob:'].includes(url.protocol)) return { kind: mainFrame ? 'cancel' : 'allow' }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username !== '' || url.password !== '') return { kind: 'cancel' }
  // The Host admits only the Desktop window; the popup has nothing to read there.
  if (hostOrigin !== undefined && url.origin === hostOrigin) return { kind: 'cancel' }
  if (mainFrame && hostOrigin !== undefined && url.pathname.endsWith(AUTHORIZE_PATH) && url.searchParams.get('origin') === hostOrigin) {
    url.searchParams.set('origin', APP_ORIGIN)
    return { kind: 'redirect', url: url.href }
  }
  return { kind: 'allow' }
}

/**
 * Window options for the sign-in popup. Electron passes no preload to a window it opens for a page; these keep it
 * sandboxed and without `<webview>`.
 * @param parent - Desktop window that opened it.
 * @returns the options that override the ones the page asked for.
 */
export function ownerLoginWindowOptions(parent: BrowserWindow): BrowserWindowConstructorOptions {
  return {
    width: 520, height: 720, minWidth: 400, minHeight: 560, autoHideMenuBar: true,
    ...(parent.isDestroyed() ? {} : { parent }),
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: false, spellcheck: false },
  }
}

/**
 * Keep the sign-in popup on web pages and address the Relay's code to the Desktop document.
 * @param contents - the popup's page.
 * @param options - Host origin and external links.
 */
export function guardOwnerLoginWindow(contents: WebContents, options: OwnerLoginGuardOptions): void {
  contents.setWindowOpenHandler(({ url }) => { options.openExternal(url); return { action: 'deny' } })
  contents.on('will-attach-webview', (event) => { event.preventDefault() })
  const navigate = (event: Electron.Event<{ readonly url: string, readonly isMainFrame: boolean }>): void => {
    const decision = ownerLoginNavigation(event.url, options.hostOrigin(), event.isMainFrame)
    if (decision.kind === 'allow') return
    event.preventDefault()
    // A navigation the main process starts keeps the window and its opener.
    if (decision.kind === 'redirect') contents.loadURL(decision.url).catch(() => { /* The popup closed first. */ })
  }
  contents.on('will-frame-navigate', navigate)
  contents.on('will-redirect', navigate)
}

/** The popup policy as src/main.ts reads it from src/upstream-family.ts. */
export const liveshareOwnerLogin = {
  accepts: isOwnerLoginPopup,
  windowOptions: ownerLoginWindowOptions,
  guard: guardOwnerLoginWindow,
}
