/** Preserve the public executable name while choosing Node mode before Electron starts. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LINUX_EXECUTABLE = 'dsh-desktop-next'
export const LINUX_BINARY = 'dsh-desktop-next.bin'
export const LINUX_LAUNCHER = `#!/bin/sh
set -eu
# readlink -f also handles /usr/bin's link to /opt and installation paths with spaces.
self=$(readlink -f -- "$0")
base=$(dirname -- "$self")
# Node-mode invocations by Host, pnpm and diagnostics must retain their argv unchanged.
if [ "\${ELECTRON_RUN_AS_NODE:-}" = 1 ]; then
  exec "$base/${LINUX_BINARY}" "$@"
fi
for arg in "$@"; do
  if [ "$arg" = --headless ]; then
    export ELECTRON_RUN_AS_NODE=1
    exec "$base/${LINUX_BINARY}" "$base/resources/app.asar/lib/headless.js" "$@"
  fi
done
exec "$base/${LINUX_BINARY}" "$@"
`
export function installLinuxLauncher(appOutDir: string): void {
  const executable = join(appOutDir, LINUX_EXECUTABLE)
  const binary = join(appOutDir, LINUX_BINARY)
  if (existsSync(binary)) {
    if (readFileSync(executable, 'utf8') !== LINUX_LAUNCHER) throw new Error('Unexpected existing Linux launcher')
    return
  }
  const header = readFileSync(executable).subarray(0, 4)
  if (!header.equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46]))) throw new Error('Linux launcher requires the original ELF executable')
  renameSync(executable, binary)
  try { writeFileSync(executable, LINUX_LAUNCHER, { mode: 0o755, flag: 'wx' }) }
  catch (error) { renameSync(binary, executable); throw error }
}
