import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
const allowedDifferences = new Set([
  'agent-preset-compat.ts',
  'bin.ts',
  'client/AdvancedFrame.tsx',
  'client/desktop-settings.ts',
  'client/DesktopSettingsSection.tsx',
  'client/index.ts',
  'desktop-browser-access.ts',
  'desktop-data-directory.ts',
  'desktop-data-operation-lock.ts',
  'desktop-dialog-window.ts',
  'desktop-factory-reset.ts',
  'desktop-plugins.ts',
  'desktop-terminal.ts',
  'diagnostic-export-worker.ts',
  'index.ts',
  'main.ts',
  'native-ui/recovery/App.tsx',
  'native-ui/setup-wizard/App.tsx',
  'notifications.ts',
  'packaged-runtime-smoke.ts',
  'product-identity.ts',
  'profile-manager.ts',
  'profile.ts',
  'quick-ask.ts',
  'recovery-copy.ts',
  'safe-mode.ts',
  'setup-wizard-contract.ts',
  'startup-recovery-window.ts',
  'updates.ts',
  'webserver.ts',
])

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
  if (stable === undefined || beta === undefined || !stable.equals(beta)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size)} shared source files are aligned\n`)
