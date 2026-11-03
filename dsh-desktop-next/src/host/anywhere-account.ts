/**
 * Host half of the Anywhere account (see ../anywhere-account.ts and dsh-desktop#1583). A sign-in opens Tokens
 * Anywhere's authorize page, with PKCE, in the shell's built-in window; the code comes back to a one-shot listener on
 * 127.0.0.1 (the Host web server admits only the native renderer, and the official DeepSeek sign-in owns its
 * `/oauth/callback`). The Host redeems it, asks for the grant's own `dsh-next` key, writes the gateway as `llm-pi-ai`
 * provider routes, and keeps the refresh token sealed by the OS credential store for the balance, usage and key
 * updates. The page reads and drives it through ANYWHERE_ACCOUNT_ROUTES.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-client-connection'
import { credentialKey, credentialRef, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsForms } from '@deepseek-ai/dsh-settings'
import {
  ANYWHERE_ACCOUNT_ROUTES, ANYWHERE_API_KEY_REF, TOKENS_ANYWHERE_URL_VARIABLE, beijingDates, pickAnywhereDefaultModel,
  tokensAnywhereOrigin,
  type AnywhereAccountSnapshot, type AnywhereProblem, type AnywhereSignInPhase, type AnywhereUsageRows,
} from '../anywhere-account.ts'
import { AnywhereModels, isAnywhereRoute, type DefaultModels, type ModelSelection } from './anywhere-models.ts'
import { AnywhereShell } from './anywhere-shell.ts'
import {
  AnywhereError, TokensApi, TokensGrantError, anywhereProblem, exchangeTokensCode, refreshTokens, revokeTokens,
  tokensAuthorizeUrl,
} from './tokens-client.ts'

const NO_STORE = { 'cache-control': 'no-store' }
const ACCOUNT_RECORD = credentialKey('anywhere-account', 'default')
/** The browser part of a sign-in, including signing up and signing in to Agents Anywhere on the way. */
const ATTEMPT_TIMEOUT_MS = 10 * 60_000
const BALANCE_MAX_AGE_MS = 30_000
/** Access tokens are renewed this long before Tokens Anywhere would refuse them. */
const ACCESS_MARGIN_MS = 60_000
/** How often a signed-in Host checks its key and the models again. */
const SYNC_INTERVAL_MS = 6 * 3_600_000

interface AccountRecord {
  readonly version: 3
  /** The Tokens Anywhere the account signed in to; its tokens and key work only there. */
  readonly origin: string
  readonly user: { readonly displayName: string; readonly email: string }
  /** The grant's key; its secret is the API key credential. */
  readonly key: { readonly id: string; readonly prefix: string }
  /** The refresh token as the OS credential store sealed it; absent where the store is unavailable. */
  readonly sealedRefreshToken?: string
  readonly connectedAt: string
  /** The default model before signing in selected ours, restored on sign-out. */
  readonly previousDefault?: ModelSelection
}

function isAccountRecord(value: unknown): value is AccountRecord {
  const record = value as Partial<AccountRecord> | undefined
  return record?.version === 3 && typeof record.origin === 'string' && typeof record.key?.id === 'string'
}

interface Attempt {
  readonly id: string
  readonly origin: string
  phase: AnywhereSignInPhase
  authorizeUrl?: string
  error?: AnywhereProblem
  readonly controller: AbortController
  callback?: LoopbackCallback
  timer?: NodeJS.Timeout
}

function base64url(bytes: Buffer): string {
  return bytes.toString('base64url')
}

/** What came back to the redirect URI. */
export type CallbackResult = { readonly code: string; readonly iss: string | null } | { readonly error: string; readonly iss: string | null }

/**
 * One sign-in's redirect target on 127.0.0.1 (RFC 8252 §7.3): the OS picks the port, the Host header must name it (no
 * DNS rebinding), the state must match, and only the first matching callback counts. Its answer waits until the
 * code is redeemed, then sends the browser to Tokens Anywhere's done page, so no page here ever shows anything.
 */
export class LoopbackCallback {
  readonly state = base64url(randomBytes(32))
  readonly verifier = base64url(randomBytes(48))
  readonly challenge = base64url(createHash('sha256').update(this.verifier).digest())
  private server: Server | undefined
  private port = 0
  private used = false

  /**
   * @param done - where the browser goes afterwards.
   * @param received - settles the attempt with what came back; the browser's answer waits for it.
   */
  constructor(private readonly done: string, private readonly received: (result: CallbackResult) => Promise<void>) {}

  get redirectUri(): string {
    return `http://127.0.0.1:${this.port}/oauth/callback`
  }

  async listen(): Promise<void> {
    const server = createServer((req, res) => { this.handle(req, res) })
    this.server = server
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve() })
    })
    const address = server.address()
    if (address === null || typeof address === 'string') throw new Error('loopback listener has no port')
    this.port = address.port
  }

  /** Stop listening; a callback being answered still gets its answer. */
  close(): void {
    const server = this.server
    if (server === undefined) return
    this.server = undefined
    server.close()
    if (this.used) server.closeIdleConnections()
    else server.closeAllConnections()
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    res.setHeader('cache-control', 'no-store')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('x-content-type-options', 'nosniff')
    if (req.headers.host !== `127.0.0.1:${this.port}`) return this.end(res, 403, 'Forbidden')
    if (req.method !== 'GET') return this.end(res, 405, 'Method not allowed')
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`)
    if (url.pathname !== '/oauth/callback') return this.end(res, 404, 'Not found')
    const expected = Buffer.from(this.state)
    const received = Buffer.from(url.searchParams.get('state') ?? '')
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return this.end(res, 400, 'This sign-in link is not for this attempt.')
    if (this.used) { this.leave(res); return }
    this.used = true
    const code = url.searchParams.get('code')
    const iss = url.searchParams.get('iss')
    const result: CallbackResult = code !== null && code !== '' ? { code, iss } : { error: url.searchParams.get('error') ?? 'invalid_request', iss }
    void this.received(result).catch(() => {}).finally(() => { this.leave(res) })
  }

  private leave(res: ServerResponse): void {
    if (!res.writableEnded) {
      res.writeHead(302, { location: this.done })
      res.end()
    }
    this.close()
  }

  private end(res: ServerResponse, status: number, message: string): void {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(message)
  }
}

/** Sign-in, tokens, key, models and account state; every change runs in order through one queue. */
export class AnywhereAccount {
  private attempt: Attempt | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private access: { readonly token: string; readonly expiresAt: number } | undefined
  private refreshToken: string | undefined
  /** The stored refresh token being opened: until then, having none says nothing about the session. */
  private opening: Promise<AccountRecord | undefined> | undefined
  private renewing: Promise<string> | undefined
  private sessionEnded = false
  private memoryOnly = false
  private balance: AnywhereAccountSnapshot['balance']
  private balanceError: AnywhereProblem | undefined
  private balancePending: Promise<void> | undefined
  private notice: AnywhereProblem | undefined
  private syncing: Promise<void> | undefined
  private syncTimer: NodeJS.Timeout | undefined
  private readonly lifetime = new AbortController()
  readonly models: AnywhereModels

  constructor(
    private readonly credentials: CredentialProvider,
    settings: SettingsForms,
    private readonly defaults: DefaultModels,
    private readonly shell: AnywhereShell,
    /** The Tokens Anywhere to sign in to. */
    private readonly origin: string,
  ) {
    this.models = new AnywhereModels(credentials, settings, defaults)
  }

  /** Pick up a stored account: open its refresh token, then check its key, models and balance in the background. */
  async start(): Promise<void> {
    this.opening = this.openStored()
    const account = await this.opening
    if (account === undefined) return
    this.schedule()
    void this.sync()
    if (!this.sessionEnded) void this.refreshBalance(account)
  }

  private async openStored(): Promise<AccountRecord | undefined> {
    const account = await this.account()
    if (account === undefined) return undefined
    const sealed = account.sealedRefreshToken
    const token = sealed === undefined ? undefined : await this.shell.open(sealed)
    if (token === undefined) this.sessionEnded = true
    else this.refreshToken = token
    return account
  }

  dispose(): void {
    this.lifetime.abort()
    clearInterval(this.syncTimer)
    this.endAttempt('cancelled')
    this.shell.dispose()
  }

  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task)
    this.queue = run.catch(() => {})
    return run
  }

  private schedule(): void {
    clearInterval(this.syncTimer)
    this.syncTimer = setInterval(() => { void this.sync() }, SYNC_INTERVAL_MS)
    this.syncTimer.unref()
  }

  private async account(): Promise<AccountRecord | undefined> {
    const record = await this.credentials.readRecord(ACCOUNT_RECORD)
    return record?.kind === 'grant' && isAccountRecord(record.payload) ? record.payload : undefined
  }

  /** Change the stored account, unless it was signed out meanwhile. */
  private async updateAccount(change: (account: AccountRecord) => AccountRecord): Promise<void> {
    await this.credentials.modifyRecord(ACCOUNT_RECORD, async (current) => {
      if (current?.kind !== 'grant' || !isAccountRecord(current.payload)) return undefined
      return { kind: 'grant', payload: change(current.payload) }
    })
  }

  private api(origin: string): TokensApi {
    return new TokensApi(origin, renew => this.bearer(renew))
  }

  async snapshot(): Promise<AnywhereAccountSnapshot> {
    const account = await this.account()
    if (account !== undefined && !this.sessionEnded
      && (this.balance === undefined || Date.now() - Date.parse(this.balance.checkedAt) > BALANCE_MAX_AGE_MS)) {
      void this.refreshBalance(account)
    }
    const selection = this.defaults.currentSelection()
    const attempt = this.attempt
    const catalog = account === undefined ? undefined : await this.models.view()
    return {
      origin: account?.origin ?? this.origin,
      ...(attempt === undefined ? {} : { attempt: {
        id: attempt.id, phase: attempt.phase,
        ...(attempt.authorizeUrl === undefined ? {} : { authorizeUrl: attempt.authorizeUrl }),
        ...(attempt.error === undefined ? {} : { error: attempt.error }),
      } }),
      ...(account === undefined ? {} : { account: {
        displayName: account.user.displayName, email: account.user.email, keyPrefix: account.key.prefix,
        connectedAt: account.connectedAt,
        ...(this.sessionEnded ? { sessionEnded: true } : {}),
        ...(this.memoryOnly ? { memoryOnly: true } : {}),
      } }),
      ...(account === undefined || this.balance === undefined ? {} : { balance: this.balance }),
      ...(account === undefined || this.balanceError === undefined ? {} : { balanceError: this.balanceError }),
      ...(catalog === undefined ? {} : {
        ...(catalog.models === undefined ? {} : { models: catalog.models }),
        ...(catalog.error === undefined ? {} : { modelsError: catalog.error }),
        offered: catalog.offered, custom: catalog.custom, customEdited: catalog.customEdited,
      }),
      defaultModel: { provider: selection.provider, model: selection.model,
        ...(selection.reasoningEffort === undefined ? {} : { reasoningEffort: selection.reasoningEffort }) },
      ...(account === undefined && this.notice !== undefined ? { notice: this.notice } : {}),
    }
  }

  /** Start a sign-in, or return the one waiting for the browser. */
  begin(): Promise<{ id: string; authorizeUrl: string }> {
    return this.serial(() => this.startAttempt())
  }

  private async startAttempt(): Promise<{ id: string; authorizeUrl: string }> {
    const current = this.attempt
    if (current?.phase === 'waiting-browser' && current.authorizeUrl !== undefined && current.callback !== undefined) {
      // Asking again shows the window again, as the official sign-in does.
      this.shell.openLogin(current.authorizeUrl, current.callback.redirectUri)
      return { id: current.id, authorizeUrl: current.authorizeUrl }
    }
    if (current !== undefined && (current.phase === 'exchanging' || current.phase === 'configuring')) throw new AnywhereError('busy')
    this.endAttempt('cancelled')
    const origin = this.origin
    const attempt: Attempt = { id: randomUUID(), origin, phase: 'waiting-browser', controller: new AbortController() }
    const callback: LoopbackCallback = new LoopbackCallback(`${origin}/oauth/done/`,
      (result): Promise<void> => this.serial(() => this.complete(attempt, callback, result)))
    await callback.listen()
    attempt.callback = callback
    attempt.authorizeUrl = tokensAuthorizeUrl(origin, { redirectUri: callback.redirectUri, state: callback.state, challenge: callback.challenge })
    attempt.timer = setTimeout(() => {
      if (attempt.phase === 'waiting-browser') this.finish(attempt, 'expired', { code: 'expired' })
    }, ATTEMPT_TIMEOUT_MS)
    attempt.timer.unref()
    this.attempt = attempt
    this.notice = undefined
    this.shell.openLogin(attempt.authorizeUrl, callback.redirectUri)
    return { id: attempt.id, authorizeUrl: attempt.authorizeUrl }
  }

  /** Tokens Anywhere's link opened DSH: sign in from scratch, unless there is a working account already. */
  linkOpened(): void {
    void this.serial(async () => {
      if ((await this.account()) !== undefined && !this.sessionEnded) return
      await this.startAttempt()
    }).catch((error: unknown) => { if (!(error instanceof AnywhereError)) console.error('[dsh-desktop-next] Anywhere sign-in link failed', error) })
  }

  cancel(id: string): void {
    const attempt = this.attempt
    if (attempt?.id !== id || attempt.phase !== 'waiting-browser') return
    this.finish(attempt, 'cancelled', { code: 'cancelled' })
  }

  /** The user closed the sign-in window while it still waited. */
  windowClosed(): void {
    const attempt = this.attempt
    if (attempt?.phase === 'waiting-browser') this.finish(attempt, 'cancelled', { code: 'cancelled' })
  }

  private finish(attempt: Attempt, phase: AnywhereSignInPhase, problem?: AnywhereProblem): void {
    if (['succeeded', 'failed', 'cancelled', 'expired'].includes(attempt.phase)) return
    attempt.phase = phase
    if (problem !== undefined) attempt.error = problem
    clearTimeout(attempt.timer)
    attempt.controller.abort()
    attempt.callback?.close()
    // The page shows the outcome; a cancelled attempt was the user's own doing.
    this.shell.closeLogin(phase !== 'cancelled')
  }

  private endAttempt(phase: AnywhereSignInPhase): void {
    const attempt = this.attempt
    if (attempt !== undefined) this.finish(attempt, phase, { code: 'cancelled' })
  }

  /** Redeem the code, get the grant's key and set the gateway up. */
  private async complete(attempt: Attempt, callback: LoopbackCallback, result: CallbackResult): Promise<void> {
    if (this.attempt !== attempt || attempt.phase !== 'waiting-browser' || this.lifetime.signal.aborted) return
    const { origin } = attempt
    // RFC 9207: the response must come from the Tokens Anywhere this attempt asked.
    if (result.iss !== null && result.iss !== origin) { this.finish(attempt, 'failed', { code: 'rejected', detail: 'iss' }); return }
    if ('error' in result) {
      this.finish(attempt, result.error === 'access_denied' ? 'cancelled' : 'failed', { code: result.error === 'access_denied' ? 'denied' : 'rejected', detail: result.error })
      return
    }
    const signal = attempt.controller.signal
    let tokens: { refreshToken: string } | undefined
    let stored = false
    try {
      attempt.phase = 'exchanging'
      const set = await exchangeTokensCode(origin, result.code, callback.verifier, callback.redirectUri, signal)
      tokens = set
      // A fresh access token lasts an hour: the attempt needs no renewal, and the stored account keeps its own.
      const api = new TokensApi(origin, async () => set.accessToken)
      const [user, key] = await Promise.all([api.me(signal), api.managedKey(signal)])

      attempt.phase = 'configuring'
      const routes = await this.models.load(origin, key.secret, signal)
      if (Object.keys(routes).length === 0) throw new AnywhereError('no-models')
      await this.credentials.set(credentialRef(ANYWHERE_API_KEY_REF), key.secret)
      const sealed = await this.shell.seal(set.refreshToken)
      const previousAccount = await this.account()
      const previous = previousAccount?.previousDefault ?? this.defaults.currentSelection()
      const record: AccountRecord = {
        version: 3, origin, user: { displayName: user.displayName || user.loginName, email: user.email },
        key: { id: key.id, prefix: key.prefix },
        ...(sealed === undefined ? {} : { sealedRefreshToken: sealed }),
        connectedAt: new Date().toISOString(),
        ...(isAnywhereRoute(previous.provider) ? {} : { previousDefault: previous }),
      }
      await this.credentials.modifyRecord(ACCOUNT_RECORD, async () => ({ kind: 'grant', payload: record }))
      stored = true
      this.access = { token: set.accessToken, expiresAt: set.expiresAt }
      this.refreshToken = set.refreshToken
      this.sessionEnded = false
      this.memoryOnly = sealed === undefined
      // A new user needs a model that works at once, thinking by default; signing out restores the one before.
      const pick = pickAnywhereDefaultModel(routes)
      if (pick !== undefined && !isAnywhereRoute(this.defaults.currentSelection().provider)) await this.defaults.saveSelection(pick)
      this.balance = undefined
      this.balanceError = undefined
      this.finish(attempt, 'succeeded')
      this.schedule()
      void this.refreshBalance(record)
    } catch (error) {
      if (!(error instanceof AnywhereError)) console.error('[dsh-desktop-next] Anywhere sign-in failed', error)
      // Nothing is left half signed in: a grant this attempt made goes, with its key, and so do routes nobody holds a key for.
      if (tokens !== undefined && !stored) void revokeTokens(origin, tokens.refreshToken, AbortSignal.timeout(10_000))
      if (!stored && (await this.account()) === undefined) await this.models.clear().catch(() => {})
      this.finish(attempt, 'failed', signal.aborted ? { code: 'cancelled' } : anywhereProblem(error))
    }
  }

  /** A valid access token; `renew` asks for a new one after Tokens Anywhere refused the last. */
  private async bearer(renew: boolean): Promise<string> {
    const access = this.access
    if (!renew && access !== undefined && access.expiresAt - Date.now() > ACCESS_MARGIN_MS) return access.token
    return this.renew()
  }

  /** One refresh at a time: Tokens Anywhere revokes a grant whose refresh token is used twice. */
  private renew(): Promise<string> {
    this.renewing ??= (async () => {
      await this.opening
      const account = await this.account()
      const refresh = this.refreshToken
      if (account === undefined || refresh === undefined) {
        this.sessionEnded = true
        throw new AnywhereError('session-ended')
      }
      try {
        const set = await refreshTokens(account.origin, refresh, this.lifetime.signal)
        this.refreshToken = set.refreshToken
        this.access = { token: set.accessToken, expiresAt: set.expiresAt }
        const sealed = await this.shell.seal(set.refreshToken)
        this.memoryOnly = sealed === undefined
        // The old sealed token is spent either way; never leave it to be replayed.
        await this.updateAccount(({ sealedRefreshToken: _spent, ...rest }) => ({ ...rest, ...(sealed === undefined ? {} : { sealedRefreshToken: sealed }) }))
        return set.accessToken
      } catch (error) {
        if (error instanceof TokensGrantError) {
          // The grant ended (revoked on the security page, replayed, expired): its key went with it.
          this.refreshToken = undefined
          this.access = undefined
          this.sessionEnded = true
          void this.serial(() => this.clearAccount({ code: 'session-ended' })).catch(() => {})
        }
        throw error
      }
    })().finally(() => { this.renewing = undefined })
    return this.renewing
  }

  /** Check the key (rotated in the console, say) and the models again, with the session if there still is one. */
  sync(): Promise<void> {
    this.syncing ??= this.serial(async () => {
      const account = await this.account()
      if (account === undefined) return
      const signal = this.lifetime.signal
      let secret = (await this.credentials.resolve(credentialRef(ANYWHERE_API_KEY_REF)))?.value
      if (!this.sessionEnded) {
        try {
          const key = await this.api(account.origin).managedKey(signal)
          if (key.secret !== secret) {
            await this.credentials.set(credentialRef(ANYWHERE_API_KEY_REF), key.secret)
            secret = key.secret
          }
          if (key.id !== account.key.id || key.prefix !== account.key.prefix) {
            await this.updateAccount(current => ({ ...current, key: { id: key.id, prefix: key.prefix } }))
          }
        } catch (error) {
          if (error instanceof TokensGrantError || (await this.account()) === undefined) return
          // Offline or Tokens Anywhere down: the stored key keeps working.
        }
      }
      if (secret !== undefined) await this.models.load(account.origin, secret, signal).catch(() => {})
    }).finally(() => { this.syncing = undefined })
    return this.syncing
  }

  private refreshBalance(account: AccountRecord): Promise<void> {
    this.balancePending ??= (async () => {
      try {
        const balance = await this.api(account.origin).balance(this.lifetime.signal)
        this.balance = { ...balance, checkedAt: new Date().toISOString() }
        this.balanceError = undefined
      } catch (error) {
        this.balanceError = anywhereProblem(error)
      }
    })().finally(() => { this.balancePending = undefined })
    return this.balancePending
  }

  /** Re-read the balance, the key and the model list. */
  async refresh(): Promise<void> {
    const account = await this.account()
    if (account === undefined) return
    this.balance = undefined
    await this.sync()
    if (!this.sessionEnded) await this.refreshBalance(account)
  }

  /** The account's usage for the last 7 or 30 Beijing days, by day and model. */
  async usage(query: URLSearchParams): Promise<AnywhereUsageRows> {
    const account = await this.account()
    if (account === undefined || this.sessionEnded) throw new AnywhereError('session-ended')
    const days = query.get('days') === '7' ? 7 : 30
    const { from, to, dates } = beijingDates(days, new Date())
    return { days, dates, rows: await this.api(account.origin).dailyUsage(from, to, this.lifetime.signal) }
  }

  /** Remove the key, our routes and the account; a default model of ours goes back to the one before. */
  private async clearAccount(notice?: AnywhereProblem): Promise<void> {
    const account = await this.account()
    await this.models.clear()
    await this.credentials.unset(credentialRef(ANYWHERE_API_KEY_REF))
    await this.credentials.deleteRecord(ACCOUNT_RECORD)
    if (isAnywhereRoute(this.defaults.currentSelection().provider) && account?.previousDefault !== undefined) {
      await this.defaults.saveSelection(account.previousDefault)
    }
    clearInterval(this.syncTimer)
    this.access = undefined
    this.refreshToken = undefined
    this.sessionEnded = false
    this.memoryOnly = false
    this.balance = undefined
    this.balanceError = undefined
    this.notice = account === undefined ? undefined : notice
  }

  /** Sign out: end the grant at Tokens Anywhere, which deletes its key, then forget everything here. */
  signOut(): Promise<void> {
    return this.serial(async () => {
      this.endAttempt('cancelled')
      this.attempt = undefined
      const account = await this.account()
      const refresh = this.refreshToken
      if (account !== undefined && refresh !== undefined) await revokeTokens(account.origin, refresh, AbortSignal.timeout(10_000))
      await this.clearAccount()
    })
  }

  changeModel(change: { id?: unknown; family?: unknown; enabled?: unknown; name?: unknown }): Promise<void> {
    return this.serial(() => this.models.change(change))
  }

  resetModels(): Promise<void> {
    return this.serial(() => this.models.reset())
  }

  setCustom(change: { enabled?: unknown }): Promise<void> {
    return this.serial(() => this.models.setCustom(change))
  }

  setDefaultModel(change: { provider?: unknown; model?: unknown; reasoningEffort?: unknown }): Promise<void> {
    return this.serial(() => this.models.setDefault(change))
  }
}

/**
 * Mount the account's Host routes while the connection, credentials, settings and default-model services are up.
 * @param ctx - the desktop-next-capabilities context.
 */
export function installAnywhereAccount(ctx: Context): void {
  ctx.inject(['connection', 'credentials', 'settings', 'agentDefaultModel'], (inner) => {
    const override = process.env[TOKENS_ANYWHERE_URL_VARIABLE]
    const origin = tokensAnywhereOrigin(override)
    if (override !== undefined && override.trim() !== '' && origin !== override.trim().replace(/\/+$/, '')) {
      console.warn(`[dsh-desktop-next] ${TOKENS_ANYWHERE_URL_VARIABLE} is not HTTPS or local HTTP; using ${origin}`)
    }
    let account: AnywhereAccount | undefined
    const shell = new AnywhereShell(process.send === undefined ? undefined : process, () => { account?.windowClosed() }, () => { account?.linkOpened() })
    account = new AnywhereAccount(inner.credentials, inner.settings, inner.agentDefaultModel as DefaultModels, shell, origin)
    const current = account
    inner.effect(() => () => { current.dispose() }, 'Anywhere account sign-in')
    void current.start().catch((error: unknown) => { console.error('[dsh-desktop-next] Anywhere account did not start', error) })
    const act = async (request: Request, run: (body: Record<string, unknown>, query: URLSearchParams) => Promise<unknown>): Promise<Response> => {
      let body: Record<string, unknown> = {}
      if (request.method === 'POST') {
        try {
          const text = await request.text()
          const parsed: unknown = text === '' ? {} : JSON.parse(text)
          if (typeof parsed === 'object' && parsed !== null) body = parsed as Record<string, unknown>
        } catch {
          return Response.json({ error: { code: 'failed' } }, { status: 400, headers: NO_STORE })
        }
      }
      try {
        const result = await run(body, new URL(request.url).searchParams)
        return Response.json({ ...(result === undefined ? {} : { result }), state: await current.snapshot() }, { headers: NO_STORE })
      } catch (error) {
        if (!(error instanceof AnywhereError)) console.error('[dsh-desktop-next] Anywhere account request failed', error)
        return Response.json({ error: anywhereProblem(error), state: await current.snapshot() }, { status: 409, headers: NO_STORE })
      }
    }
    const routes: [string, 'GET' | 'POST', (body: Record<string, unknown>, query: URLSearchParams) => Promise<unknown>][] = [
      [ANYWHERE_ACCOUNT_ROUTES.state, 'GET', async () => undefined],
      [ANYWHERE_ACCOUNT_ROUTES.signIn, 'POST', () => current.begin()],
      [ANYWHERE_ACCOUNT_ROUTES.cancel, 'POST', async (body) => { current.cancel(String(body.id ?? '')) }],
      [ANYWHERE_ACCOUNT_ROUTES.signOut, 'POST', () => current.signOut()],
      [ANYWHERE_ACCOUNT_ROUTES.refresh, 'POST', () => current.refresh()],
      [ANYWHERE_ACCOUNT_ROUTES.defaultModel, 'POST', body => current.setDefaultModel(body)],
      [ANYWHERE_ACCOUNT_ROUTES.model, 'POST', body => current.changeModel(body)],
      [ANYWHERE_ACCOUNT_ROUTES.resetModels, 'POST', () => current.resetModels()],
      [ANYWHERE_ACCOUNT_ROUTES.custom, 'POST', body => current.setCustom(body)],
      [ANYWHERE_ACCOUNT_ROUTES.usage, 'GET', (_body, query) => current.usage(query)],
    ]
    for (const [path, method, run] of routes) {
      inner.connection.fetch.register({
        path, methods: [method], requestBody: 'buffered',
        fetch: (request: Request) => act(request, run),
      })
    }
  })
}
