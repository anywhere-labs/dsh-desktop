/** Preserve environment provenance across the private child channel. */
import type { LaunchEnvironmentLayerInput, LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

// loadLayeredEnv materializes all layer names into process.env before launch.
// Keep every source, including shadowed values, instead of flattening trust levels.
export function serializeHostEnvironment(snapshot: LaunchEnvironmentSnapshot,
  names: readonly string[] = [...Object.keys(process.env), 'DSH_HOME'],
): LaunchEnvironmentLayerInput[] {
  return (['process', 'project-env', 'user-env'] as const).map(source => {
    const values: Record<string, string> = {}
    let path: string | undefined
    for (const name of names) {
      const entry = snapshot.getFrom(name, [source])
      if (!entry) continue
      values[name] = entry.value
      path ??= entry.path
    }
    return { source, values, ...(path ? { path } : {}) }
  })
}
