import { readFileSync, readdirSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const stableRoot = join(root, 'dsh-plugin-desktop', 'src')
const betaRoot = join(root, 'dsh-plugin-desktop-beta', 'src')
// PR #868's isolated compatibility chrome is beta-only. Stable retains the
// single-document frame; both variants retain renderer crash recovery (#869).
const betaOnlyPaths = new Set([
  // Default Beta Host process experiment remains Beta-only until validated.
  'host-bootstrap.ts',
  'host-launch-environment.ts',
  'host-process.ts',
  'host-process-entry.ts',
  'host-rpc.ts',
  'host-runtime-bridge.ts',
  'client/DesktopFrameTitlebarView.tsx',
  'compatibility-chrome-contract.ts',
  'compatibility-preload.ts',
  'compatibility-shell.ts',
  'native-ui/compatibility-chrome.html',
  'native-ui/compatibility-chrome/main.tsx',
  'native-ui/compatibility-chrome/overlay.ts',
  'native-ui/compatibility-chrome/style.css',
])
const allowedDifferences = new Set([
  // Beta reserves the full enhanced drag strip and isolates extended chrome.
  'client/styles.ts',
  'client/extended-shell.ts',
  'client/extended-styles.ts',
  // Compatibility chrome integration differs intentionally between channels.
  'client/ExtendedTitlebar.tsx',
  'client/window-service.ts',
  'electron-runtime.ts',
  'electron-shell-generation.ts',
  'runtime.ts',
  'update-lifecycle.ts',
  'bin.ts',
  'client/AdvancedFrame.tsx',
  // Both channels use the v0.1.5 main/rightbar contract; remaining differences
  // preserve channel identity and the beta-only compatibility frame.
  'client/desktop-settings.ts',
  'client/DesktopSettingsSection.tsx',
  'client/index.ts',
  'desktop-browser-access.ts',
  'desktop-dialog-window.ts',
  'desktop-plugins.ts',
  'desktop-terminal.ts',
  'diagnostic-export-worker.ts',
  'launch-environment.ts',
  'main.ts',
  'native-ui/setup-wizard/App.tsx',
  'product-identity.ts',
  'profile-manager.ts',
  'profile.ts',
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
  if (stable === undefined || beta === undefined || !stable.equals(beta)) differences.push(path)
}

if (differences.length > 0) {
  throw new Error(`Desktop variant source drift is not declared:\n${differences.map(path => `- src/${path}`).join('\n')}`)
}

process.stdout.write(`verify-desktop-variants: ${String(sharedPaths.size - allowedDifferences.size - betaOnlyPaths.size)} shared source files are aligned; beta-only compatibility chrome and Host experiment are isolated\n`)
