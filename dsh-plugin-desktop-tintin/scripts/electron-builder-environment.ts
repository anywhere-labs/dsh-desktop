/** Dependency-collection and archive policy shared by Electron Builder entry points. */

/**
 * Keep the Beta package on Electron Builder's bounded physical traversal.
 * Its Yarn Berry collector delegates to `npm list --all`, which expands the
 * outer stable and Beta workspace instead of the selected app's runtime graph.
 */
export function electronBuilderEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return {
    ...environment,
    DSH_ELECTRON_BUILDER_TRAVERSAL_ONLY: '1',
    // 7z mx=2 for the NSIS payload (2026-10-21 user ruling): the vendored
    // runtime is ~2 GB of already-compressed binaries, so mx=9 lands within
    // 0.1 MB of mx=2 while costing most of the packaging time. The outer
    // environment wins when a benchmark wants another level.
    ELECTRON_BUILDER_COMPRESSION_LEVEL: environment.ELECTRON_BUILDER_COMPRESSION_LEVEL ?? '2',
  }
}
