/**
 * The Anywhere account's model routes (see ../account.ts): what Tokens Anywhere offers the key, written as
 * `llm-pi-ai` routes. By default the routes follow Tokens Anywhere's list, with the models the user switched off left
 * out and the ones they renamed under their new names. Someone who needs more edits the routes in Settings → Models,
 * the official model settings, which the account page opens. An edit there is never overwritten: renaming or removing
 * the list's models there becomes the list's own names and switches, and any other edit makes the routes theirs
 * (custom configuration), which reading the list no longer touches until the page puts the list's back. It knows
 * nothing of how the key was obtained.
 */
import { createHash } from 'node:crypto'
import { credentialKey, type CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsForms, SettingsPathOp } from '@deepseek-ai/dsh-settings'
import {
  anywhereRoutes, commonThinkingLevel, defaultPricedModels, isAnywhereRoute, listedEndpointTypes, nonChatModelIds,
  offeredAnywhereModels, planAnywhereModels, stableJson,
  type AnywhereModelOverrides, type AnywhereModelView, type AnywhereOfferedModel, type AnywhereProblem, type PiAiRoute,
  type TokensListedModel, type TokensModelProfile, type TokensPricedModel,
} from '../account.ts'
import { AnywhereError, anywhereProblem } from './tokens-client.ts'

/** The settings namespace our routes live in, which Settings → Models edits too. */
export const PI_AI_ENTRY = 'llm-pi-ai'
const MODELS_RECORD = credentialKey('tokens-anywhere', 'models')
/** Apart from the models record: signing out forgets how the routes were managed, not the user's switches and names. */
const OVERRIDES_RECORD = credentialKey('tokens-anywhere', 'model-overrides')
const REQUEST_TIMEOUT_MS = 20_000
/** How often one follow reads the routes again after an edit landed between its read and its write. */
const MAX_CONFLICTS = 3

/**
 * What Tokens Anywhere says about the models, as read with one key; models that hold no conversation, as video and
 * embeddings models, are left out.
 */
export interface CatalogInputs {
  /** Ids reached through Chat Completions. */
  readonly chat: readonly string[]
  /** Ids reached through Anthropic Messages. */
  readonly anthropic: readonly string[]
  /** Ids reached through Gemini's own API. */
  readonly gemini: readonly string[]
  readonly priced: readonly TokensPricedModel[]
  readonly profiles: Readonly<Record<string, TokensModelProfile>>
  /** The provider the list names for each model. */
  readonly owners: Readonly<Record<string, string>>
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

/** The models of a `GET /v1/models` answer. */
function listedModels(list: unknown): TokensListedModel[] {
  const data = (list as { data?: unknown } | undefined)?.data
  return Array.isArray(data) ? data.filter((item): item is TokensListedModel => typeof item === 'object' && item !== null) : []
}

/**
 * Read what the key can call. `/v1/models?protocol=any` lists every model the key can call, whatever format it speaks,
 * with its provider and the endpoints that reach it: Chat Completions, Anthropic Messages and Gemini's own API each
 * route the models they reach, and a model none reaches, as a video or embeddings model, is left out. The public
 * price list gives each model's provider, output cap and profile, and its video models are left out too. A release
 * that lists no endpoints answers every client with its own format's models, so there the list is read once as
 * OpenAI (GPT, DeepSeek, GLM, Kimi, Grok), once as Anthropic (Claude, MiniMax) and once as Gemini.
 * @param origin - Tokens Anywhere; its gateway is under `/v1`.
 */
export async function readCatalogInputs(origin: string, apiKey: string, signal: AbortSignal): Promise<CatalogInputs> {
  const [all, pricing] = await Promise.all([
    readJson(`${origin}/v1/models?protocol=any`, { authorization: `Bearer ${apiKey}` }, signal),
    readJson(`${origin}/api/v1/pricing`, {}, signal),
  ])
  const priced = defaultPricedModels(pricing) ?? []
  const profiles = (pricing as { profiles?: Record<string, TokensModelProfile> } | undefined)?.profiles ?? {}
  const listed = listedModels(all)
  const left = nonChatModelIds(listed, priced)
  const owners = Object.fromEntries(listed.flatMap(item => typeof item.id === 'string' && typeof item.owned_by === 'string' ? [[item.id, item.owned_by]] : []))
  const kept = (models: readonly TokensListedModel[], endpoint?: string): string[] => models.flatMap(item =>
    typeof item.id === 'string' && !left.has(item.id) && (endpoint === undefined || listedEndpointTypes(item)?.includes(endpoint) === true) ? [item.id] : [])
  if (listed.length === 0 || listed.some(item => listedEndpointTypes(item) !== undefined)) {
    return { chat: kept(listed, 'chat_completions'), anthropic: kept(listed, 'messages'), gemini: kept(listed, 'generate_content'), priced, profiles, owners }
  }
  // An earlier release answered in OpenAI's form: read the other two formats' lists as well.
  const [anthropic, gemini] = await Promise.all([
    readJson(`${origin}/v1/models`, { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' }, signal),
    readJson(`${origin}/v1/models`, { 'x-goog-api-key': apiKey }, signal),
  ])
  return { chat: kept(listed), anthropic: kept(listedModels(anthropic)), gemini: kept(listedModels(gemini)), priced, profiles, owners }
}

function fingerprint(routes: unknown): string {
  return createHash('sha256').update(stableJson(routes)).digest('hex')
}

/** A write the settings refused because the routes changed since they were read. */
function isConflict(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'SETTINGS_CONFLICT'
}

/** Routes as the Profile keeps them, without each one's default thinking level, which follows its models. */
function withoutLevels(routes: Readonly<Record<string, PiAiRoute>>): unknown {
  return Object.fromEntries(Object.entries(routes).map(([id, route]) => {
    const { reasoning: _level, ...rest } = JSON.parse(JSON.stringify({ ...route, models: Array.isArray(route.models) ? route.models : [] })) as PiAiRoute
    return [id, rest]
  }))
}

/** The list and the routes written from it; every change runs through the caller's queue. */
export class AnywhereModels {
  private inputs: CatalogInputs | undefined
  private origin: string | undefined
  private error: AnywhereProblem | undefined

  constructor(
    private readonly credentials: CredentialProvider,
    private readonly settings: SettingsForms,
    /** Whether the routes are written into the Profile at all; off, ours are taken out and the list is only read. */
    readonly writes: () => boolean = () => true,
    /** Whether the Gemini route speaks Google's Gemini API rather than Chat Completions. */
    private readonly geminiNative: () => boolean = () => false,
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

  private async saveOverrides(next: AnywhereModelOverrides): Promise<void> {
    const families = next.hiddenFamilies ?? []
    const payload: AnywhereModelOverrides = {
      hidden: [...next.hidden].sort(), names: next.names, ...(families.length === 0 ? {} : { hiddenFamilies: [...families].sort() }),
    }
    await this.credentials.modifyRecord(OVERRIDES_RECORD, async () => ({ kind: 'grant', payload }))
  }

  /** The list with the user's choices, which may leave nothing on offer. */
  private async catalog(): Promise<AnywhereModelView[] | undefined> {
    if (this.inputs === undefined) return undefined
    return planAnywhereModels({ ...this.inputs, overrides: await this.overrides(), geminiNative: this.geminiNative() })
  }

  /** Whether the list has a model our routes can call, switched on or not. */
  listsModels(): boolean {
    return this.inputs !== undefined && planAnywhereModels({ ...this.inputs, geminiNative: this.geminiNative() }).some(model => model.route !== undefined)
  }

  /** Our routes as the active Profile stores them, whoever wrote them last, and the revision they were read at. */
  private storedView(): { routes: Record<string, PiAiRoute>; revision: number | undefined } {
    const entry = this.settings.describe({ redactSecrets: true }).find(item => item.ns === PI_AI_ENTRY)
    const providers = ((entry?.user ?? entry?.value) as { providers?: Record<string, Partial<PiAiRoute>> } | undefined)?.providers ?? {}
    const routes = Object.fromEntries(Object.entries(providers).flatMap(([id, route]) => route === undefined || route === null || !isAnywhereRoute(id, route)
      ? []
      : [[id, { ...route, models: Array.isArray(route.models) ? route.models : [] } as PiAiRoute]]))
    return { routes, revision: typeof entry?.revision === 'number' ? entry.revision : undefined }
  }

  private storedRoutes(): Record<string, PiAiRoute> {
    return this.storedView().routes
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
   * The routes follow the list unless they are the user's. An edit found in the Profile, made in Settings → Models, is
   * never overwritten: renames and removals of the list's models become its own names and switches, and any other edit
   * turns custom configuration on. Writes name the revision they were decided at, so an edit that lands in between is
   * read again rather than overwritten.
   */
  private async follow(attempt = 0): Promise<Record<string, PiAiRoute>> {
    if (!this.writes()) return this.withdraw()
    const record = await this.record()
    const { routes: stored, revision } = this.storedView()
    let custom = record.custom
    if (!custom && record.written !== undefined && fingerprint(stored) !== record.written) {
      const absorbed = await this.absorbed(stored)
      if (absorbed !== undefined) await this.saveOverrides(absorbed)
      else {
        await this.saveRecord({ custom: true })
        custom = true
      }
    }
    try {
      if (custom && Object.keys(stored).length > 0) {
        await this.reconcile()
        return this.storedRoutes()
      }
      return await this.write(revision)
    } catch (error) {
      if (!isConflict(error) || attempt + 1 >= MAX_CONFLICTS) throw error
      return this.follow(attempt + 1)
    }
  }

  /**
   * The names and switches that make the list write the routes as edited in Settings → Models, when the edits only
   * rename or remove the list's models, whole routes included; undefined for any other edit.
   */
  private async absorbed(stored: Record<string, PiAiRoute>): Promise<AnywhereModelOverrides | undefined> {
    if (this.inputs === undefined || this.origin === undefined) return undefined
    const geminiNative = this.geminiNative()
    const current = await this.overrides()
    const listed = new Map(planAnywhereModels({ ...this.inputs, geminiNative }).map(model => [model.id, model]))
    const planned = anywhereRoutes(planAnywhereModels({ ...this.inputs, overrides: current, geminiNative }), this.origin)
    const hidden = new Set(current.hidden)
    const names: Record<string, string> = { ...current.names }
    for (const id of new Set([...Object.keys(planned), ...Object.keys(stored)])) {
      const kept = stored[id]?.models ?? []
      for (const model of kept) {
        const known = listed.get(model.id)
        if (known === undefined || typeof model.name !== 'string' || model.name === '') return undefined
        hidden.delete(model.id)
        if (model.name === known.defaultName) delete names[model.id]
        else names[model.id] = model.name
      }
      const keptIds = new Set(kept.map(model => model.id))
      for (const model of planned[id]?.models ?? []) if (!keptIds.has(model.id)) hidden.add(model.id)
    }
    const next: AnywhereModelOverrides = { hidden: [...hidden].sort(), names, hiddenFamilies: current.hiddenFamilies ?? [] }
    // Only what the list can say: with these choices it writes the routes as they now are, each one's default level aside.
    const rewritten = anywhereRoutes(planAnywhereModels({ ...this.inputs, overrides: next, geminiNative }), this.origin)
    return stableJson(withoutLevels(rewritten)) === stableJson(withoutLevels(stored)) ? next : undefined
  }

  /** Write the routes from the list; a list that has not changed writes nothing. */
  private async write(revision?: number): Promise<Record<string, PiAiRoute>> {
    if (!this.writes()) return this.withdraw()
    const routes = await this.plannedRoutes()
    if (routes === undefined) throw new AnywhereError('no-catalog')
    await this.writeRoutes(routes, revision)
    await this.saveRecord({ written: fingerprint(this.storedRoutes()) })
    await this.reconcile()
    return routes
  }

  /**
   * Replace our routes in the active Profile; the pi-ai entry registers and drops them live. A route already stored as
   * it would be written is left alone, so an unchanged list costs no settings write: no file lock, no recomposition.
   * @param revision - the revision the decision to write was read at; the write is refused if the routes moved since.
   */
  private async writeRoutes(routes: Record<string, PiAiRoute>, revision?: number): Promise<void> {
    const present = this.storedRoutes()
    const ops: SettingsPathOp[] = [...new Set([...Object.keys(routes), ...Object.keys(present)])].flatMap((id): SettingsPathOp[] => {
      const route = routes[id]
      if (route === undefined) return present[id] !== undefined ? [{ op: 'unset', path: ['providers', id] }] : []
      const value: unknown = JSON.parse(JSON.stringify(route))
      return present[id] !== undefined && stableJson(present[id]) === stableJson(value) ? [] : [{ op: 'set', path: ['providers', id], value }]
    })
    if (ops.length > 0) await this.settings.mutate(PI_AI_ENTRY, ops, revision)
  }

  /** Keep edited routes working: a route's default thinking level must be one all its models offer, or their requests fail. */
  private async reconcile(): Promise<void> {
    const { routes, revision } = this.storedView()
    const ops = Object.entries(routes).flatMap(([id, route]): SettingsPathOp[] => {
      const level = commonThinkingLevel(route.models)
      if (level === route.reasoning) return []
      return [level === undefined ? { op: 'unset', path: ['providers', id, 'reasoning'] } : { op: 'set', path: ['providers', id, 'reasoning'], value: level }]
    })
    if (ops.length > 0) await this.settings.mutate(PI_AI_ENTRY, ops, revision)
  }

  /** Take our routes, custom ones included, out of the Profile; that they are gone is then no edit of the user's. */
  private async withdraw(): Promise<Record<string, PiAiRoute>> {
    await this.writeRoutes({})
    if (await this.credentials.readRecord(MODELS_RECORD) !== undefined) await this.saveRecord({ written: fingerprint({}) })
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
    const listed = planAnywhereModels({ ...this.inputs, overrides: current, geminiNative: this.geminiNative() })
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
    const next: AnywhereModelOverrides = { hidden: [...hidden], names, hiddenFamilies: [...families] }
    await this.saveOverrides(next)
    await this.follow()
  }

  /** Forget the user's switches and names. */
  async reset(): Promise<void> {
    if (this.inputs === undefined) throw new AnywhereError('no-catalog')
    await this.credentials.deleteRecord(OVERRIDES_RECORD)
    await this.follow()
  }

  /**
   * Turn custom configuration on or off. Turned off, the routes go back to Tokens Anywhere's list and edits are lost;
   * the account page only turns it off, since an edit in Settings → Models that the list cannot express turns it on.
   */
  async setCustom(change: { enabled?: unknown }): Promise<void> {
    const enabled = change.enabled === true
    if (!enabled && this.inputs === undefined) throw new AnywhereError('no-catalog')
    await this.saveRecord({ custom: enabled })
    if (enabled) await this.reconcile()
    else await this.write()
  }
}
