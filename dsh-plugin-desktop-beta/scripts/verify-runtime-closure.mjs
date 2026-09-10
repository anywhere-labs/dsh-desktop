import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

import { loadInstalledPackage, verifyRuntimeClosure } from './runtime-closure.mjs'

const manifestPath = resolve(import.meta.dirname, '../package.json')
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
const result = await verifyRuntimeClosure(manifest, loadInstalledPackage, manifestPath)

if (result.failures.length > 0) {
  console.error('verify-runtime-closure: required first-party peers are missing from dsh-plugin-desktop-beta dependencies:')
  for (const failure of result.failures) console.error(`  ${failure}`)
  process.exit(1)
}

console.log(`verify-runtime-closure: ${result.packageCount} first-party nodes form a closed reachable runtime graph.`)
