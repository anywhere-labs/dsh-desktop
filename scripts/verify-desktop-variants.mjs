import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
const stableTestsRoot = join(root, 'dsh-plugin-desktop', 'tests')
const betaTestsRoot = join(root, 'dsh-plugin-desktop-beta', 'tests')
// Both editions share behavior. Only release identity, launcher wording, and the
// channels' pinned core versions differ.
const betaOnlyPaths = new Set(['profile-context.ts'])
const allowedDifferences = new Set([
  'product-identity.ts',
  // Beta rides dsh 0.1.6-alpha.2, whose runArgv fuses confinement preparation into the
  // execution deadline and returns { result, spawnRequested }; stable stays on
  // 0.1.5-rc.2, whose override takes an argv array and returns ShellRunResult.
  'windows-pwsh-sandbox.ts',
  // dsh 0.1.6-alpha.2 dropped the profile patch-reload policy: `patchReload` is gone from
  // ProfileTemplate, Profile, and the profile manifest, `initProfile` takes two arguments,
  // and reload is owned by the `hmr` entry in a profile's cordis.patch.yml instead. Beta
  // follows that API; stable stays on 0.1.5-rc.2, where the field still exists.
  'profile.ts',
  'profile-manager.ts',
])
const normalizeIdentity = source => source.toString().replaceAll('dsh-plugin-desktop-beta', 'dsh-plugin-desktop').replaceAll('DSH Desktop Beta', 'DSH Desktop')
// Allow only the alpha.2 bootstrap adapter calls, not arbitrary drift in these
// large shared entrypoints. Stable's rc.2 runtime has no ProfileContext contract.
const betaBootLines = new Set([
  "import { createDesktopProfileBoot } from './profile-context.ts'",
  'const profileBoot = createDesktopProfileBoot(prepared, desktopPnpmBootstrap)',
  'profileBoot.prepare(hostCtx)',
  'profileBoot.markReady()',
])
function normalizeBeta(source, path) {
  const text = normalizeIdentity(source)
  if (path !== 'main.ts' && path !== 'host-bootstrap.ts') return text
  const lines = text.split('\n')
  for (const expected of betaBootLines) {
    if (lines.filter(line => line.trim() === expected).length !== 1) {
      throw new Error(`Missing or duplicated Beta Profile adapter in ${path}: ${expected}`)
    }
  }
  return lines.filter(line => !betaBootLines.has(line.trim())).join('\n')
}

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
  if (stable === undefined || beta === undefined || normalizeIdentity(stable) !== normalizeBeta(beta, path)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; both editions use isolated Host and chrome\n`)

// Both editions share the regression suite. Test-only identifiers (package
// names, build scripts, pinned runtime versions) differ by channel, so tests/
// parity is existence-only: every spec file must exist on both sides (#1045).
// Stable-only tooling specs (e.g. stable-only scripts/ NSIS toolchain) and the
// beta-only profile-context spec are declared below instead of silently drifting.
const testsBetaOnlyPaths = new Set(['profile-context.spec.ts'])
const testsStableOnlyPaths = new Set(['windows-nsis-ab.spec.ts'])
const sharedTestPaths = new Set([...files(stableTestsRoot), ...files(betaTestsRoot)])
const testDifferences = []
for (const path of [...sharedTestPaths].sort()) {
  if (!path.endsWith('.spec.ts')) continue
  if (testsBetaOnlyPaths.has(path) || testsStableOnlyPaths.has(path)) continue
  let stableExists = true
  let betaExists = true
  try { readFileSync(join(stableTestsRoot, path)) } catch { stableExists = false }
  try { readFileSync(join(betaTestsRoot, path)) } catch { betaExists = false }
  if (!stableExists || !betaExists) testDifferences.push(path)
}

if (testDifferences.length > 0) {
  throw new Error(`Desktop variant test drift is not declared:\n${testDifferences.map(path => `- tests/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String([...sharedTestPaths].filter(path => path.endsWith('.spec.ts')).length)} shared spec files are present on both editions\n`)
