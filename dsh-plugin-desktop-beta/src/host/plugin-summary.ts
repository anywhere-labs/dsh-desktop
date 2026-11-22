/**
 * Plugin facts the Host records whatever the logging setting, from the official Profile and Loader readers:
 * the selected bundles the Profile skipped, and a summary of the Loader's entries once the Host is ready and
 * again after plugins change, listing every enabled entry that failed, never loaded or still waits for
 * services. An entry is listed again only when its phase or diagnostic changes, and once more when it
 * becomes active again.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Profile } from '@deepseek-ai/dsh-app-boot'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import type { PluginInventoryEntry } from '@deepseek-ai/dsh-host-plugin-inventory'
import type { LogInput } from '../log-record.ts'
import type {} from '../upstream-family/operation-diagnostics.ts'
import { readLoaderInventory } from './official-diagnostics.ts'

type RecordDiagnostic = (input: LogInput) => void

/** Most entries one summary lists per kind; the rest are counted. */
const MAX_LISTED = 50
/** Longest skip reason or failure diagnostic one record carries. */
const MAX_TEXT_CHARS = 2048
/** Plugin changes settle through HMR reconciliation, so a summary waits this long after the last one. */
export const PLUGIN_CHANGE_SETTLE_MS = 3_000

const active = (ctx: Context): boolean => ctx.fiber?.state !== 4 && ctx.fiber?.state !== 5

/** The listed kind of an enabled entry that is not active, or `undefined` for one that is or is still loading. */
function problem(entry: PluginInventoryEntry): 'failed' | 'not-loaded' | 'pending' | undefined {
  if (entry.fiberPhase === 'failed') return 'failed'
  if (entry.fiberPhase === null) return 'not-loaded'
  if (entry.fiberPhase === 'pending') return 'pending'
  return undefined
}

/**
 * Record each selected bundle the Profile skipped, with why; upstream prints them only from its own launcher.
 * @param skipped - The loaded Profile's skipped bundles.
 * @param record - Where the records go.
 */
export function recordSkippedBundles(skipped: Profile['skippedBundles'], record: RecordDiagnostic): void {
  for (const bundle of skipped.slice(0, MAX_LISTED)) {
    record({ source: 'host.profile', event: 'bundle.skipped', level: 'warn', message: bundle.reason.slice(0, MAX_TEXT_CHARS), fields: { bundle: bundle.packageName } })
  }
  if (skipped.length > MAX_LISTED) record({ source: 'host.profile', event: 'bundle.skipped.omitted', level: 'warn', fields: { count: skipped.length - MAX_LISTED } })
}

/** The plugin summaries of one Host run. */
export class PluginSummary {
  /** Entries listed as a problem, with the phase and diagnostic they were listed with. */
  private readonly listed = new Map<string, string>()
  private timer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly record: RecordDiagnostic) {}

  /**
   * Summarize the Loader's entries now. Never rejects: an inventory that cannot be read is itself recorded.
   * @param ctx - The running application's context.
   * @param reason - What prompted the summary.
   */
  async summarize(ctx: Context, reason: 'ready' | 'plugins-changed'): Promise<void> {
    if (!ctx.get('loader')) return
    let entries: readonly PluginInventoryEntry[]
    try { entries = await readLoaderInventory(ctx) } catch (error) {
      if (active(ctx)) this.record({ source: 'host.plugins', event: 'summary.failed', level: 'warn', error })
      return
    }
    if (!active(ctx)) return
    const enabled = entries.filter(entry => entry.enabled)
    const counts = { failed: 0, 'not-loaded': 0, pending: 0 }
    const listedNow = new Set<string>()
    let omitted = 0
    for (const entry of enabled) {
      const kind = problem(entry)
      if (kind === undefined) continue
      listedNow.add(entry.entryId)
      if (++counts[kind] > MAX_LISTED) { omitted++; continue }
      const key = `${kind}\u0000${entry.diagnostic ?? ''}`
      if (this.listed.get(entry.entryId) === key) continue
      this.listed.set(entry.entryId, key)
      this.record({ source: 'host.plugins', event: `plugin.${kind}`, level: kind === 'failed' ? 'error' : 'warn',
        ...(entry.diagnostic === undefined ? {} : { message: entry.diagnostic.slice(0, MAX_TEXT_CHARS) }),
        fields: { pluginId: entry.entryId, module: entry.moduleName } })
    }
    for (const entry of enabled) {
      if (!this.listed.has(entry.entryId) || listedNow.has(entry.entryId) || entry.fiberPhase !== 'active') continue
      this.listed.delete(entry.entryId)
      this.record({ source: 'host.plugins', event: 'plugin.recovered', fields: { pluginId: entry.entryId, module: entry.moduleName } })
    }
    // Entries disabled or removed since they were listed are listed afresh if they come back with a problem.
    for (const entryId of [...this.listed.keys()]) if (!listedNow.has(entryId)) this.listed.delete(entryId)
    const problems = counts.failed + counts['not-loaded']
    this.record({ source: 'host.plugins', event: 'plugins.summary', level: problems > 0 ? 'warn' : 'info', fields: {
      reason, entries: entries.length, enabled: enabled.length, active: enabled.filter(entry => entry.fiberPhase === 'active').length,
      failed: counts.failed, notLoaded: counts['not-loaded'], pending: counts.pending, ...(omitted > 0 ? { omitted } : {}),
    } })
  }

  /**
   * Summarize again once plugin manager operations and plugin commands have settled.
   * @param ctx - The running application's context; the subscriptions and the pending summary end with it.
   */
  observe(ctx: Context): void {
    const later = (): void => {
      clearTimeout(this.timer)
      this.timer = setTimeout(() => { this.timer = undefined; void this.summarize(ctx, 'plugins-changed') }, PLUGIN_CHANGE_SETTLE_MS)
      this.timer.unref()
    }
    ctx.on('plugin-manager/operation', (operation) => { if (operation.phase !== 'started') later() })
    ctx.on('desktop/plugin-command', (command) => { if (command.phase !== 'started') later() })
    ctx.effect(() => () => { clearTimeout(this.timer); this.timer = undefined }, 'Next plugin summary')
  }
}
