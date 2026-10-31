/** The pnpm distribution this installation carries and the invocation that runs it. */

import { createRequire } from 'node:module'
import { delimiter, dirname, join } from 'node:path'
import type { ProfilePnpmInvocation } from '@deepseek-ai/dsh-app-boot'
import { unpackedPath } from './asar-archive-policy.ts'
import { NEXT_PACKAGE } from './profiles.ts'
import { withDesktopPnpmPolicy } from './pnpm-policy.ts'

/** Headers pnpm uses to build native dependencies for the running Electron ABI. */
export const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'

/**
 * Entry of the pnpm this installation carries. Electron runs it as a separate Node-mode process
 * with its own workers, so a packaged Next uses the copy unpacked beside app.asar.
 * @param anchor - Manifest the installation resolves packages from.
 * @returns Absolute physical path of `pnpm.mjs`.
 */
export function bundledPnpmEntry(anchor: string): string {
  const require = createRequire(anchor)
  return unpackedPath(join(dirname(require.resolve('pnpm')), 'bin', 'pnpm.mjs'))
}

/**
 * Run the bundled pnpm with this process's executable in Node mode, independent of any `pnpm` on `PATH`.
 * @param runtimeDir - Installed Desktop package directory that contains `scripts/node-bin`.
 * @returns Package-manager invocation for the official plugin manager and CLI.
 */
export function bundledPnpmInvocation(runtimeDir: string): ProfilePnpmInvocation {
  return {
    command: process.execPath, args: ['--expose-internals', bundledPnpmEntry(NEXT_PACKAGE), ...withDesktopPnpmPolicy([])],
    env: {
      DSH_DESKTOP_NODE_EXECUTABLE: process.execPath,
      ...(process.versions.electron ? { ELECTRON_RUN_AS_NODE: '1' } : {}),
      // Package scripts execute the shims through the shell, which cannot enter app.asar.
      PATH: `${unpackedPath(join(runtimeDir, 'scripts', 'node-bin'))}${delimiter}${process.env.PATH ?? ''}`,
    },
  }
}
