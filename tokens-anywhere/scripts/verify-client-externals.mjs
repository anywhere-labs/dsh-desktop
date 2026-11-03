/** Fail the client build when its bundle requires anything the shell's module loader does not supply. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every runtime require the client bundle may contain: the tsdown external list, all of it in the shell's shared
 * module table. Anything else has no runtime supplier and crashes plugin loading; `@deepseek-ai/*` client imports
 * other than these must stay type-only.
 */
const ALLOWED_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-slots',
])

const bundle = readFileSync(resolve(packageRoot, 'lib', 'client.js'), 'utf8')
const unexpected = [...new Set([...bundle.matchAll(/\brequire\((['"])([^'"]+)\1\)/gu)].map(match => match[2]))]
  .filter(spec => !ALLOWED_EXTERNALS.has(spec))
if (unexpected.length > 0) {
  console.error(`tokens-anywhere: client bundle requires undeclared externals: ${unexpected.join(', ')}`)
  process.exitCode = 1
} else {
  console.log(`tokens-anywhere: client externals are all declared (${ALLOWED_EXTERNALS.size} allowed).`)
}
