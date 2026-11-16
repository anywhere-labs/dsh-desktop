/**
 * Vendored DSH runtimes and Desktop patches of DSH runtime packages belong to the upstream releases that
 * `upstream.json` channels follow. A runtime bump copies the patches it still needs to the new version, so
 * whatever the bump leaves behind is dead weight in every checkout and worktree.
 */

// Desktop patches of runtime packages are named after the unscoped package (`dsh` or `dsh-*`) and the runtime
// version, as `scripts/sync-vendored-runtime.mjs` resolves them. Third-party patches never start with `dsh`.
const DSH_RUNTIME_PATCH = /^dsh(?:-[^@]+)?@(.+)\.patch$/u

/**
 * List the vendored runtimes and runtime patches that no channel uses.
 * @param {readonly string[]} channelVersions - every `upstream.json` channel's source version.
 * @param {readonly string[]} runtimeEntries - entry names below `vendor/dsh-runtime`.
 * @param {readonly string[]} patchFiles - file names below `patches`.
 * @returns {string[]} sorted repository-relative paths to delete.
 */
export function retiredRuntimePaths(channelVersions, runtimeEntries, patchFiles) {
  const current = new Set(channelVersions)
  const runtimes = runtimeEntries
    .filter(name => !name.startsWith('.') && !current.has(name))
    .map(name => `vendor/dsh-runtime/${name}`)
  const patches = patchFiles.flatMap((name) => {
    const match = DSH_RUNTIME_PATCH.exec(name)
    return match !== null && !current.has(match[1]) ? [`patches/${name}`] : []
  })
  return [...runtimes, ...patches].sort()
}
