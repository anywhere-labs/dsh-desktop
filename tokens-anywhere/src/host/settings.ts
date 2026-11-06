/**
 * The plugin's own volatile configuration: where the account page shows besides Settings, and what the account writes
 * into DSH's local files. Read live and saved through the configuration editor into the active Profile's patch, as the
 * official default model selection is; a change never reloads the plugin, so a sign-in in progress carries on.
 */
import type { Context, Volatile } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-config-editor'
import { ANYWHERE_ACCOUNT_ROUTES, type AnywherePlacementState } from '../account.ts'
import { AnywhereError, anywhereProblem } from './tokens-client.ts'

const NO_STORE = { 'cache-control': 'no-store' }

/** The plugin's Config references. */
export interface SettingsConfig {
  readonly sidebar: Volatile<boolean>
  readonly conversation: Volatile<boolean>
  readonly storeKey: Volatile<boolean>
  readonly writeModels: Volatile<boolean>
  readonly geminiNative: Volatile<boolean>
}

export type SettingName = keyof SettingsConfig

export class AnywhereSettings {
  private saves: Promise<unknown> = Promise.resolve()

  /**
   * @param owner - the plugin's own context, whose Loader entry the configuration belongs to.
   * @param config - its Config references.
   */
  constructor(private readonly owner: Context, private readonly config: SettingsConfig) {}

  get(name: SettingName): boolean {
    return this.config[name].get()
  }

  /** Whether a configuration editor can save a change. */
  get writable(): boolean {
    return this.owner.fiber.entry !== undefined && this.owner.get('configEditor') !== undefined
  }

  placement(): AnywherePlacementState {
    return { sidebar: this.get('sidebar'), conversation: this.get('conversation'), writable: this.writable }
  }

  /** Save a change; saves commit in the order they came. */
  async save(change: Partial<Record<SettingName, boolean>>): Promise<void> {
    const entry = this.owner.fiber.entry
    const editor = this.owner.get('configEditor')
    if (entry === undefined || editor === undefined) throw new AnywhereError('failed')
    const saved = this.saves.then(() => editor.edit(entry, current => ({ ...current, ...change })))
    this.saves = saved.catch(() => {})
    await saved
  }
}

/**
 * Mount the placement route while the connection is up.
 * @param ctx - the plugin's context.
 * @param settings - the configuration the route reads and saves.
 */
export function installAnywherePlacement(ctx: Context, settings: AnywhereSettings): void {
  ctx.inject(['connection'], (inner) => {
    inner.connection.fetch.register({
      path: ANYWHERE_ACCOUNT_ROUTES.placement, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: async (request: Request) => {
        try {
          if (request.method !== 'POST') return Response.json({ result: settings.placement() }, { headers: NO_STORE })
          const parsed: unknown = JSON.parse((await request.text()) || '{}')
          const body = typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : {}
          await settings.save({
            ...(typeof body.sidebar === 'boolean' ? { sidebar: body.sidebar } : {}),
            ...(typeof body.conversation === 'boolean' ? { conversation: body.conversation } : {}),
          })
          return Response.json({ result: settings.placement() }, { headers: NO_STORE })
        } catch (error) {
          if (!(error instanceof AnywhereError) && !(error instanceof SyntaxError)) console.error('[tokens-anywhere] Placement change failed', error)
          return Response.json({ error: anywhereProblem(error), result: settings.placement() }, { status: 409, headers: NO_STORE })
        }
      },
    })
  })
}
