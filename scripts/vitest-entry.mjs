/** Locate the Vitest CLI a workspace installs, so root scripts start it without a package-manager hop. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

/**
 * @param {string} packageRoot - Workspace whose installed Vitest runs its specs.
 * @returns {string} Absolute path of the Vitest CLI entry.
 */
export function vitestEntry(packageRoot) {
  const manifestPath = createRequire(join(packageRoot, 'package.json')).resolve('vitest/package.json')
  const { bin } = JSON.parse(readFileSync(manifestPath, 'utf8'))
  return join(dirname(manifestPath), typeof bin === 'string' ? bin : bin.vitest)
}
