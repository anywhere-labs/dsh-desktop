/** Apply the launch choices Desktop offers for official bundle rows through the official configuration editor. */
import type { Context } from '@deepseek-ai/cordis'
import type { Entry } from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-connection'
import { LAUNCH_PRESETS_ROUTE, matchLaunchPreset, type LaunchPresetBundle, type LaunchPresetState } from '../launch-presets.ts'

/** The methods of the official `configEditor` service (`@deepseek-ai/dsh-config-editor`) this route uses. */
interface ConfigEditing {
  /** Active rows the Profile patch can address by id. */
  entries(): Entry[]
  /** Validate a row's next raw config, record it in the Profile patch and reconcile the row. */
  edit(entry: Entry, change: (current: Record<string, unknown>) => Record<string, unknown>): Promise<void>
}

const NO_STORE = { 'cache-control': 'no-store' }

/**
 * Serve the rows' current launch choices and apply a chosen one. A choice replaces only the row's `launchArgs`. The
 * editor validates the complete config, records it in the active Profile's patch, or drops the override when it
 * matches the bundle's own row, and restarts the row; a row that does not run cannot change.
 * @param ctx - Host context; the route exists while the connection and the configuration editor do.
 * @param bundle - the rows and their choices.
 */
export function installLaunchPresets(ctx: Context, bundle: LaunchPresetBundle): void {
  ctx.inject(['connection', 'configEditor'], inner => {
    const editor: ConfigEditing = inner.get('configEditor')
    const running = (rowId: string): Entry | undefined =>
      editor.entries().find(entry => entry.options.id === rowId && entry.fiber !== undefined)
    const states = (): LaunchPresetState[] => bundle.rows.map((row) => {
      const entry = running(row.id)
      return { row: row.id, active: entry !== undefined,
        preset: entry === undefined ? null : matchLaunchPreset(row, entry.options.config?.launchArgs)?.id ?? null,
        choices: row.presets.map(preset => preset.id) }
    })
    inner.connection.fetch.register({
      path: LAUNCH_PRESETS_ROUTE,
      methods: ['GET', 'POST'],
      requestBody: 'buffered',
      fetch: async (request: Request): Promise<Response> => {
        if (request.method === 'GET') return Response.json({ rows: states() }, { headers: NO_STORE })
        let body: unknown
        try {
          body = await request.json()
        } catch {
          return Response.json({ error: 'Invalid JSON body' }, { status: 400, headers: NO_STORE })
        }
        const choice = typeof body === 'object' && body !== null ? body as { row?: unknown; preset?: unknown } : {}
        const row = bundle.rows.find(item => item.id === choice.row)
        const preset = row?.presets.find(item => item.id === choice.preset)
        if (row === undefined || preset === undefined) {
          return Response.json({ error: 'Unknown row or launch choice' }, { status: 400, headers: NO_STORE })
        }
        const entry = running(row.id)
        if (entry === undefined) return Response.json({ error: 'inactive', rows: states() }, { status: 409, headers: NO_STORE })
        try {
          await editor.edit(entry, config => ({ ...config, launchArgs: [...preset.launchArgs] }))
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : String(error), rows: states() },
            { status: 409, headers: NO_STORE })
        }
        return Response.json({ rows: states() }, { headers: NO_STORE })
      },
    })
  })
}
