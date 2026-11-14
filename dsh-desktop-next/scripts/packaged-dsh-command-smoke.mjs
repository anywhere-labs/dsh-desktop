/** Start one packaged Linux executable as an AppImage's AppRun may start `<app> dsh --version`; no window, no display. */
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.argv[2]
if (!root) throw new Error('packaged-dsh-command-smoke: expected the packaged application root')
const expected = createRequire(join(root, 'package.json'))('@deepseek-ai/dsh/package.json').version
// A private home keeps the launch away from the builder's own data directory choice and Profiles.
const home = mkdtempSync(join(tmpdir(), 'dsh-command-smoke-'))
try {
  const env = { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') }
  delete env.ELECTRON_RUN_AS_NODE
  delete env.DSH_DESKTOP_NEXT_HOME
  // The application starts in Chromium mode and replaces itself with the CLI.
  const result = spawnSync(process.execPath, ['--no-sandbox', 'dsh', '--version'], { env, encoding: 'utf8', timeout: 60_000 })
  if (result.error) throw result.error
  if (result.status !== 0 || result.stdout.trim() !== expected) {
    throw new Error(`packaged-dsh-command-smoke: expected dsh ${expected}, got exit ${String(result.status)} signal ${String(result.signal)}\n${result.stdout}${result.stderr}`)
  }
  console.log(`Packaged dsh command answered ${expected}`)
} finally {
  rmSync(home, { recursive: true, force: true })
}
