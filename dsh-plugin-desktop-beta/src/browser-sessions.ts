/**
 * Keep the Host sessions of one ordinary browser from outgrowing its request headers.
 *
 * The Host names its browser cookie after the authority it answered on, port included, but a
 * browser stores cookies per hostname and sends them to every port. Each Host generation on a new
 * port therefore adds a cookie no later one overwrites. At about 70 of them, every request from
 * that browser exceeds Node's default header limit and fails before any route runs (#1562).
 */

/** Cookie prefix of `@deepseek-ai/dsh-client-connection`, whose value is `v<n>.<base64url JSON>.<signature>`. */
const SESSION_COOKIE_PREFIX = 'dsh-auth-'

/**
 * Sessions one browser keeps per hostname: room for Hosts running side by side, while their 230
 * bytes each leave other servers on that hostname, which receive them too, most of their limit.
 */
const RETAINED_SESSIONS = 16

/**
 * Header limit of the Host and the LAN edge. Expiring sessions takes a request the listener can
 * parse, so a browser already past Node's 16 KiB default must still get through; browsers hold about
 * 180 cookies per host, some 41 KiB of these.
 */
export const MAX_HEADER_BYTES = 64 * 1024

interface BrowserSession {
  readonly name: string
  readonly authority: string
  readonly issuedAt: number
}

/** Read a session's public fields; its signature only concerns the Host it authenticates. */
function readSession(cookie: string): BrowserSession | undefined {
  const separator = cookie.indexOf('=')
  const payload = cookie.slice(separator + 1).split('.')[1]
  if (separator < 0 || payload === undefined) return undefined
  try {
    const { authority, issuedAt } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as Record<string, unknown>
    if (typeof authority !== 'string' || typeof issuedAt !== 'number') return undefined
    return { name: cookie.slice(0, separator), authority, issuedAt }
  } catch {
    return undefined
  }
}

/**
 * List the deletions of a browser's oldest sessions past the retained count. The session of the
 * answering Host always stays, and a cookie in an unknown format is left alone.
 * @param cookieHeader - the request's Cookie header.
 * @param host - the request's Host header.
 * @returns `Set-Cookie` values, empty for almost every request.
 */
export function surplusSessionExpiries(cookieHeader: string | null | undefined, host: string | null | undefined): string[] {
  const cookies = (cookieHeader ?? '').split(';').map(cookie => cookie.trim()).filter(cookie => cookie.startsWith(SESSION_COOKIE_PREFIX))
  if (cookies.length <= RETAINED_SESSIONS) return []
  return cookies.flatMap(cookie => readSession(cookie) ?? [])
    .sort((left, right) => right.issuedAt - left.issuedAt)
    .slice(RETAINED_SESSIONS)
    .filter(session => session.authority !== host && session.authority !== `https://${String(host)}`)
    .map(session => `${session.name}=; Max-Age=0; Path=/`)
}

/**
 * Add the deletions of {@link surplusSessionExpiries} to a Fetch response.
 * @param request - the request the response answers.
 * @param response - the response, which may already set a cookie of its own.
 * @returns the same response when nothing expires, otherwise a copy carrying the deletions.
 */
export function expireSurplusSessions(request: Request, response: Response): Response {
  const expiries = surplusSessionExpiries(request.headers.get('cookie'), request.headers.get('host'))
  if (expiries.length === 0) return response
  const headers = new Headers(response.headers)
  for (const expiry of expiries) headers.append('set-cookie', expiry)
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}
