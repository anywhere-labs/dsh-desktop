/** Allowlisted Chrome DevTools Protocol surface for one guest browser view. */

/** Protocol version requested from `webContents.debugger.attach`. */
export const BROWSER_VIEW_CDP_PROTOCOL_VERSION = '1.3'

/** Domains forwarded without per-method filtering. */
const ALLOWED_CDP_DOMAINS = new Set(['Accessibility', 'DOM', 'Input', 'Page', 'Runtime'])

/** Individual methods allowed inside an otherwise filtered domain. */
const ALLOWED_CDP_METHODS = new Set([
  'Network.enable',
  'Network.getCookies',
  'Network.setCookie',
  'Network.clearBrowserCookies',
])

/** Domains that reach the browser process, another target, or another origin store. */
const DENIED_CDP_DOMAINS = new Set(['Browser', 'Emulation', 'Fetch', 'Storage', 'Target'])

/** Methods rejected inside an allowed domain because they leave the guest page. */
const DENIED_CDP_METHODS = new Set([
  'DOM.setFileInputFiles',
  'Page.setDownloadBehavior',
  'Page.setInterceptFileChooserDialog',
])

function cdpDomain(method: string): string | undefined {
  const separator = method.indexOf('.')
  if (separator <= 0 || separator === method.length - 1) return undefined
  return method.slice(0, separator)
}

/**
 * Decide whether one CDP method may reach a guest view.
 * @param method - protocol method name such as `Page.navigate`.
 * @returns whether the method is inside the allowlist.
 */
export function isAllowedBrowserViewCdpMethod(method: string): boolean {
  if (DENIED_CDP_METHODS.has(method)) return false
  const domain = cdpDomain(method)
  if (domain === undefined || DENIED_CDP_DOMAINS.has(domain)) return false
  if (ALLOWED_CDP_DOMAINS.has(domain)) return true
  return domain === 'Network' && ALLOWED_CDP_METHODS.has(method)
}

/**
 * Reject commands whose parameters can leave the guest page.
 * @param method - protocol method name.
 * @param params - command parameters supplied by the Host.
 * @returns whether the parameters are acceptable for the method.
 */
export function isAllowedBrowserViewCdpParams(method: string, params: unknown): boolean {
  if (method !== 'Page.navigate') return true
  const url = typeof params === 'object' && params !== null
    ? (params as { url?: unknown }).url
    : undefined
  if (typeof url !== 'string') return false
  try {
    const protocol = new URL(url).protocol
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}
