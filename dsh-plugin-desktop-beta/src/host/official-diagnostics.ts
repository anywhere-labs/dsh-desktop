/** Desktop records metadata from public official readers; it owns no inspection model. */
import type { Context } from '@deepseek-ai/cordis'
import { readPluginInventory, type PluginInventoryEntry } from '@deepseek-ai/dsh-host-plugin-inventory'
import type {} from '@deepseek-ai/dsh-experimental-inspector'
import type { LogInput } from '../log-record.ts'

type RecordDiagnostic = (input: LogInput) => void
const active = (ctx: Context): boolean => ctx.fiber?.state !== 4 && ctx.fiber?.state !== 5

/**
 * The official inventory's entries (effective enablement, named lifecycle phase and a failed entry's diagnostic),
 * without the parts the Desktop's records never use. `readPluginInventory` adds each plugin's display metadata when
 * the context provides `pluginPackages`, and preset compositions when it provides `agentPresets`. The metadata is read
 * from disk on every call (manifest, every locale file and the icon, synchronously and uncached): about 36 ms of the
 * Host's event loop for 210 entries. Given a context that provides only the Loader, the same reader answers in well
 * under a millisecond. Only ever call this once per occasion, never per Loader event (#1463).
 * @param ctx - The running application's context; it must provide the Loader.
 * @returns The Loader's non-group entries, in Loader order.
 */
export async function readLoaderInventory(ctx: Context): Promise<readonly PluginInventoryEntry[]> {
  const loader = ctx.get('loader')
  if (loader === undefined) throw new Error('The Loader is unavailable')
  const loaderOnly = { loader, get: (name: string) => name === 'loader' ? loader : undefined }
  return (await readPluginInventory(loaderOnly as unknown as Context)).entries
}

/** Keep the official inventory's enablement and named phases, including ancestor enablement. */
export async function recordOfficialPluginInventory(ctx: Context, record: RecordDiagnostic): Promise<void> {
  if (!ctx.get('loader')) return
  try {
    const entries = await readLoaderInventory(ctx)
    if (!active(ctx)) return
    for (const entry of entries) {
      record({ source: 'host.plugins', event: 'plugin.snapshot', developer: true,
        fields: { api: 'readPluginInventory', pluginId: entry.entryId, module: entry.moduleName,
          enabled: entry.enabled, fiberPhase: entry.fiberPhase } })
    }
  } catch (error) {
    if (active(ctx)) record({ source: 'host.plugins', event: 'inventory.failed', level: 'warn', developer: true, error })
  }
}

/** Read only the official topology's coordinates, never activate Inspector or copy raw capture data. */
export async function recordOfficialInspector(ctx: Context, record: RecordDiagnostic): Promise<void> {
  const inspector = ctx.get('inspector')
  if (!inspector) {
    record({ source: 'host.inspector', event: 'inspector.unavailable', developer: true,
      fields: { state: 'disabled-or-not-installed' } })
    return
  }
  try {
    const tree = await inspector.cordis.getTree()
    if (!active(ctx)) return
    record({ source: 'host.inspector', event: 'inspector.snapshot', developer: true,
      fields: { api: 'ctx.inspector.cordis.getTree', schemaVersion: tree.schemaVersion,
        hostPresent: tree.host !== null, clientCount: tree.clients.length } })
    for (const realm of [...(tree.host ? [tree.host] : []), ...tree.clients]) {
      record({ source: 'host.inspector', event: 'realm.snapshot', developer: true,
        fields: { sourceId: realm.source.sourceId, kind: realm.source.kind, revision: realm.revision,
          connection: realm.connection.state, truncated: realm.truncated } })
    }
  } catch (error) {
    if (active(ctx)) record({ source: 'host.inspector', event: 'inspector.query-failed', level: 'warn', developer: true, error })
  }
}
