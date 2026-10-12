/** Fail the client build when its bundle requires anything outside the declared external surface. */

import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Every runtime require the client bundle may legitimately contain. This is
 * the tsdown external list plus Node/browser builtins; anything else means the
 * bundler emitted a require for a module nobody supplies at runtime — exactly
 * the silent failure mode observed once with @deepseek-ai/dsh-client-runtime.
 */
const ALLOWED_EXTERNALS = new Set([
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-locale/client',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-layout/client',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-settings/client',
  '@deepseek-ai/dsh-client-ui-sidebar/client',
  '@deepseek-ai/dsh-client-ui-slots',
])

function requireSpecifiers(source) {
  const specs = []
  const pattern = /\brequire\((['"])([^'"]+)\1\)/gu
  for (const match of source.matchAll(pattern)) specs.push(match[2])
  return specs
}

const bundle = readFileSync(resolve(packageRoot, 'lib', 'client.js'), 'utf8')
const unexpected = [...new Set(requireSpecifiers(bundle))]
  .filter(spec => !ALLOWED_EXTERNALS.has(spec))
if (unexpected.length > 0) {
  console.error(`dsh-community-market: client bundle requires undeclared externals: ${unexpected.join(', ')}`)
  console.error('Either add them to the tsdown external list (and this allowlist) or bundle them; an undeclared require has no runtime supplier and crashes plugin loading.')
  process.exitCode = 1
} else {
  console.log(`dsh-community-market: client externals are all declared (${ALLOWED_EXTERNALS.size} allowed).`)
}
