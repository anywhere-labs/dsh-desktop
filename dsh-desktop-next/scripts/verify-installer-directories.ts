/**
 * Exercise the staged directory installation on Windows: compile the shared Desktop installer hooks and the vendored
 * transaction with the builder's pinned makensis, then run them silently against private directories.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'

if (process.platform !== 'win32') throw new Error('The directory installer smoke runs Windows installers; run it on Windows')
const require = createRequire(import.meta.url)
// The package entry initializes the platform classes before their mutually dependent leaves.
require('app-builder-lib')
const { getMakeNsisPath } = require('app-builder-lib/out/toolsets/windows.js') as {
  getMakeNsisPath: (nsis: string) => Promise<{ path: string; env?: NodeJS.ProcessEnv }>
}
const { getPath7za } = require('app-builder-lib/out/toolsets/7zip.js') as { getPath7za: () => Promise<string> }
const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { build: { toolsets: { nsis: string } } }
const makensis = await getMakeNsisPath(manifest.build.toolsets.nsis)
const result = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-File', join(import.meta.dirname, 'smoke-installer-directories.ps1'),
  '-Makensis', makensis.path, '-SevenZip', await getPath7za()], { stdio: 'inherit', env: { ...process.env, ...makensis.env } })
if (result.error) throw result.error
process.exitCode = result.status ?? 1
