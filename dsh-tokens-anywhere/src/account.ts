/**
 * Anywhere account: sign in to Tokens Anywhere and use its models without setting up a provider (dsh-desktop#1583).
 * Tokens Anywhere is an OAuth 2.1 authorization server for DSH (anywhere-tokenhub docs/oauth-provider-design.md):
 * the Host opens its authorize page with PKCE, in DSH Next's built-in window where the Desktop serves one, the user
 * signs in there with an Agents Anywhere account, and the code comes back to a one-shot listener on 127.0.0.1. With
 * the tokens the Host asks for the grant's own `dsh-next` key, writes the gateway as `llm-pi-ai` provider routes, and
 * keeps the refresh token sealed by the OS credential store for the balance, usage and key updates. Shared by the
 * Host and the renderer, so this module imports nothing.
 */

/** Host routes; GET reads, POST acts with a JSON body. */
export const ANYWHERE_ACCOUNT_ROUTES = {
  state: '/api/tokens-anywhere/state',
  signIn: '/api/tokens-anywhere/sign-in',
  cancel: '/api/tokens-anywhere/cancel',
  signOut: '/api/tokens-anywhere/sign-out',
  refresh: '/api/tokens-anywhere/refresh',
  /**
   * POST `{ id, enabled?, name? }` switches one model on or off in the model picker or renames it; `{ family, enabled }`
   * switches a whole family.
   */
  model: '/api/tokens-anywhere/model',
  /** POST: forget those switches and names. */
  resetModels: '/api/tokens-anywhere/models/reset',
  /** POST `{ enabled }`: whether the routes are the user's, as an edit in Settings → Models the list cannot express makes them; off puts Tokens Anywhere's back. */
  custom: '/api/tokens-anywhere/custom',
  /** GET with `days` (7 or 30): the account's usage by day and model, which the page sums up. */
  usage: '/api/tokens-anywhere/usage',
  /** GET reads where the page shows besides Settings; POST `{ sidebar?, conversation? }` changes it. */
  placement: '/api/tokens-anywhere/placement',
  /** POST `{ localCurrency }`: whether the page shows amounts in the local currency instead of US dollars; the account's own setting stays as it is. */
  currency: '/api/tokens-anywhere/currency',
  /** POST `{ storeKey?, writeModels?, geminiNative? }`: what the account writes into DSH's local files, and how. */
  local: '/api/tokens-anywhere/local',
  /** POST: the key's secret, for the clipboard. */
  copyKey: '/api/tokens-anywhere/key/copy',
  /** POST: give the key a new secret; the old one stops working at once. */
  rotateKey: '/api/tokens-anywhere/key/rotate',
  /** POST `{ file }`: show one of the account's local files in the file manager. */
  revealFile: '/api/tokens-anywhere/reveal',
  /** POST: open the active Profile's configuration, where the models are, as the Settings dialog's own button does. */
  openConfig: '/api/tokens-anywhere/config/open',
} as const

/** DSH's local files the account writes: the active Profile's configuration (model routes), and the credentials document (the key). */
export type AnywhereLocalFile = 'profile-config' | 'credentials'

/** What the account writes into DSH's local files, kept in the plugin's configuration. */
export interface AnywhereLocalState {
  /** The key is kept in the credentials document, where the model routes read it. */
  readonly storeKey: boolean
  /** The models are written into the active Profile's configuration; they need the stored key. */
  readonly writeModels: boolean
  /** Gemini models go through Google's own Gemini API rather than OpenAI Chat Completions. */
  readonly geminiNative: boolean
  /** Whether a configuration editor can save a change. */
  readonly writable: boolean
  /** Whether the shell can show the files in the file manager. */
  readonly revealFiles: boolean
}

/** Where the page shows besides Settings, kept in the plugin's configuration. */
export interface AnywherePlacementState {
  readonly sidebar: boolean
  readonly conversation: boolean
  /** Whether a configuration editor can save a change. */
  readonly writable: boolean
}

/** Tokens Anywhere: its sign-in and authorize pages, the console, its API and its gateway share this origin. */
export const TOKENS_ANYWHERE_ORIGIN = 'https://tokens-anywhere.com'

/**
 * Development override of TOKENS_ANYWHERE_ORIGIN, read by the Host at startup, such as a local web dev server
 * (`http://localhost:5173`, which proxies the API and needs `localhost` for its Secure cookies).
 */
export const TOKENS_ANYWHERE_URL_VARIABLE = 'DSH_NEXT_TOKENS_ANYWHERE_URL'

/**
 * The Tokens Anywhere origin to use: an override that is HTTPS, or HTTP on this computer, else production. Tokens and
 * the key travel to this origin, so nothing else is accepted.
 * @param override - the development variable's value, if set.
 */
export function tokensAnywhereOrigin(override: string | undefined): string {
  if (override === undefined || override.trim() === '') return TOKENS_ANYWHERE_ORIGIN
  let url: URL
  try {
    url = new URL(override.trim())
  } catch {
    return TOKENS_ANYWHERE_ORIGIN
  }
  if (url.username !== '' || url.password !== '') return TOKENS_ANYWHERE_ORIGIN
  const local = url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
  return url.protocol === 'https:' || local ? url.origin : TOKENS_ANYWHERE_ORIGIN
}

/**
 * Provider routes the account writes into the `llm-pi-ai` entry, one per model vendor so the model picker groups them
 * that way, and the credential reference they read. DeepSeek and GPT go through OpenAI Chat Completions
 * (dsh-desktop#1583), and Claude through Anthropic Messages, the only protocol Tokens Anywhere serves it with. Gemini
 * goes through Chat Completions too, as Tokens Anywhere's own DeepSeek Harness guide sets it up, or, where the account's
 * setting asks, through Google's Gemini API, which `llm-pi-ai` takes on a hand-declared route since dsh 0.2.2-rc.2.
 * GLM, Kimi and Grok go through Chat Completions as well, and MiniMax through Anthropic Messages, the protocol pi-ai's
 * catalog sets MiniMax up with, as its Chat Completions writes the thinking into the reply. A vendor the account does
 * not know yet gets a route of its own as well ({@link anywhereRouteId}), and models no provider is named for share
 * Chat Completions under the plain id. pi-ai 1.4 sends Gemini 4 models the thinking level they require, not a
 * thinking budget.
 */
export const ANYWHERE_ROUTE_IDS = {
  deepseek: 'tokens-anywhere-deepseek',
  claude: 'tokens-anywhere-claude',
  gpt: 'tokens-anywhere-gpt',
  gemini: 'tokens-anywhere-gemini',
  minimax: 'tokens-anywhere-minimax',
  glm: 'tokens-anywhere-glm',
  kimi: 'tokens-anywhere-kimi',
  grok: 'tokens-anywhere-grok',
  other: 'tokens-anywhere',
} as const satisfies Record<KnownModelFamily | 'other', string>
/** Routes an earlier build wrote, removed whenever the routes are rewritten. */
export const RETIRED_ROUTE_IDS: readonly string[] = ['tokens-anywhere-openai']
export const ANYWHERE_API_KEY_REF = 'TOKENS_ANYWHERE_API_KEY'

/** A table's own entry for a key that may come from Tokens Anywhere, never one an object inherits. */
function own<T>(table: Readonly<Partial<Record<string, T>>>, key: string): T | undefined {
  return Object.hasOwn(table, key) ? table[key] : undefined
}

/** The route of a family: a known vendor's above, `tokens-anywhere-<family>` for any other provider's. */
export function anywhereRouteId(family: AnywhereModelFamily): string {
  return own<string>(ANYWHERE_ROUTE_IDS, family) ?? `${ANYWHERE_ROUTE_IDS.other}-${family}`
}

/**
 * Whether an `llm-pi-ai` provider is one of the account's routes: a known vendor's or a retired id, or a route under
 * the account's prefix that reads the account's key, as every route it writes does. A provider the user added under a
 * similar id reads another key, so it stays theirs.
 */
export function isAnywhereRoute(id: string, route: { readonly apiKeyEnv?: unknown } | undefined): boolean {
  if ((Object.values(ANYWHERE_ROUTE_IDS) as string[]).includes(id) || RETIRED_ROUTE_IDS.includes(id)) return true
  return id.startsWith(`${ANYWHERE_ROUTE_IDS.other}-`) && route?.apiKeyEnv === ANYWHERE_API_KEY_REF
}

/** Sign-in progress, like the official DeepSeek account's attempt phases. */
export type AnywhereSignInPhase =
  | 'idle'
  | 'waiting-browser'
  | 'exchanging'
  | 'configuring'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'expired'

/** Failure kinds the page explains in its own language. */
export type AnywhereErrorCode =
  | 'network' | 'server' | 'rejected' | 'session-ended' | 'denied' | 'cancelled' | 'expired' | 'busy'
  | 'no-models' | 'no-catalog' | 'unknown-model' | 'failed'

/** A failure as the page shows it; `detail` is Tokens Anywhere's own wording, if any. */
export interface AnywhereProblem {
  readonly code: AnywhereErrorCode
  readonly detail?: string
}

/** The vendors the account knows, in display order, under DSH's names for them: Claude is Anthropic's, GPT OpenAI's. */
export const KNOWN_MODEL_FAMILIES = ['deepseek', 'claude', 'gpt', 'gemini', 'minimax', 'glm', 'kimi', 'grok'] as const
export type KnownModelFamily = typeof KNOWN_MODEL_FAMILIES[number]

/**
 * A model family, as the page groups models and the routes split them: a vendor the account knows, any other provider
 * Tokens Anywhere names under that provider's id, or `other` for models no provider is named for.
 */
export type AnywhereModelFamily = string

function isKnownFamily(family: AnywhereModelFamily): family is KnownModelFamily {
  return (KNOWN_MODEL_FAMILIES as readonly string[]).includes(family)
}

/** Providers Tokens Anywhere names (`GET /api/v1/status`, the price list, `owned_by`) that DSH calls by a model's name. */
const RENAMED_PROVIDERS: Readonly<Record<string, KnownModelFamily>> = { anthropic: 'claude', openai: 'gpt' }

/**
 * The family of a provider Tokens Anywhere names: a known vendor under DSH's name, any other under its own id,
 * lowercased with anything but letters and digits made a dash, so it can name a route. Undefined for no usable id.
 */
export function anywhereProviderFamily(provider: string): AnywhereModelFamily | undefined {
  const id = provider.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (id === '' || id === 'other') return undefined
  return own(RENAMED_PROVIDERS, id) ?? id
}

/** Families in display order: the known vendors in theirs, then any other provider by id, then `other`. */
export function compareFamilies(a: AnywhereModelFamily, b: AnywhereModelFamily): number {
  const rank = (family: AnywhereModelFamily): number => family === 'other' ? KNOWN_MODEL_FAMILIES.length + 1
    : isKnownFamily(family) ? KNOWN_MODEL_FAMILIES.indexOf(family) : KNOWN_MODEL_FAMILIES.length
  return rank(a) - rank(b) || a.localeCompare(b)
}

const FAMILY_NAMES: Readonly<Record<KnownModelFamily, string>> = {
  deepseek: 'DeepSeek', claude: 'Claude', gpt: 'GPT', gemini: 'Gemini', minimax: 'MiniMax', glm: 'GLM', kimi: 'Kimi', grok: 'Grok',
}

/** A family's name on the page and on its route: DSH's for a known vendor, the provider's id capitalized for another. */
export function anywhereFamilyName(family: AnywhereModelFamily): string {
  return own(FAMILY_NAMES, family) ?? `${family.charAt(0).toUpperCase()}${family.slice(1)}`
}

/** Families that go through Anthropic Messages, so listed in Anthropic's form and thinking in its efforts. */
const MESSAGES_FAMILIES: readonly AnywhereModelFamily[] = ['claude', 'minimax']

/** The protocol of a route, as `llm-pi-ai` names it. */
export type AnywhereRouteApi = 'anthropic-messages' | 'google-generative-ai' | 'openai-completions'

/** One model Tokens Anywhere offers the key, as the page lists it. */
export interface AnywhereModelView {
  readonly id: string
  /** The name shown in the model picker: the user's own, else Tokens Anywhere's. */
  readonly name: string
  /** Tokens Anywhere's name, for going back from a rename. */
  readonly defaultName: string
  readonly family: AnywhereModelFamily
  /** The route serving it; absent for a model listed where none of our routes can call it. */
  readonly route?: string
  /** The protocol its family's route speaks; absent where no protocol a route speaks reaches the family. */
  readonly api?: AnywhereRouteApi
  /** Offered in the model picker. */
  readonly enabled: boolean
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly vision: boolean
  /** Thinking levels the picker offers, weakest first, `off` first where thinking can be turned off; empty for a model that does not think. */
  readonly thinking: readonly string[]
}

/** The user's switches and names on Tokens Anywhere's list, kept across refreshes and sign-outs. */
export interface AnywhereModelOverrides {
  /** Models left out of the model picker. */
  readonly hidden: readonly string[]
  /** Display names by model id. */
  readonly names: Readonly<Record<string, string>>
  /** Families switched off as a whole: models Tokens Anywhere adds to them later stay off too. */
  readonly hiddenFamilies?: readonly string[]
}

/** One model our routes offer right now, whoever configured them. */
export interface AnywhereOfferedModel {
  readonly route: string
  readonly id: string
  readonly name: string
  /** Thinking levels it offers, weakest first; empty for a model that does not think. */
  readonly thinking: readonly string[]
}

/** What the page renders; it never carries a token or key. */
export interface AnywhereAccountSnapshot {
  /** The Tokens Anywhere the page links to for the console and top-up. */
  readonly origin: string
  /** What that Tokens Anywhere says of itself, once read: its currency and the providers it serves. */
  readonly site?: AnywhereSite
  readonly attempt?: {
    readonly id: string
    readonly phase: AnywhereSignInPhase
    readonly authorizeUrl?: string
    readonly error?: AnywhereProblem
  }
  readonly account?: {
    readonly displayName: string
    readonly email: string
    readonly keyPrefix: string
    readonly connectedAt: string
    /** No usable refresh token: the models keep working; the balance and usage need a new sign-in. */
    readonly sessionEnded?: boolean
    /** The OS credential store is unavailable, so the refresh token lives only until the app quits. */
    readonly memoryOnly?: boolean
  }
  readonly balance?: {
    /** In the site's currency with six decimals, as are all of the page's amounts. */
    readonly available: string
    readonly held: string
    readonly checkedAt: string
  }
  /** Why the balance could not be read, while the account stays signed in. */
  readonly balanceError?: AnywhereProblem
  /** How the account shows money, while signed in. */
  readonly money?: AnywhereMoneyDisplay
  /** Every model Tokens Anywhere offers the key, absent until it was read once since the Host started. */
  readonly models?: readonly AnywhereModelView[]
  /** Why the model list could not be read. */
  readonly modelsError?: AnywhereProblem
  /** What the routes offer now, as the model picker lists them. */
  readonly offered?: readonly AnywhereOfferedModel[]
  /** The routes are the user's, edited in Settings → Models; Tokens Anywhere's list no longer changes them. */
  readonly custom?: boolean
  /** Custom routes differ from what Tokens Anywhere's list would write, so leaving custom configuration loses something. */
  readonly customEdited?: boolean
  /** Why the account signed itself out, until the next sign-in. */
  readonly notice?: AnywhereProblem
  readonly local: AnywhereLocalState
}

/**
 * The currency a Tokens Anywhere keeps every amount in, fixed when it was set up: US dollars on the international site,
 * yuan on the China site (anywhere-tokenhub docs/deployment.md). One site never converts to the other.
 */
export type AnywhereCurrency = 'USD' | 'CNY'

/** What a Tokens Anywhere says of itself (`GET /api/v1/status`, with its public price list). */
export interface AnywhereSite {
  /** Its currency; US dollars where it does not say, as every site did before the China site. */
  readonly currency: AnywhereCurrency
  /** The providers it serves that it prices a conversation model of, in its own order; absent where it does not say. */
  readonly providers?: readonly string[]
}

/**
 * How Tokens Anywhere's console shows money (web/lib/currency.ts, web/lib/local-currency.ts): every amount is in the
 * site's currency. On the international site, whose amounts are US dollars, a reader whose language has a currency of
 * its own sees it beside them at the day's rate, display only, while local currency is on; the China site keeps yuan
 * and has no rates. The page shows one currency only: yuan for a Chinese reader while local currency is on, the site's
 * own currency otherwise.
 */
export interface AnywhereMoneyDisplay {
  /** The site's currency, the one every amount is in. */
  readonly currency: AnywhereCurrency
  /**
   * Whether local currency is on: the page's own choice, else the account's setting (`GET /api/v1/me/preferences`), else
   * off. Always off on a site that keeps yuan.
   */
  readonly localCurrency: boolean
  /** How many yuan a US dollar buys (`GET /api/v1/exchange-rates`); absent while there is no rate, and on the China site. */
  readonly cnyRate?: number
}

/** Usage ranges the page offers, in days. */
export type AnywhereUsageRange = 7 | 30

export interface AnywhereUsageTotals {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Cache reads and writes. */
  readonly cacheTokens: number
  /** Charged, in the site's currency with six decimals. */
  readonly amount: string
}

/** The usage board's data, per Beijing day as Tokens Anywhere bills. */
export interface AnywhereUsage {
  readonly days: AnywhereUsageRange
  readonly from: string
  readonly to: string
  readonly totals: AnywhereUsageTotals
  /** Every day of the range, oldest first, days without use included, with its spend per model. */
  readonly daily: readonly (AnywhereUsageTotals & { readonly date: string; readonly byModel: Readonly<Record<string, string>> })[]
  /** Per model, costliest first. */
  readonly models: readonly (AnywhereUsageTotals & { readonly model: string })[]
}

/** One row of Tokens Anywhere's `GET /api/v1/usage/daily?groupBy=model`. */
export interface TokensUsageRow {
  readonly date: string
  readonly model: string | null
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  readonly cacheReadTokens: number
  readonly cacheWrite5mTokens: number
  readonly cacheWrite1hTokens: number
  readonly amountCharged: string
}

/** What the Host reads for a range. The page sums it up, for every model or a chosen one, without asking again. */
export interface AnywhereUsageRows {
  readonly days: AnywhereUsageRange
  /** Every date of the range, oldest first. */
  readonly dates: readonly string[]
  readonly rows: readonly TokensUsageRow[]
}

const BEIJING_OFFSET_MS = 8 * 3_600_000

/**
 * The last `days` Beijing calendar dates up to `now`'s, oldest first.
 * @returns the dates and the range's ends in `YYYY-MM-DD`.
 */
export function beijingDates(days: number, now: Date): { from: string; to: string; dates: string[] } {
  const today = new Date(now.getTime() + BEIJING_OFFSET_MS)
  const dates: string[] = []
  for (let back = days - 1; back >= 0; back--) {
    dates.push(new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - back)).toISOString().slice(0, 10))
  }
  return { from: dates[0]!, to: dates[dates.length - 1]!, dates }
}

/** Millionths of the site's currency, Tokens Anywhere's unit of money, so sums stay exact. */
export function moneyUnits(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,6}))?$/u.exec(value.trim())
  if (match === null) return 0
  const units = Number(match[2]) * 1_000_000 + Number((match[3] ?? '').padEnd(6, '0'))
  return match[1] === undefined ? units : -units
}

/** Millionths as Tokens Anywhere writes an amount: whole units with six decimals. */
export function formatMoneyUnits(units: number): string {
  const sign = units < 0 ? '-' : ''
  const absolute = Math.abs(units)
  return `${sign}${Math.floor(absolute / 1_000_000)}.${String(absolute % 1_000_000).padStart(6, '0')}`
}

/**
 * Totals, daily series and per-model rows from Tokens Anywhere's daily usage.
 * @param usage - `groupBy=model` rows for the range and the range's dates.
 * @param only - this model alone, `''` for rows without a model; every model if undefined.
 */
export function summarizeAnywhereUsage({ days, dates, rows }: AnywhereUsageRows, only?: string): AnywhereUsage {
  interface Sum { requests: number; inputTokens: number; outputTokens: number; cacheTokens: number; units: number }
  const empty = (): Sum => ({ requests: 0, inputTokens: 0, outputTokens: 0, cacheTokens: 0, units: 0 })
  const add = (sum: Sum, row: TokensUsageRow): void => {
    sum.requests += row.requests
    sum.inputTokens += row.inputTokens
    sum.outputTokens += row.outputTokens
    sum.cacheTokens += row.cacheReadTokens + row.cacheWrite5mTokens + row.cacheWrite1hTokens
    sum.units += moneyUnits(row.amountCharged)
  }
  const done = ({ units, ...rest }: Sum): AnywhereUsageTotals => ({ ...rest, amount: formatMoneyUnits(units) })
  const total = empty()
  const byDate = new Map(dates.map(date => [date, empty()]))
  const byDateModel = new Map(dates.map(date => [date, new Map<string, number>()]))
  const byModel = new Map<string, Sum>()
  for (const row of rows) {
    const day = byDate.get(row.date)
    if (day === undefined) continue
    const model = row.model ?? ''
    if (only !== undefined && model !== only) continue
    add(day, row)
    const spent = byDateModel.get(row.date)!
    spent.set(model, (spent.get(model) ?? 0) + moneyUnits(row.amountCharged))
    add(total, row)
    const sum = byModel.get(model) ?? empty()
    add(sum, row)
    byModel.set(model, sum)
  }
  return {
    days, from: dates[0] ?? '', to: dates[dates.length - 1] ?? '', totals: done(total),
    daily: dates.map(date => ({
      date, ...done(byDate.get(date)!),
      byModel: Object.fromEntries([...byDateModel.get(date)!].map(([model, units]) => [model, formatMoneyUnits(units)])),
    })),
    models: [...byModel.entries()].sort(([a, x], [b, y]) => y.units - x.units || y.requests - x.requests || a.localeCompare(b))
      .map(([model, sum]) => ({ model, ...done(sum) })),
  }
}

/** One model of Tokens Anywhere's public price list (`GET /api/v1/pricing`). */
export interface TokensPricedModel {
  readonly model: string
  readonly provider: string
  readonly maxOutputTokens?: number | null
  /** Set for a video model, priced by the second of video instead of by the token. */
  readonly video?: unknown
}

/** One model of `GET /v1/models` in OpenAI's form; since November 2026 it also names the endpoints that reach it. */
export interface TokensListedModel {
  readonly id?: unknown
  /** The model's provider, as the price list names it. */
  readonly owned_by?: unknown
  readonly endpoints?: unknown
}

/** Endpoints Tokens Anywhere names that hold a conversation, as DSH's routes do. */
const CONVERSATION_ENDPOINTS: readonly string[] = ['chat_completions', 'responses', 'messages', 'generate_content']

/** The endpoint types the list names for a model; undefined where it names none, as releases before November 2026. */
export function listedEndpointTypes(item: TokensListedModel): string[] | undefined {
  if (!Array.isArray(item?.endpoints)) return undefined
  return item.endpoints.flatMap((endpoint: { type?: unknown } | null) => typeof endpoint?.type === 'string' ? [endpoint.type] : [])
}

/**
 * Models DSH leaves out of everything it lists: those that hold no conversation. Tokens Anywhere names each model's
 * endpoints, and a video or embeddings model has only its own (video tasks, embeddings), so a model is left out where
 * the list names endpoints for it but none that holds a conversation. A list without endpoints, as releases before
 * November 2026 answer, leaves it to the price list, which prices video models by the second of video.
 * @param listed - `GET /v1/models` in OpenAI's form.
 */
export function nonChatModelIds(listed: readonly TokensListedModel[], priced: readonly TokensPricedModel[]): Set<string> {
  const ids = new Set<string>()
  for (const item of listed) {
    const types = listedEndpointTypes(item)
    if (typeof item?.id === 'string' && types !== undefined && !types.some(type => CONVERSATION_ENDPOINTS.includes(type))) ids.add(item.id)
  }
  for (const item of priced) {
    if (item.video !== undefined && item.video !== null) ids.add(item.model)
  }
  return ids
}

/** The models of a price list's default group, which keys start in, else of its first; undefined for no price list. */
export function defaultPricedModels(pricing: unknown): TokensPricedModel[] | undefined {
  const groups = (pricing as { groups?: unknown } | undefined)?.groups
  if (!Array.isArray(groups)) return undefined
  const group = (groups as { name?: unknown; models?: unknown }[]).find(item => item?.name === 'default') ?? groups[0] as { models?: unknown } | undefined
  return Array.isArray(group?.models) ? group.models as TokensPricedModel[] : undefined
}

/** The providers a price list has a conversation model of: a provider with only video models is not among them. */
export function conversationProviders(priced: readonly TokensPricedModel[]): Set<string> {
  return new Set(priced.flatMap(item => typeof item?.provider === 'string' && (item.video === undefined || item.video === null) ? [item.provider] : []))
}

/** Display facts Tokens Anywhere keeps per model. */
export interface TokensModelProfile {
  readonly displayName?: string
  readonly contextWindow?: number | null
  readonly capabilities?: readonly string[]
}

/** Levels pi-ai knows, weakest first. */
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const
type ThinkingLevel = typeof THINKING_LEVELS[number]

/** A model's thinking as pi-ai's catalog writes it: a string is the wire value, null an unsupported level. */
type CatalogThinking = Partial<Record<ThinkingLevel, string | null>>

/** Gemini's `thinkingLevel` values in pi-ai's catalog: the flash models', and those of the models without `minimal`. */
const GEMINI_LEVELS: CatalogThinking = { off: null, minimal: 'minimal', low: 'low', medium: 'medium', high: 'high', xhigh: null, max: null }
const GEMINI_CORE_LEVELS: CatalogThinking = { ...GEMINI_LEVELS, minimal: null }

/** GLM's reasoning efforts in pi-ai's catalog: 5.2 can turn thinking off, 5.3 adds a low effort instead. */
const GLM_52_LEVELS: CatalogThinking = { off: 'none', minimal: null, low: null, medium: null, high: 'high', xhigh: null, max: 'max' }
const GLM_53_LEVELS: CatalogThinking = { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' }

/**
 * Thinking of the models Tokens Anywhere serves, copied from pi-ai's catalog for the same model ids (DSH 0.2.1-rc.5;
 * GLM, Kimi and MiniMax from pi-ai 1.4 in DSH 0.2.2-rc.3): the level map and the switches that change how a level is
 * sent. Our routes are not pi-ai catalog providers, so nothing would fill these in. A model missing here gets its
 * family's default below, which for GLM, Kimi and MiniMax is what the catalog gives their earlier models.
 */
const KNOWN_THINKING: Readonly<Record<string, {
  levels: CatalogThinking; adaptive?: true; noTemperature?: true; compat?: Readonly<Record<string, string | boolean>>
}>> = {
  'claude-fable-5': { levels: { off: null, xhigh: 'xhigh', max: 'max' }, adaptive: true },
  'claude-fable-5-1': { levels: { off: null, xhigh: 'xhigh', max: 'max' }, adaptive: true },
  'claude-haiku-4-5': { levels: {} },
  'claude-haiku-5-5': { levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, adaptive: true, noTemperature: true },
  'claude-opus-4-6': { levels: { max: 'max' }, adaptive: true },
  'claude-opus-4-7': { levels: { xhigh: 'xhigh', max: 'max' }, adaptive: true, noTemperature: true },
  'claude-opus-4-8': { levels: { xhigh: 'xhigh', max: 'max' }, adaptive: true, noTemperature: true },
  'claude-opus-5': { levels: { off: null, xhigh: 'xhigh', max: 'max' }, adaptive: true, noTemperature: true },
  'claude-opus-5-5': { levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, adaptive: true, noTemperature: true },
  'claude-sonnet-5': { levels: { xhigh: 'xhigh', max: 'max' }, adaptive: true },
  'claude-sonnet-5-5': { levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, adaptive: true, noTemperature: true },
  'deepseek-flash': { levels: { minimal: null, low: 'low', medium: null, high: 'high', max: 'max' } },
  'deepseek-v4-pro': { levels: { minimal: null, low: null, medium: null, high: 'high', max: 'max' } },
  // pi-ai turns these into a thinking budget: the catalog declares no levels, and the budget can be zero.
  'gemini-2.5-flash': { levels: {} },
  'gemini-3-flash-preview': { levels: GEMINI_LEVELS },
  'gemini-3.1-flash-lite': { levels: GEMINI_LEVELS },
  'gemini-3.1-pro-preview': { levels: GEMINI_CORE_LEVELS },
  'gemini-3.5-flash': { levels: GEMINI_LEVELS },
  'gemini-3.5-flash-lite': { levels: GEMINI_LEVELS },
  'gemini-3.6-flash': { levels: GEMINI_LEVELS },
  'gemini-3.7-flash': { levels: GEMINI_CORE_LEVELS },
  'gemini-3.8-flash': { levels: GEMINI_CORE_LEVELS },
  'gpt-5.6-sol': { levels: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  'gpt-5.6-terra': { levels: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  'gpt-6-astra': { levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  'gpt-6-sol': { levels: { off: 'none', minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  'gpt-6.1-sol': { levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' } },
  // GLM 5.2 and later take a reasoning effort besides switching thinking on.
  'glm-5.2': { levels: GLM_52_LEVELS, compat: { supportsReasoningEffort: true } },
  'glm-5.2-highspeed': { levels: GLM_52_LEVELS, compat: { supportsReasoningEffort: true } },
  'glm-5.3': { levels: GLM_53_LEVELS, compat: { supportsReasoningEffort: true } },
  'glm-5.3-flash': { levels: GLM_53_LEVELS, compat: { supportsReasoningEffort: true } },
  'glm-5.3-highspeed': { levels: GLM_53_LEVELS, compat: { supportsReasoningEffort: true } },
  // The coding models always think.
  'kimi-k2.7-code': { levels: { off: null } },
  'kimi-k2.7-code-highspeed': { levels: { off: null } },
  'kimi-k3': {
    levels: { off: null, minimal: null, low: 'low', medium: null, high: 'high', xhigh: null, max: 'max' },
    compat: { thinkingFormat: 'openai', supportsReasoningEffort: true, requiresReasoningContentOnAssistantMessages: true },
  },
  'MiniMax-M3.1-Flash': { levels: { off: null, minimal: null, low: 'low', medium: 'medium', high: 'high', xhigh: 'xhigh', max: 'max' }, adaptive: true },
}

/** Family defaults for a model pi-ai's catalog does not describe yet; a vendor the account does not know has none. */
const FAMILY_THINKING: Readonly<Partial<Record<KnownModelFamily, CatalogThinking>>> = {
  gpt: { off: 'none', minimal: null },
  deepseek: { minimal: null, low: null, medium: null, high: 'high', max: 'max' },
  claude: {},
  gemini: GEMINI_CORE_LEVELS,
  minimax: {},
  glm: {},
  kimi: {},
}

/** DeepSeek through Chat Completions, as pi-ai's catalog sends it: thinking in its own format, kept across turns. */
const DEEPSEEK_COMPAT = {
  supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens',
  requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek',
} as const

/**
 * Gemini through Chat Completions, which Tokens Anywhere passes to Google's OpenAI compatibility as it is: system
 * instructions in the system role, as pi-ai's catalog sends Gemini through OpenAI-style gateways, and no `store`.
 */
const GEMINI_CHAT_COMPAT = { supportsStore: false, supportsDeveloperRole: false } as const

/**
 * GLM, Kimi and Grok through Chat Completions, as pi-ai sends them to their own APIs (its catalog, and what it detects
 * for Z.ai, Moonshot and xAI): no `store`, system instructions in the system role, and thinking switched on or off in
 * GLM's and DeepSeek's formats rather than as an effort, which only the models above that take one add. Tokens Anywhere
 * passes them on as they are, and our routes are not those providers, so nothing would detect these.
 */
const GLM_COMPAT = {
  supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens', thinkingFormat: 'zai',
} as const
const KIMI_COMPAT = {
  supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false, maxTokensField: 'max_tokens', thinkingFormat: 'deepseek',
} as const
const GROK_COMPAT = { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false } as const

/** What each family's models need on a Chat Completions route; a known model's own switches come on top. */
const CHAT_COMPAT: Readonly<Partial<Record<KnownModelFamily, Readonly<Record<string, string | boolean>>>>> = {
  deepseek: DEEPSEEK_COMPAT, gemini: GEMINI_CHAT_COMPAT, glm: GLM_COMPAT, kimi: KIMI_COMPAT, grok: GROK_COMPAT,
}

/**
 * The levels Gemini's own protocol accepts: pi-ai's Gemini implementation sends only these, each under its own name,
 * and fails a request naming anything else, so the official Models page offers no Off on such a route either.
 */
const GEMINI_NATIVE_LEVELS: readonly ThinkingLevel[] = ['minimal', 'low', 'medium', 'high']

/**
 * The levels a DSH profile declares for a catalog thinking map. In pi-ai's catalog a level left out keeps its default
 * wire value and only `xhigh` and `max` must be named; a DSH profile offers exactly the levels it declares. So a
 * missing `off` becomes "off, send nothing", missing standard levels are declared under their own names (Anthropic
 * Messages takes them as efforts, Chat Completions as `reasoning_effort`), and `minimal`, which Anthropic Messages has
 * no effort for, is dropped there.
 * @param api - the route's protocol; Gemini's own keeps only {@link GEMINI_NATIVE_LEVELS}.
 */
function declaredThinking(levels: CatalogThinking, api: AnywhereRouteApi | undefined): Partial<Record<ThinkingLevel, string | null>> {
  const declared: Partial<Record<ThinkingLevel, string | null>> = {}
  for (const level of THINKING_LEVELS) {
    const wire = levels[level]
    if (wire === null) continue
    if (typeof wire === 'string') { declared[level] = wire; continue }
    if (level === 'off') declared.off = null
    else if (level === 'xhigh' || level === 'max' || (level === 'minimal' && api === 'anthropic-messages')) continue
    else declared[level] = level
  }
  if (api === 'google-generative-ai') {
    for (const level of THINKING_LEVELS) if (!GEMINI_NATIVE_LEVELS.includes(level) || declared[level] !== level) delete declared[level]
  }
  return declared
}

/** One model as an `llm-pi-ai` route lists it. */
export interface PiAiRouteModel {
  readonly id: string
  readonly name: string
  readonly contextWindow?: number
  readonly maxTokens?: number
  readonly input: readonly ('text' | 'image')[]
  /** Offered thinking levels and their wire values; false for a model that does not think. */
  readonly reasoningEfforts?: false | Readonly<Partial<Record<string, string | null>>>
  readonly compat?: Readonly<Record<string, string | boolean>>
}

/** One `llm-pi-ai` provider route. */
export interface PiAiRoute {
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly api: AnywhereRouteApi
  readonly baseURL: string
  /** Thinking level a session uses until it picks one; every model on the route offers it. */
  readonly reasoning?: string
  readonly models: readonly PiAiRouteModel[]
}

/** Model id prefixes of each family, for a model whose provider Tokens Anywhere does not name, as earlier releases. */
const FAMILY_PREFIXES: readonly (readonly [string, KnownModelFamily])[] = [
  ['claude-', 'claude'], ['deepseek-', 'deepseek'], ['gemini-', 'gemini'], ['minimax-', 'minimax'], ['glm-', 'glm'], ['kimi-', 'kimi'],
  ['grok-', 'grok'],
]

/** A model's family, from Tokens Anywhere's provider, else its id; `other` where neither tells. */
export function anywhereModelFamily(provider: string | undefined, id: string): AnywhereModelFamily {
  const named = provider === undefined ? undefined : anywhereProviderFamily(provider)
  if (named !== undefined) return named
  const lower = id.toLowerCase()
  return FAMILY_PREFIXES.find(([prefix]) => lower.startsWith(prefix))?.[1] ?? 'other'
}

/** Thinking level preferred as the default, strongest that every model is likely to offer first. */
const DEFAULT_THINKING_ORDER = ['high', 'medium', 'xhigh', 'max', 'low'] as const

/** A route's default level: one every model on it offers, as a default some model lacks fails its requests. */
export function commonThinkingLevel(models: readonly Pick<PiAiRouteModel, 'reasoningEfforts'>[]): string | undefined {
  const offered = models.map(model => model.reasoningEfforts ? Object.keys(model.reasoningEfforts) : [])
  return DEFAULT_THINKING_ORDER.find(level => offered.length > 0 && offered.every(levels => levels.includes(level)))
}

/**
 * Everything Tokens Anywhere offers the key, with the user's switches and names: families, display names, sizes and
 * the thinking levels each model offers. A model reaches a route only through the protocol its family goes through:
 * Claude and MiniMax through Anthropic Messages, Gemini through Chat Completions or, with `geminiNative`, its own API,
 * the other known vendors and models of no named provider through Chat Completions. A vendor the account does not know
 * goes through the first protocol any of its models is listed for (Chat Completions, Anthropic Messages, Gemini's API)
 * and offers no thinking levels, as nothing says how it takes them.
 * @param input.chat - ids `GET /v1/models` lists in OpenAI form; input.anthropic - ids it lists in Anthropic form;
 * input.gemini - ids it lists to a Gemini client; input.owners - the providers the list names, for models the price
 * list does not have.
 */
export function planAnywhereModels(input: {
  readonly chat: readonly string[]
  readonly anthropic: readonly string[]
  readonly gemini: readonly string[]
  readonly priced: readonly TokensPricedModel[]
  readonly profiles: Readonly<Record<string, TokensModelProfile>>
  readonly owners?: Readonly<Record<string, string>>
  readonly overrides?: AnywhereModelOverrides
  /** Gemini through Google's Gemini API rather than Chat Completions. */
  readonly geminiNative?: boolean
}): AnywhereModelView[] {
  const priced = new Map(input.priced.map(item => [item.model, item]))
  const ids = [...new Set([...input.chat, ...input.anthropic, ...input.gemini])]
  const hidden = new Set(input.overrides?.hidden)
  const hiddenFamilies = new Set(input.overrides?.hiddenFamilies)
  const lists: Readonly<Record<AnywhereRouteApi, ReadonlySet<string>>> = {
    'openai-completions': new Set(input.chat), 'anthropic-messages': new Set(input.anthropic), 'google-generative-ai': new Set(input.gemini),
  }
  const families = new Map(ids.map(id => [id, anywhereModelFamily(priced.get(id)?.provider ?? own(input.owners ?? {}, id), id)]))
  const apis = new Map<AnywhereModelFamily, AnywhereRouteApi | undefined>()
  const apiOf = (family: AnywhereModelFamily): AnywhereRouteApi | undefined => {
    if (!apis.has(family)) {
      const members = ids.filter(id => families.get(id) === family)
      apis.set(family, MESSAGES_FAMILIES.includes(family) ? 'anthropic-messages'
        : family === 'gemini' ? (input.geminiNative === true ? 'google-generative-ai' : 'openai-completions')
          : isKnownFamily(family) || family === 'other' ? 'openai-completions'
            : (['openai-completions', 'anthropic-messages', 'google-generative-ai'] as const).find(api => members.some(id => lists[api].has(id))))
    }
    return apis.get(family)
  }
  return ids.map((id): AnywhereModelView => {
    const family = families.get(id) ?? 'other'
    const api = apiOf(family)
    const route = api !== undefined && lists[api].has(id) ? anywhereRouteId(family) : undefined
    const profile = own(input.profiles, id)
    const defaultName = profile?.displayName || id
    const contextWindow = typeof profile?.contextWindow === 'number' ? profile.contextWindow : undefined
    const maxTokens = priced.get(id)?.maxOutputTokens ?? undefined
    const levels = own(KNOWN_THINKING, id)?.levels ?? (isKnownFamily(family) ? FAMILY_THINKING[family] : undefined)
    const declared = levels === undefined ? [] : Object.keys(declaredThinking(levels, api))
    // A model offering nothing but `off` does not think.
    const thinking = declared.some(level => level !== 'off') ? declared : []
    return {
      id, name: own(input.overrides?.names ?? {}, id) || defaultName, defaultName, family,
      ...(route === undefined ? {} : { route }),
      ...(api === undefined ? {} : { api }),
      enabled: route !== undefined && !hidden.has(id) && !hiddenFamilies.has(family),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
      vision: profile?.capabilities?.includes('vision') === true,
      thinking,
    }
  }).sort((a, b) => compareFamilies(a.family, b.family) || a.id.localeCompare(b.id))
}

/**
 * The `llm-pi-ai` routes for the enabled models, one per family in display order, each in the protocol its models
 * carry. Each model carries its thinking levels and the switches that send them; a route's default level is the
 * strongest common one every model on it offers, so new sessions think.
 * @param origin - the Tokens Anywhere origin; Chat Completions lives under `/v1`, Gemini's API under `/v1beta`.
 */
export function anywhereRoutes(models: readonly AnywhereModelView[], origin: string): Record<string, PiAiRoute> {
  const base = origin.replace(/\/+$/, '')
  const baseURLs: Readonly<Record<AnywhereRouteApi, string>> = {
    'openai-completions': `${base}/v1`, 'anthropic-messages': base, 'google-generative-ai': `${base}/v1beta`,
  }
  const routes: Record<string, PiAiRoute> = {}
  for (const family of [...new Set(models.map(model => model.family))].sort(compareFamilies)) {
    const id = anywhereRouteId(family)
    const members = models.filter(model => model.enabled && model.route === id)
    const api = members[0]?.api
    if (api === undefined) continue
    const entries = members.map((model): PiAiRouteModel => {
      const known = own(KNOWN_THINKING, model.id)
      const levels = known?.levels ?? (isKnownFamily(model.family) ? FAMILY_THINKING[model.family] : undefined)
      const efforts = levels === undefined ? undefined : declaredThinking(levels, api)
      const compat: Record<string, string | boolean> = {
        ...(api === 'openai-completions' && isKnownFamily(model.family) ? CHAT_COMPAT[model.family] : undefined),
        ...known?.compat,
        ...(known?.adaptive ? { forceAdaptiveThinking: true } : {}),
        ...(known?.noTemperature ? { supportsTemperature: false } : {}),
      }
      return {
        id: model.id, name: model.name,
        ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
        ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
        input: model.vision ? ['text', 'image'] : ['text'],
        reasoningEfforts: efforts !== undefined && model.thinking.length > 0 ? efforts : false,
        ...(Object.keys(compat).length === 0 ? {} : { compat }),
      }
    })
    const common = commonThinkingLevel(entries)
    routes[id] = {
      displayName: family === 'other' ? 'Tokens Anywhere' : `Tokens Anywhere · ${anywhereFamilyName(family)}`,
      apiKeyEnv: ANYWHERE_API_KEY_REF, api, baseURL: baseURLs[api], ...(common === undefined ? {} : { reasoning: common }), models: entries,
    }
  }
  return routes
}

/** JSON with sorted keys: a settings round trip may reorder them. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => typeof item === 'object' && item !== null && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
    : item)
}

/**
 * What routes offer, as the model picker lists them.
 * @param routes - our routes as stored, however they were edited.
 */
export function offeredAnywhereModels(routes: Readonly<Record<string, Pick<PiAiRoute, 'models'>>>): AnywhereOfferedModel[] {
  return Object.entries(routes).flatMap(([route, { models }]) => models.map((model): AnywhereOfferedModel => {
    const efforts = model.reasoningEfforts ? Object.keys(model.reasoningEfforts) : []
    return {
      route, id: model.id, name: model.name || model.id,
      // A route row may list its levels in any order; the page offers them weakest first.
      thinking: THINKING_LEVELS.filter(level => efforts.includes(level) && efforts.some(item => item !== 'off')),
    }
  }))
}
