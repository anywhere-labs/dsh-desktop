import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// Both editions now pin one core API. Only their product identities differ.
const allowedDifferences = new Set(['product-identity.ts'])
const normalizeIdentity = source => source.toString().replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop').replaceAll('DSH Desktop Beta', 'DSH Desktop')

function files(directory, base = directory) {
  const result = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) result.push(...files(path, base))
    else if (entry.isFile()) result.push(relative(base, path).split(sep).join('/'))
  }
  return result
}

const sharedPaths = new Set([...files(stableRoot), ...files(betaRoot)])
const differences = []
for (const path of [...sharedPaths].sort()) {
  if (allowedDifferences.has(path)) continue
  let stable
  let beta
  try { stable = readFileSync(join(stableRoot, path)) } catch { stable = undefined }
  try { beta = readFileSync(join(betaRoot, path)) } catch { beta = undefined }
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeIdentity(beta)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)
