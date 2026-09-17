import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// Both editions share behavior. Only release identity, launcher wording, and the
// channels' pinned core versions differ.
const betaOnlyPaths = new Set([])
const allowedDifferences = new Set([
  'product-identity.ts',
  // Beta rides dsh 0.1.6-alpha.1, whose runArgv fuses confinement preparation into the
  // execution deadline and returns { result, spawnRequested }; stable stays on
  // 0.1.5-rc.2, whose override takes an argv array and returns ShellRunResult.
  'windows-pwsh-sandbox.ts',
])
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

const sharedPaths = new Set([...files(stableRoot), ...files(betaRoot), ...betaOnlyPaths])
const differences = []
for (const path of [...sharedPaths].sort()) {
  if (allowedDifferences.has(path)) continue
  let stable
  let beta
  try { stable = readFileSync(join(stableRoot, path)) } catch { stable = undefined }
  try { beta = readFileSync(join(betaRoot, path)) } catch { beta = undefined }
  if (betaOnlyPaths.has(path)) {
    if (stable !== undefined || beta === undefined) differences.push(`${path} (must exist only in beta)`)
    continue
  }
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeIdentity(beta)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)
