/** Fail the build when lib/ lacks a file one of its parallel steps wrote, as when another step emptied lib/ afterwards. */
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const lib = fileURLToPath(new URL('../lib', import.meta.url))
// Each step's files that the shell, Host and Loader open by name: tsdown's ESM and CJS entries, the Vite
// client bundle the Host hands to the Loader, and the native UI document.
const files = ['main.js', 'host.js', 'startup-entries.js', 'preload-app.cjs', 'preload-shell.cjs', 'preload-platform-account.cjs', 'client.js', 'native-ui/index.html']
const missing = files.filter(file => !existsSync(join(lib, file)))
if (missing.length > 0) {
  console.error(`Build output missing from ${lib}: ${missing.join(', ')}`)
  console.error('tsdown and both Vite builds write into lib/ at the same time; only scripts/clean.mjs, which runs before them, may empty it.')
  process.exitCode = 1
} else {
  console.log(`Build output complete: ${files.length} entry files in ${lib}`)
}
