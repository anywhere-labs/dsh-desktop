/**
 * Run the Beta unit tests that can behave differently from Next.
 *
 * Beta mirrors Next with declared channel substitutions, and the full Next suite already covers the
 * shared behavior. Every Beta module whose bytes differ from Next goes to `vitest related`, which
 * runs the specs that carry channel-specific values themselves or import such a module. This holds only
 * while Beta follows Next's upstream release; otherwise the root `check:beta` runs Beta's full check.
 */
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BETA_MIRROR_CHECK, expectedBetaCheck, variantSpecificFiles } from './verify-desktop-variants.mjs'
import { vitestEntry } from './vitest-entry.mjs'

const betaRoot = resolve(import.meta.dirname, '..', 'dsh-plugin-desktop-beta')
const MODULE_PATH = /^(?:src|scripts|tests)\/.+\.(?:[cm]?[jt]sx?|css)$/u

/**
 * Keep the differing files Vitest can place in its module graph.
 * @param {readonly string[]} files - Package-relative POSIX paths.
 * @returns {string[]} Source, script and test modules in input order.
 */
export function relatedTestTargets(files) {
  return files.filter(file => MODULE_PATH.test(file))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (expectedBetaCheck() !== BETA_MIRROR_CHECK) {
    throw new Error('test-beta-variant: Beta follows its own upstream release, so only its full check covers it; run `corepack yarn check:beta`')
  }
  const targets = relatedTestTargets(variantSpecificFiles())
  // Beta always differs from Next at least in its data directory, so an empty set means the comparison broke.
  if (targets.length === 0) throw new Error('test-beta-variant: found no channel-specific Beta modules')
  process.stdout.write(`test-beta-variant: running the Beta specs related to ${String(targets.length)} channel-specific modules\n`)
  const result = spawnSync(process.execPath, [vitestEntry(betaRoot), 'related', '--run', ...process.argv.slice(2), ...targets], {
    cwd: betaRoot,
    stdio: 'inherit',
  })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
}
