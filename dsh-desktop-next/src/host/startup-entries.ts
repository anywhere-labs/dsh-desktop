/**
 * Report which Loader entries still hold a Host start (#1617). The Host announces readiness only after
 * `loader.await()` settles, and before that the Host entry has no context of its own to ask; this row,
 * inserted by host.cordis.patch.yml, lends it the Loader through `readStartupEntries`.
 */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import { MAX_STARTUP_ENTRIES, MAX_STARTUP_ENTRY_TEXT, type DesktopStartupEntry } from '../host-startup-limit.ts'

export const name = 'desktop-next-startup-entries'
export const inject = ['loader']

/** Shared by this row's module and the Host entry, which can each be a separate copy of this file. */
const READER = Symbol.for('dsh-desktop-next.startup-entries')
/** Mirrors Cordis's const enum FiberState.UNLOADING. */
const UNLOADING = 5

/** The part of a Loader entry this report reads; `_initTask` and `inertia` are what `loader.await()` waits on. */
export interface StartupLoaderEntry {
  readonly options: { readonly id: string; readonly name: string; readonly group?: boolean | null }
  readonly _initTask?: Promise<void>
  readonly fiber?: { readonly state: number; readonly inertia: Promise<void> | undefined }
  readonly subgroup?: unknown
  readonly subtree?: unknown
}

/**
 * List the entries `loader.await()` still waits on. Groups and includes wait for their members, so they
 * are listed only when no member is pending.
 * @param entries - The Loader's entries, nested trees included.
 * @param created - When the Host created an entry, if this row saw it happen.
 * @param mounted - When this row mounted, standing in for entries created before it.
 * @param now - The current time.
 * @returns At most MAX_STARTUP_ENTRIES entries, the longest-waiting first.
 */
export function pendingStartupEntries(entries: Iterable<StartupLoaderEntry>, created: (entry: StartupLoaderEntry) => number | undefined,
  mounted: number, now: number): DesktopStartupEntry[] {
  const pending: { readonly container: boolean; readonly entry: DesktopStartupEntry }[] = []
  for (const entry of entries) {
    const importing = entry._initTask !== undefined
    if (!importing && entry.fiber?.inertia === undefined) continue
    pending.push({
      container: entry.options.group === true || entry.subgroup !== undefined || entry.subtree !== undefined,
      entry: {
        id: String(entry.options.id).slice(0, MAX_STARTUP_ENTRY_TEXT),
        name: String(entry.options.name).slice(0, MAX_STARTUP_ENTRY_TEXT),
        phase: importing ? 'importing' : entry.fiber?.state === UNLOADING ? 'stopping' : 'starting',
        waitedMs: Math.max(0, now - (created(entry) ?? mounted)),
      },
    })
  }
  const members = pending.filter(item => !item.container)
  return (members.length > 0 ? members : pending).map(item => item.entry)
    .sort((left, right) => right.waitedMs - left.waitedMs || left.id.localeCompare(right.id))
    .slice(0, MAX_STARTUP_ENTRIES)
}

/** @returns What a start still waits on, or undefined before this row mounts. */
export function readStartupEntries(): DesktopStartupEntry[] | undefined {
  const reader = (globalThis as Record<symbol, unknown>)[READER]
  return typeof reader === 'function' ? (reader as () => DesktopStartupEntry[])() : undefined
}

export function apply(ctx: Context): void {
  const mounted = Date.now()
  const created = new WeakMap<object, number>()
  ctx.on('loader/entry-init', (entry) => { created.set(entry, Date.now()) }, { global: true })
  const reader = (): DesktopStartupEntry[] => pendingStartupEntries(ctx.loader.entries(), entry => created.get(entry), mounted, Date.now())
  ctx.effect(() => {
    const global = globalThis as Record<symbol, unknown>
    global[READER] = reader
    return () => { if (global[READER] === reader) delete global[READER] }
  }, 'Next startup entries')
}
