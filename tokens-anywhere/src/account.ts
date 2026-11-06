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
  /** POST `{ enabled }`: whether the routes are the user's to edit, with the official model editor. */
  custom: '/api/tokens-anywhere/custom',
  /** GET with `days` (7 or 30): the account's usage by day and model, which the page sums up. */
  usage: '/api/tokens-anywhere/usage',
  /** GET reads where the page shows besides Settings; POST `{ sidebar?, conversation? }` changes it. */
  placement: '/api/tokens-anywhere/placement',
  /** POST `{ storeKey?, writeModels? }`: what the account writes into DSH's local files. */
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
 * (dsh-desktop#1583); Tokens Anywhere serves Claude only through Anthropic Messages and Gemini only through its own API.
 * Models of a vendor the price list does not name share Chat Completions under the plain id. `llm-pi-ai` takes Gemini's
 * protocol on a hand-declared route through DSH Next's patches/dsh-llm-pi-ai@0.2.1-rc.5.patch, and pi-ai 1.1.0 sends
 * Gemini 4 models the thinking level they require, not a thinking budget, through its patches/pi-ai@1.1.0.patch.
 */
export const ANYWHERE_ROUTE_IDS = {
  deepseek: 'tokens-anywhere-deepseek',
  claude: 'tokens-anywhere-claude',
  gpt: 'tokens-anywhere-gpt',
  gemini: 'tokens-anywhere-gemini',
  other: 'tokens-anywhere',
} as const satisfies Record<AnywhereModelFamily, string>
/** Routes an earlier build wrote, removed whenever the routes are rewritten. */
export const RETIRED_ROUTE_IDS: readonly string[] = ['tokens-anywhere-openai']
export const ANYWHERE_API_KEY_REF = 'TOKENS_ANYWHERE_API_KEY'

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

/** Model families as the page groups them, in display order. */
export type AnywhereModelFamily = 'deepseek' | 'claude' | 'gpt' | 'gemini' | 'other'
export const ANYWHERE_MODEL_FAMILIES: readonly AnywhereModelFamily[] = ['deepseek', 'claude', 'gpt', 'gemini', 'other']

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
    readonly available: string
    readonly held: string
    readonly checkedAt: string
  }
  /** Why the balance could not be read, while the account stays signed in. */
  readonly balanceError?: AnywhereProblem
  /** Every model Tokens Anywhere offers the key, absent until it was read once since the Host started. */
  readonly models?: readonly AnywhereModelView[]
  /** Why the model list could not be read. */
  readonly modelsError?: AnywhereProblem
  /** What the routes offer now, as the model picker lists them. */
  readonly offered?: readonly AnywhereOfferedModel[]
  /** The routes are the user's, edited with the official model editor; Tokens Anywhere's list no longer changes them. */
  readonly custom?: boolean
  /** Custom routes differ from what Tokens Anywhere's list would write, so leaving custom configuration loses something. */
  readonly customEdited?: boolean
  /** Why the account signed itself out, until the next sign-in. */
  readonly notice?: AnywhereProblem
  readonly local: AnywhereLocalState
}

/** Usage ranges the page offers, in days. */
export type AnywhereUsageRange = 7 | 30

export interface AnywhereUsageTotals {
  readonly requests: number
  readonly inputTokens: number
  readonly outputTokens: number
  /** Cache reads and writes. */
  readonly cacheTokens: number
  /** Charged, in yuan with four decimals. */
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

/** Ten-thousandths of a yuan, so sums stay exact. */
function amountUnits(value: string): number {
  const match = /^(-)?(\d+)(?:\.(\d{1,4}))?$/u.exec(value.trim())
  if (match === null) return 0
  const units = Number(match[2]) * 10_000 + Number((match[3] ?? '').padEnd(4, '0'))
  return match[1] === undefined ? units : -units
}

function formatUnits(units: number): string {
  const sign = units < 0 ? '-' : ''
  const absolute = Math.abs(units)
  return `${sign}${Math.floor(absolute / 10_000)}.${String(absolute % 10_000).padStart(4, '0')}`
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
    sum.units += amountUnits(row.amountCharged)
  }
  const done = ({ units, ...rest }: Sum): AnywhereUsageTotals => ({ ...rest, amount: formatUnits(units) })
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
    spent.set(model, (spent.get(model) ?? 0) + amountUnits(row.amountCharged))
    add(total, row)
    const sum = byModel.get(model) ?? empty()
    add(sum, row)
    byModel.set(model, sum)
  }
  return {
    days, from: dates[0] ?? '', to: dates[dates.length - 1] ?? '', totals: done(total),
    daily: dates.map(date => ({
      date, ...done(byDate.get(date)!),
      byModel: Object.fromEntries([...byDateModel.get(date)!].map(([model, units]) => [model, formatUnits(units)])),
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

/**
 * Thinking of the models Tokens Anywhere serves, copied from pi-ai's catalog (DSH 0.2.1-rc.5) for the same model ids:
 * the level map and the switches that change how a level is sent. Our routes are not pi-ai catalog providers, so
 * nothing would fill these in. A model missing here gets its family's default below.
 */
const KNOWN_THINKING: Readonly<Record<string, { levels: CatalogThinking; adaptive?: true; noTemperature?: true }>> = {
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
}

/** Family defaults for a model pi-ai's catalog does not describe yet. */
const FAMILY_THINKING: Readonly<Partial<Record<AnywhereModelFamily, CatalogThinking>>> = {
  gpt: { off: 'none', minimal: null },
  deepseek: { minimal: null, low: null, medium: null, high: 'high', max: 'max' },
  claude: {},
  gemini: GEMINI_CORE_LEVELS,
}

/** DeepSeek through Chat Completions, as pi-ai's catalog sends it: thinking in its own format, kept across turns. */
const DEEPSEEK_COMPAT = {
  supportsStore: false, supportsDeveloperRole: false, maxTokensField: 'max_tokens',
  requiresReasoningContentOnAssistantMessages: true, thinkingFormat: 'deepseek',
} as const

/**
 * The levels a DSH profile declares for a catalog thinking map. In pi-ai's catalog a level left out keeps its default
 * wire value and only `xhigh` and `max` must be named; a DSH profile offers exactly the levels it declares. So a
 * missing `off` becomes "off, send nothing", missing standard levels are declared under their own names (Claude takes
 * them as efforts, Chat Completions as `reasoning_effort`), and `minimal`, which Claude has no effort for, is dropped.
 */
function declaredThinking(levels: CatalogThinking, family: AnywhereModelFamily): Partial<Record<ThinkingLevel, string | null>> {
  const declared: Partial<Record<ThinkingLevel, string | null>> = {}
  for (const level of THINKING_LEVELS) {
    const wire = levels[level]
    if (wire === null) continue
    if (typeof wire === 'string') { declared[level] = wire; continue }
    if (level === 'off') declared.off = null
    else if (level === 'xhigh' || level === 'max' || (level === 'minimal' && family === 'claude')) continue
    else declared[level] = level
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
  readonly api: 'anthropic-messages' | 'google-generative-ai' | 'openai-completions'
  readonly baseURL: string
  /** Thinking level a session uses until it picks one; every model on the route offers it. */
  readonly reasoning?: string
  readonly models: readonly PiAiRouteModel[]
}

/** A model's family, from Tokens Anywhere's provider, else its id. */
export function anywhereModelFamily(provider: string | undefined, id: string): AnywhereModelFamily {
  if (provider === 'anthropic' || id.startsWith('claude-')) return 'claude'
  if (provider === 'deepseek' || id.startsWith('deepseek-')) return 'deepseek'
  if (provider === 'gemini' || id.startsWith('gemini-')) return 'gemini'
  if (provider === 'openai') return 'gpt'
  return 'other'
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
 * the thinking levels each model offers. A model reaches a route only through the protocol Tokens Anywhere serves it
 * with: Claude through Anthropic Messages, Gemini through its own API, GPT and DeepSeek through Chat Completions.
 * @param input.chat - ids `GET /v1/models` lists in OpenAI form; input.anthropic - ids it lists in Anthropic form;
 * input.gemini - ids it lists to a Gemini client.
 */
export function planAnywhereModels(input: {
  readonly chat: readonly string[]
  readonly anthropic: readonly string[]
  readonly gemini: readonly string[]
  readonly priced: readonly TokensPricedModel[]
  readonly profiles: Readonly<Record<string, TokensModelProfile>>
  readonly overrides?: AnywhereModelOverrides
}): AnywhereModelView[] {
  const priced = new Map(input.priced.map(item => [item.model, item]))
  const ids = new Set([...input.chat, ...input.anthropic, ...input.gemini])
  const hidden = new Set(input.overrides?.hidden)
  const hiddenFamilies = new Set(input.overrides?.hiddenFamilies)
  const order = (family: AnywhereModelFamily) => ANYWHERE_MODEL_FAMILIES.indexOf(family)
  return [...ids].map((id): AnywhereModelView => {
    const family = anywhereModelFamily(priced.get(id)?.provider, id)
    // Claude and Gemini only through their own protocols, every other vendor through Chat Completions.
    const listed = family === 'claude' ? input.anthropic.includes(id) : family === 'gemini' ? input.gemini.includes(id) : input.chat.includes(id)
    const route = listed ? ANYWHERE_ROUTE_IDS[family] : undefined
    const profile = input.profiles[id]
    const defaultName = profile?.displayName || id
    const contextWindow = typeof profile?.contextWindow === 'number' ? profile.contextWindow : undefined
    const maxTokens = priced.get(id)?.maxOutputTokens ?? undefined
    const levels = KNOWN_THINKING[id]?.levels ?? FAMILY_THINKING[family]
    const declared = levels === undefined ? [] : Object.keys(declaredThinking(levels, family))
    // A model offering nothing but `off` does not think.
    const thinking = declared.some(level => level !== 'off') ? declared : []
    return {
      id, name: input.overrides?.names[id] || defaultName, defaultName, family,
      ...(route === undefined ? {} : { route }),
      enabled: route !== undefined && !hidden.has(id) && !hiddenFamilies.has(family),
      ...(contextWindow === undefined ? {} : { contextWindow }),
      ...(typeof maxTokens === 'number' ? { maxTokens } : {}),
      vision: profile?.capabilities?.includes('vision') === true,
      thinking,
    }
  }).sort((a, b) => order(a.family) - order(b.family) || a.id.localeCompare(b.id))
}

/**
 * The `llm-pi-ai` routes for the enabled models. Each model carries its thinking levels and the switches that send
 * them; a route's default level is the strongest common one every model on it offers, so new sessions think.
 * @param origin - the Tokens Anywhere origin; Chat Completions lives under `/v1`, Gemini's API under `/v1beta`.
 */
export function anywhereRoutes(models: readonly AnywhereModelView[], origin: string): Record<string, PiAiRoute> {
  const base = origin.replace(/\/+$/, '')
  const routes: Record<string, PiAiRoute> = {}
  for (const [id, api, baseURL, displayName] of [
    [ANYWHERE_ROUTE_IDS.deepseek, 'openai-completions', `${base}/v1`, 'Tokens Anywhere · DeepSeek'],
    [ANYWHERE_ROUTE_IDS.claude, 'anthropic-messages', base, 'Tokens Anywhere · Claude'],
    [ANYWHERE_ROUTE_IDS.gpt, 'openai-completions', `${base}/v1`, 'Tokens Anywhere · GPT'],
    [ANYWHERE_ROUTE_IDS.gemini, 'google-generative-ai', `${base}/v1beta`, 'Tokens Anywhere · Gemini'],
    [ANYWHERE_ROUTE_IDS.other, 'openai-completions', `${base}/v1`, 'Tokens Anywhere'],
  ] as const) {
    const entries = models.filter(model => model.enabled && model.route === id).map((model): PiAiRouteModel => {
      const known = KNOWN_THINKING[model.id]
      const levels = known?.levels ?? FAMILY_THINKING[model.family]
      const efforts = levels === undefined ? undefined : declaredThinking(levels, model.family)
      const compat: Record<string, string | boolean> = {
        ...(model.family === 'deepseek' ? DEEPSEEK_COMPAT : {}),
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
    if (entries.length === 0) continue
    const common = commonThinkingLevel(entries)
    routes[id] = { displayName, apiKeyEnv: ANYWHERE_API_KEY_REF, api, baseURL, ...(common === undefined ? {} : { reasoning: common }), models: entries }
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
