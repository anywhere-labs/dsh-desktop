/**
 * The Anywhere account's model routes (see ../account.ts): what Tokens Anywhere offers the key, written as
 * `llm-pi-ai` routes. By default the routes follow Tokens Anywhere's list, with the models the user switched off left
 * out and the ones they renamed under their new names. Someone who needs more turns custom configuration on and edits
 * the routes with the official model editor, on the account page or in Settings → Models; the routes are theirs then,
 * and reading the list no longer touches them. It knows nothing of how the key was obtained.
 */
import { createHash } from 'node:crypto'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import {
  ANYWHERE_ROUTE_IDS, RETIRED_ROUTE_IDS, anywhereRoutes, commonThinkingLevel, defaultThinkingLevel, offeredAnywhereModels,
  pickAnywhereDefaultModel, planAnywhereModels, stableJson,
  type AnywhereModelOverrides, type AnywhereModelView, type AnywhereOfferedModel, type AnywhereProblem, type PiAiRoute,
  type TokensModelProfile, type TokensPricedModel,
} from '../account.ts'
import { AnywhereError, anywhereProblem } from './tokens-client.ts'

const PI_AI_ENTRY = 'llm-pi-ai'
const MODELS_RECORD = credentialKey('tokens-anywhere', 'models')
/** Apart from the models record: signing out forgets how the routes were managed, not the user's switches and names. */
const OVERRIDES_RECORD = credentialKey('tokens-anywhere', 'model-overrides')
const REQUEST_TIMEOUT_MS = 20_000
const OUR_ROUTES: readonly string[] = [...Object.values(ANYWHERE_ROUTE_IDS), ...RETIRED_ROUTE_IDS]

export interface ModelSelection { provider: string; model: string; reasoningEffort?: string }

export interface DefaultModels {
  currentSelection(): ModelSelection
  saveSelection(next: ModelSelection): Promise<void>
}

/** What Tokens Anywhere says about the models, as read with one key. */
export interface CatalogInputs {
  readonly chat: readonly string[]
  readonly anthropic: readonly string[]
  readonly gemini: readonly string[]
  readonly priced: readonly TokensPricedModel[]
  readonly profiles: Readonly<Record<string, TokensModelProfile>>
}

/** How the routes are managed, kept across restarts. */
interface ModelsRecord {
  /** The routes are the user's to edit. */
  readonly custom: boolean
  /** Fingerprint of the routes as last written from the list; anything else in the Profile was edited by hand. */
  readonly written?: string
}

async function readJson(url: string, headers: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  let response: Response
  try {
    response = await fetch(url, { headers: { accept: 'application/json', ...headers }, redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) })
  } catch (error) {
    if (signal.aborted) throw error
    throw new AnywhereError('network')
  }
  if (!response.ok) throw new AnywhereError(response.status >= 500 ? 'server' : 'rejected', `HTTP ${response.status}`)
  return response.json() as Promise<unknown>
}

/**
 * Read what the key can call: `/v1/models` answers each client with its own models, so once as OpenAI (GPT, DeepSeek),
 * once as Anthropic (Claude) and once as Gemini; and the public price list for each model's provider, output cap and
 * profile.
 * @param origin - Tokens Anywhere; its gateway is under `/v1`.
 */
export async function readCatalogInputs(origin: string, apiKey: string, signal: AbortSignal): Promise<CatalogInputs> {
  const [chat, anthropic, gemini, pricing] = await Promise.all([
    readJson(`${origin}/v1/models`, { authorization: `Bearer ${apiKey}` }, signal),
    readJson(`${origin}/v1/models`, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal),
    readJson(`${origin}/v1/models`, { 'x-goog-api-key': apiKey }, signal),
    readJson(`${origin}/api/v1/pricing`, {}, signal),
  ]) as [{ data?: { id?: unknown }[] }, { data?: { id?: unknown }[] }, { data?: { id?: unknown }[] }, {
    groups?: { name?: unknown; models?: TokensPricedModel[] }[]; profiles?: Record<string, TokensModelProfile>
  }]
  const ids = (list: { data?: { id?: unknown }[] }) => (list?.data ?? []).flatMap(item => typeof item?.id === 'string' ? [item.id] : [])
  const group = pricing?.groups?.find(item => item.name === 'default') ?? pricing?.groups?.[0]
  return { chat: ids(chat), anthropic: ids(anthropic), gemini: ids(gemini), priced: group?.models ?? [], profiles: pricing?.profiles ?? {} }
}

function fingerprint(routes: unknown): string {
  return createHash('sha256').update(stableJson(routes)).digest('hex')
}

/** The list and the routes written from it; every change runs through the caller's queue. */
export class AnywhereModels {
  private inputs: CatalogInputs | undefined
  private origin: string | undefined
  private error: AnywhereProblem | undefined

  constructor(
    private readonly credentials: CredentialProvider,
    private readonly settings: SettingsForms,
    private readonly defaults: DefaultModels,
    /** The default model from before signing in, for when none of ours is left on offer. */
    private readonly previousDefault: () => Promise<ModelSelection | undefined>,
    /** Whether the routes are written into the Profile at all; off, ours are taken out and the list is only read. */
    readonly writes: () => boolean = () => true,
  ) {}

  /** Whether the list was read since the Host started. */
  get loaded(): boolean {
    return this.inputs !== undefined
  }

  private async record(): Promise<ModelsRecord> {
    const record = await this.credentials.readRecord(MODELS_RECORD)
    const payload = record?.kind === 'grant' ? record.payload as Partial<ModelsRecord> | undefined : undefined
    return { custom: payload?.custom === true, ...(typeof payload?.written === 'string' ? { written: payload.written } : {}) }
  }

  /** Change how the routes are managed; unchanged, the credentials file is left as it is. */
  private async saveRecord(change: Partial<ModelsRecord>): Promise<void> {
    const current = await this.record()
    const next: ModelsRecord = { ...current, ...change }
    if (next.custom === current.custom && next.written === current.written) return
    await this.credentials.modifyRecord(MODELS_RECORD, async () => ({ kind: 'grant', payload: next }))
  }

  private async overrides(): Promise<AnywhereModelOverrides> {
    const record = await this.credentials.readRecord(OVERRIDES_RECORD)
    const payload = record?.kind === 'grant' ? record.payload as Partial<AnywhereModelOverrides> | undefined : undefined
    return { hidden: payload?.hidden ?? [], names: payload?.names ?? {}, hiddenFamilies: payload?.hiddenFamilies ?? [] }
  }

  /** The list with the user's choices, which may leave nothing on offer. */
  private async catalog(): Promise<AnywhereModelView[] | undefined> {
    if (this.inputs === undefined) return undefined
    return planAnywhereModels({ ...this.inputs, overrides: await this.overrides() })
  }

  /** Whether the list has a model our routes can call, switched on or not. */
  listsModels(): boolean {
    return this.inputs !== undefined && planAnywhereModels(this.inputs).some(model => model.route !== undefined)
  }

  /** Our routes as the active Profile stores them, whoever wrote them last. */
  private storedRoutes(): Record<string, PiAiRoute> {
    const entry = this.settings.describe({ redactSecrets: true }).find(item => item.ns === PI_AI_ENTRY)
    const providers = ((entry?.user ?? entry?.value) as { providers?: Record<string, Partial<PiAiRoute>> } | undefined)?.providers ?? {}
    return Object.fromEntries(OUR_ROUTES.flatMap((id) => {
      const route = providers[id]
      return route === undefined ? [] : [[id, { ...route, models: Array.isArray(route.models) ? route.models : [] } as PiAiRoute]]
    }))
  }

  /** The routes Tokens Anywhere's list and the user's choices would write. */
  private async plannedRoutes(): Promise<Record<string, PiAiRoute> | undefined> {
    const models = await this.catalog()
    return models === undefined || this.origin === undefined ? undefined : anywhereRoutes(models, this.origin)
  }

  /** What the page shows: the list if it was read, what the routes offer, and who manages them. */
  async view(): Promise<{
    models?: AnywhereModelView[]; error?: AnywhereProblem; offered: AnywhereOfferedModel[]; custom: boolean; customEdited: boolean
  }> {
    const { custom } = await this.record()
    const stored = this.storedRoutes()
    const models = await this.catalog()
    const planned = await this.plannedRoutes()
    return {
      ...(models === undefined ? {} : { models }),
      ...(this.error === undefined ? {} : { error: this.error }),
      offered: offeredAnywhereModels(stored),
      custom,
      customEdited: custom && planned !== undefined && fingerprint(stored) !== fingerprint(planned),
    }
  }

  /**
   * Read the list with the key, and bring the routes in line with it.
   * @returns the routes as they now stand.
   */
  async load(origin: string, apiKey: string, signal: AbortSignal): Promise<Record<string, PiAiRoute>> {
    try {
      this.inputs = await readCatalogInputs(origin, apiKey, signal)
      this.origin = origin
      this.error = undefined
    } catch (error) {
      this.error = anywhereProblem(error)
      throw error
    }
    return this.follow()
  }

  /**
   * The routes follow the list unless they are the user's: custom configuration, or an edit found in the Profile, made
   * in Settings → Models, which turns custom configuration on instead of being overwritten.
   */
  private async follow(): Promise<Record<string, PiAiRoute>> {
    if (!this.writes()) return this.withdraw()
    const record = await this.record()
    const stored = this.storedRoutes()
    const present = Object.keys(stored).length > 0
    const edited = !record.custom && present && record.written !== undefined && fingerprint(stored) !== record.written
    if (edited) await this.saveRecord({ custom: true })
    if (present && (record.custom || edited)) {
      await this.reconcile()
      return this.storedRoutes()
    }
    return this.write()
  }

  /** Write the routes from the list; a list that has not changed writes nothing. */
  private async write(): Promise<Record<string, PiAiRoute>> {
    if (!this.writes()) return this.withdraw()
    const routes = await this.plannedRoutes()
    if (routes === undefined) throw new AnywhereError('no-catalog')
    await this.writeRoutes(routes)
    await this.saveRecord({ written: fingerprint(this.storedRoutes()) })
    await this.reconcile()
    return routes
  }

  /**
   * Replace our routes in the active Profile; the pi-ai entry registers and drops them live. A route already stored as
   * it would be written is left alone, so an unchanged list costs no settings write: no file lock, no recomposition.
   */
  private async writeRoutes(routes: Record<string, PiAiRoute>): Promise<void> {
    const present = this.storedRoutes()
    const ops: SettingsPathOp[] = OUR_ROUTES.flatMap((id): SettingsPathOp[] => {
      const route = routes[id]
      if (route === undefined) return present[id] !== undefined ? [{ op: 'unset', path: ['providers', id] }] : []
      const value: unknown = JSON.parse(JSON.stringify(route))
      return present[id] !== undefined && stableJson(present[id]) === stableJson(value) ? [] : [{ op: 'set', path: ['providers', id], value }]
    })
    if (ops.length > 0) await this.settings.mutate(PI_AI_ENTRY, ops)
  }

  /**
   * Keep edited routes working: a route's default thinking level must be one all its models offer, or their requests
   * fail, and the default model must still be on offer, at a level it has. With none of ours left on offer, the default
   * goes back to the one from before signing in.
   */
  private async reconcile(): Promise<void> {
    const ops = Object.entries(this.storedRoutes()).flatMap(([id, route]): SettingsPathOp[] => {
      const level = commonThinkingLevel(route.models)
      if (level === route.reasoning) return []
      return [level === undefined ? { op: 'unset', path: ['providers', id, 'reasoning'] } : { op: 'set', path: ['providers', id, 'reasoning'], value: level }]
    })
    if (ops.length > 0) await this.settings.mutate(PI_AI_ENTRY, ops)
    const selection = this.defaults.currentSelection()
    if (!isAnywhereRoute(selection.provider)) return
    const routes = this.storedRoutes()
    const offered = offeredAnywhereModels(routes)
    // The same model on another route of ours keeps the choice, as when the route DeepSeek and GPT shared split by vendor.
    const model = offered.find(item => item.route === selection.provider && item.id === selection.model)
      ?? offered.find(item => item.id === selection.model)
    if (model === undefined) {
      const pick = pickAnywhereDefaultModel(routes) ?? await this.previousDefault()
      if (pick !== undefined) await this.defaults.saveSelection(pick)
      return
    }
    const { reasoningEffort, ...rest } = selection
    const level = reasoningEffort === undefined || model.thinking.includes(reasoningEffort) ? reasoningEffort : defaultThinkingLevel(model.thinking)
    if (model.route !== selection.provider || level !== reasoningEffort) {
      await this.defaults.saveSelection({ ...rest, provider: model.route, ...(level === undefined ? {} : { reasoningEffort: level }) })
    }
  }

  /** Take our routes, custom ones included, out of the Profile; a default model of ours goes back to the one before. */
  private async withdraw(): Promise<Record<string, PiAiRoute>> {
    await this.writeRoutes({})
    await this.reconcile()
    return {}
  }

  /** Bring the routes in line with whether they are written: out of the Profile, or back from the list read last. */
  async apply(): Promise<void> {
    if (!this.writes()) await this.withdraw()
    else if (this.inputs !== undefined) await this.follow()
  }

  /** Remove our routes and forget the list and how they were managed. */
  async clear(): Promise<void> {
    await this.writeRoutes({})
    await this.credentials.deleteRecord(MODELS_RECORD)
    this.inputs = undefined
    this.origin = undefined
    this.error = undefined
  }

  /**
   * Switch one model on or off in the model picker, or rename it; an empty name goes back to Tokens Anywhere's. Or
   * switch a whole family: off, it keeps the models Tokens Anywhere adds to it later off too; on, all of it comes on.
   * Everything may go off: the account stays signed in, and our routes go until a model comes back on.
   */
  async change(change: { id?: unknown; family?: unknown; enabled?: unknown; name?: unknown }): Promise<void> {
    if (this.inputs === undefined) throw new AnywhereError('no-catalog')
    const current = await this.overrides()
    const listed = planAnywhereModels({ ...this.inputs, overrides: current })
    const hidden = new Set(current.hidden)
    const families = new Set(current.hiddenFamilies)
    const names = { ...current.names }
    if (typeof change.family === 'string') {
      const family = change.family
      const members = listed.filter(model => model.family === family)
      if (members.length === 0 || typeof change.enabled !== 'boolean') throw new AnywhereError('unknown-model')
      for (const model of members) hidden.delete(model.id)
      if (change.enabled) families.delete(family)
      else families.add(family)
    } else {
      const model = listed.find(item => item.id === change.id)
      if (model === undefined) throw new AnywhereError('unknown-model')
      if (change.enabled === false) hidden.add(model.id)
      if (change.enabled === true) {
        // Back on in a family that is off: the family's own switch goes, and the rest of it stays off model by model.
        if (families.delete(model.family)) {
          for (const other of listed) if (other.family === model.family) hidden.add(other.id)
        }
        hidden.delete(model.id)
      }
      if (typeof change.name === 'string') {
        const name = change.name.trim().slice(0, 80)
        if (name === '') delete names[model.id]
        else names[model.id] = name
      }
    }
    const next: AnywhereModelOverrides = {
      hidden: [...hidden].sort(), names, ...(families.size === 0 ? {} : { hiddenFamilies: [...families].sort() }),
    }
    await this.credentials.modifyRecord(OVERRIDES_RECORD, async () => ({ kind: 'grant', payload: next }))
    await this.follow()
  }

  /** Forget the user's switches and names. */
  async reset(): Promise<void> {
    if (this.inputs === undefined) throw new AnywhereError('no-catalog')
    await this.credentials.deleteRecord(OVERRIDES_RECORD)
    await this.follow()
  }

  /**
   * Turn custom configuration on or off. Turned off, the routes go back to Tokens Anywhere's list and edits are lost.
   * Calling it with on after a save settles what the saved routes changed.
   */
  async setCustom(change: { enabled?: unknown }): Promise<void> {
    const enabled = change.enabled === true
    if (!enabled && this.inputs === undefined) throw new AnywhereError('no-catalog')
    await this.saveRecord({ custom: enabled })
    if (enabled) await this.reconcile()
    else await this.write()
  }
}

/** Whether a provider route is one of ours. */
export function isAnywhereRoute(provider: string): boolean {
  return OUR_ROUTES.includes(provider)
}
