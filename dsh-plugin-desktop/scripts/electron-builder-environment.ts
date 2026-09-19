/** Dependency-collection policy shared by Electron Builder entry points. */

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
  }
}
