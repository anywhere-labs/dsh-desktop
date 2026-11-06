/**
 * Tokens Anywhere as DSH's OAuth 2.1 authorization server (anywhere-tokenhub docs/oauth-provider-design.md,
 * dsh-desktop#1583): the authorize URL, the token and revocation endpoints, and the console API an access token
 * reaches. Every request carries a code, a token or a key, so none follows a redirect and none is ever logged.
 */
import type { AnywhereErrorCode, AnywhereProblem, TokensUsageRow } from '../account.ts'

/** The public client Tokens Anywhere registers for DSH, with loopback redirect URIs. */
export const TOKENS_CLIENT_ID = 'dsh'
/** The managed key's app: Tokens Anywhere keeps one key of it per grant. */
export const TOKENS_APP = 'dsh-next'
const REQUEST_TIMEOUT_MS = 20_000

/** A failure the page shows; `detail` is Tokens Anywhere's own wording, if any. */
export class AnywhereError extends Error {
  constructor(readonly code: AnywhereErrorCode, readonly detail?: string) {
    super(detail === undefined ? code : `${code}: ${detail}`)
  }

  get problem(): AnywhereProblem {
    return this.detail === undefined ? { code: this.code } : { code: this.code, detail: this.detail }
  }
}

/** Any failure as the page shows it; unexpected ones are `failed`. */
export function anywhereProblem(error: unknown): AnywhereProblem {
  return error instanceof AnywhereError ? error.problem : { code: 'failed' }
}

/** The grant is gone (revoked, replayed or expired): only signing in again helps. */
export class TokensGrantError extends AnywhereError {
  constructor(detail?: string) { super('session-ended', detail) }
}

/** An access token Tokens Anywhere no longer accepts. */
export class TokensUnauthorizedError extends AnywhereError {
  constructor() { super('session-ended') }
}

/** Tokens from the token endpoint; `expiresAt` is a local clock time in milliseconds. */
export interface TokenSet {
  readonly accessToken: string
  readonly refreshToken: string
  readonly expiresAt: number
}

/**
 * The authorize page an attempt opens.
 * @param origin - Tokens Anywhere.
 */
export function tokensAuthorizeUrl(origin: string, attempt: { redirectUri: string; state: string; challenge: string }): string {
  const query = new URLSearchParams({
    response_type: 'code', client_id: TOKENS_CLIENT_ID, redirect_uri: attempt.redirectUri,
    code_challenge: attempt.challenge, code_challenge_method: 'S256', state: attempt.state, scope: 'user',
  })
  return `${origin}/oauth/authorize/?${query.toString()}`
}

async function send(url: string, init: RequestInit, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
  let response: Response
  try {
    response = await fetch(url, { ...init, redirect: 'error', signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AnywhereError('network')
  }
  const text = await response.text()
  let body: unknown
  try {
    body = text === '' ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }
  return { status: response.status, body }
}

function tokenSet(body: unknown, now: number): TokenSet {
  const value = body as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; token_type?: unknown } | undefined
  if (typeof value?.access_token !== 'string' || !value.access_token.startsWith('ta_at_')
    || typeof value.refresh_token !== 'string' || !value.refresh_token.startsWith('ta_rt_')
    || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer') {
    throw new AnywhereError('server', 'malformed token response')
  }
  const seconds = typeof value.expires_in === 'number' && value.expires_in > 0 ? value.expires_in : 3600
  return { accessToken: value.access_token, refreshToken: value.refresh_token, expiresAt: now + seconds * 1000 }
}

async function tokenRequest(origin: string, form: Record<string, string>, signal: AbortSignal): Promise<TokenSet> {
  const now = Date.now()
  const { status, body } = await send(`${origin}/api/v1/oauth/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ client_id: TOKENS_CLIENT_ID, ...form }).toString(),
  }, signal)
  if (status === 200) return tokenSet(body, now)
  const error = body as { error?: unknown; error_description?: unknown } | undefined
  const description = typeof error?.error_description === 'string' ? error.error_description : undefined
  if (status === 400 && error?.error === 'invalid_grant') throw new TokensGrantError(description)
  if (status >= 400 && status < 500) throw new AnywhereError('rejected', description ?? `HTTP ${status}`)
  throw new AnywhereError('server', `HTTP ${status}`)
}

/** Redeem an authorization code with its PKCE verifier. */
export function exchangeTokensCode(origin: string, code: string, verifier: string, redirectUri: string, signal: AbortSignal): Promise<TokenSet> {
  return tokenRequest(origin, { grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri }, signal)
}

/** Rotate the refresh token. Callers serialize: a refresh token used twice revokes the grant. */
export function refreshTokens(origin: string, refreshToken: string, signal: AbortSignal): Promise<TokenSet> {
  return tokenRequest(origin, { grant_type: 'refresh_token', refresh_token: refreshToken }, signal)
}

/** End the grant (RFC 7009); Tokens Anywhere deletes the grant's key with it. Best effort. */
export async function revokeTokens(origin: string, token: string, signal: AbortSignal): Promise<boolean> {
  try {
    const { status } = await send(`${origin}/api/v1/oauth/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: TOKENS_CLIENT_ID, token }).toString(),
    }, signal)
    return status === 200
  } catch {
    return false
  }
}

/**
 * How many yuan a US dollar buys today, from the public `GET /api/v1/exchange-rates`; undefined while Tokens Anywhere
 * has no rate. Display only: every charge stays in dollars.
 * @param origin - Tokens Anywhere.
 */
export async function readYuanRate(origin: string, signal: AbortSignal): Promise<number | undefined> {
  const { status, body } = await send(`${origin}/api/v1/exchange-rates`, { headers: { accept: 'application/json' } }, signal)
  if (status !== 200) throw new AnywhereError(status >= 500 ? 'server' : 'rejected', `HTTP ${status}`)
  const rate = (body as { rates?: { CNY?: unknown } } | undefined)?.rates?.CNY
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0 ? rate : undefined
}

/** The signed-in user as `GET /api/v1/me` reports it. */
export interface TokensUser {
  readonly displayName: string
  readonly email: string
  readonly loginName: string
}

/** The grant's managed key with its secret. */
export interface TokensKey {
  readonly id: string
  readonly prefix: string
  readonly secret: string
}

/** A managed key and its secret, as `keys/managed` and `keys/{id}/rotate` answer. */
function managedKeyOf(body: unknown): TokensKey {
  const value = body as { key?: { id?: unknown; prefix?: unknown }; secret?: unknown } | undefined
  if (typeof value?.secret !== 'string' || value.secret === '' || typeof value.key?.id !== 'string') throw new AnywhereError('server', 'no API key')
  return { id: value.key.id, prefix: typeof value.key.prefix === 'string' ? value.key.prefix : '', secret: value.secret }
}

/** The console API with the account's access token. */
export class TokensApi {
  /**
   * @param origin - Tokens Anywhere.
   * @param bearer - a valid access token; `renew` true asks for a new one after Tokens Anywhere refused the last.
   */
  constructor(private readonly origin: string, private readonly bearer: (renew: boolean) => Promise<string>) {}

  private async call(path: string, init: RequestInit, signal: AbortSignal): Promise<{ status: number; body: unknown }> {
    let renew = false
    for (;;) {
      const token = await this.bearer(renew)
      const result = await send(`${this.origin}${path}`, {
        ...init, headers: { accept: 'application/json', ...init.headers, authorization: `Bearer ${token}` },
      }, signal)
      // An access token can end before its time (a revoked grant); one new token settles which it was.
      if (result.status === 401 && !renew) { renew = true; continue }
      if (result.status === 401) throw new TokensUnauthorizedError()
      if (result.status >= 400) {
        const detail = (result.body as { error?: { message?: unknown } } | undefined)?.error?.message
        throw new AnywhereError(result.status >= 500 ? 'server' : 'rejected', typeof detail === 'string' ? detail : `HTTP ${result.status}`)
      }
      return result
    }
  }

  async me(signal: AbortSignal): Promise<TokensUser> {
    const { body } = await this.call('/api/v1/me', {}, signal)
    const user = body as { displayName?: unknown; email?: unknown; loginName?: unknown } | undefined
    return {
      displayName: typeof user?.displayName === 'string' ? user.displayName : '',
      email: typeof user?.email === 'string' ? user.email : '',
      loginName: typeof user?.loginName === 'string' ? user.loginName : '',
    }
  }

  async balance(signal: AbortSignal): Promise<{ available: string; held: string }> {
    const { body } = await this.call('/api/v1/balance', {}, signal)
    const value = body as { available?: unknown; held?: unknown } | undefined
    return { available: String(value?.available ?? '0.000000'), held: String(value?.held ?? '0.000000') }
  }

  /** Whether the account shows money in its language's currency beside dollars; on unless the user turned it off. */
  async preferences(signal: AbortSignal): Promise<{ localCurrency: boolean }> {
    const { body } = await this.call('/api/v1/me/preferences', {}, signal)
    return { localCurrency: (body as { localCurrency?: unknown } | undefined)?.localCurrency !== false }
  }

  /** The grant's own key, made on first call and returned as it is now afterwards (rotated keys included). */
  async managedKey(signal: AbortSignal): Promise<TokensKey> {
    const { body } = await this.call('/api/v1/keys/managed', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ app: TOKENS_APP }),
    }, signal)
    return managedKeyOf(body)
  }

  /** Give the grant's key a new secret; the old one stops working at once. */
  async rotateKey(id: string, signal: AbortSignal): Promise<TokensKey> {
    const { body } = await this.call(`/api/v1/keys/${encodeURIComponent(id)}/rotate`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }, signal)
    return managedKeyOf(body)
  }

  /** Usage per Beijing day and model, from one date to another, both included. */
  async dailyUsage(from: string, to: string, signal: AbortSignal): Promise<TokensUsageRow[]> {
    const query = new URLSearchParams({ from, to, groupBy: 'model' })
    const { body } = await this.call(`/api/v1/usage/daily?${query.toString()}`, {}, signal)
    const items = (body as { items?: unknown } | undefined)?.items
    if (!Array.isArray(items)) return []
    const count = (value: unknown) => typeof value === 'number' && Number.isFinite(value) ? value : 0
    return items.flatMap((item: Record<string, unknown> | null): TokensUsageRow[] => {
      if (item === null || typeof item !== 'object' || typeof item.date !== 'string') return []
      return [{
        date: item.date, model: typeof item.model === 'string' ? item.model : null,
        requests: count(item.requests), inputTokens: count(item.inputTokens), outputTokens: count(item.outputTokens),
        cacheReadTokens: count(item.cacheReadTokens), cacheWrite5mTokens: count(item.cacheWrite5mTokens),
        cacheWrite1hTokens: count(item.cacheWrite1hTokens), amountCharged: String(item.amountCharged ?? '0'),
      }]
    })
  }
}
