/**
 * Provider-group visibility helpers shared by the per-card Settings switch and
 * the Host-side catalog filter.
 *
 * A group is identified by its provider route id (never its display name):
 * `displayName` is editable and plugin-owned labels can change between loads.
 * Plugin-managed groups such as `trae` have no configurable-provider entry and
 * are never offered a switch, so they stay visible.
 */

/** The exact `settings.mutate` operation shape accepted by the Host. */
export interface DisabledProvidersOp {
  readonly op: 'set'
  readonly path: readonly string[]
  readonly value: readonly string[]
}

export const DISABLED_PROVIDERS_FIELD = 'disabledProviders'
export const DISABLED_PROVIDERS_NAMESPACE = 'llm-pi-ai'

/**
 * Read the persisted disabled-id list from one settings descriptor's value.
 * Malformed or legacy values resolve to an empty list rather than throwing.
 */
export function readDisabledProviders(value: unknown): string[] {
  if (value === null || typeof value !== 'object') return []
  const raw = Reflect.get(value, DISABLED_PROVIDERS_FIELD)
  if (!Array.isArray(raw)) return []
  const seen = new Set<string>()
  for (const entry of raw) {
    if (typeof entry === 'string' && entry.length > 0) seen.add(entry)
  }
  return [...seen]
}

/** Toggle one provider id in the disabled list. Unlisted ids default to enabled. */
export function withProviderToggled(disabled: readonly string[], provider: string, enabled: boolean): string[] {
  const next = new Set(disabled)
  if (enabled) next.delete(provider)
  else if (provider.length > 0) next.add(provider)
  return [...next]
}

/** Build the one `settings.mutate` operation that persists the whole list. */
export function disabledProvidersOp(disabled: readonly string[]): DisabledProvidersOp {
  return { op: 'set', path: [DISABLED_PROVIDERS_FIELD], value: [...new Set(disabled)].filter(id => id.length > 0) }
}

/** Structural view of the per-session model directory the client resets. */
export interface SessionDirectoryLike {
  readonly store: {
    getSnapshot(): { current: { provider: string; model: string; reasoningEffort?: string } | null }
  }
  select(selection: { provider: string; model: string; reasoningEffort?: string }): Promise<unknown>
}

/**
 * Choose the model a session falls back to after its group is hidden.
 * Prefers the deployment default; if that too is hidden, uses the first
 * visible group's first model. Returns undefined when nothing is visible.
 */
export function visibleFallback<T extends { provider: string; model: string }>(
  fallback: T,
  disabled: readonly string[],
  groups: readonly { id: string; models: readonly { id: string }[] }[],
): T | undefined {
  const hidden = new Set(disabled)
  if (!hidden.has(fallback.provider)) return fallback
  for (const group of groups) {
    if (hidden.has(group.id) || group.models.length === 0) continue
    const model = group.models[0]
    if (model) return { ...fallback, provider: group.id, model: model.id }
  }
  return undefined
}

/**
 * Reset every live session whose current model belongs to a freshly disabled
 * provider. Returns the number of selections submitted to the Host.
 */
export function resetDisabledSelections(
  directories: Iterable<SessionDirectoryLike>,
  disabled: readonly string[],
  fallback: { provider: string; model: string; reasoningEffort?: string },
): number {
  const hidden = new Set(disabled)
  let resets = 0
  for (const directory of directories) {
    const current = directory.store.getSnapshot().current
    if (current === null || !hidden.has(current.provider)) continue
    void directory.select(fallback).catch(() => {})
    resets += 1
  }
  return resets
}
