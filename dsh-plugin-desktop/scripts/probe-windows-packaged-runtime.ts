/** Run the production packaged-runtime gate against an installed Windows app. */

import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  smokePackagedElectronRuntime,
  type PackagedElectronSmoke,
} from './verify-packaged-runtime.ts'

export interface InstalledWindowsRuntimeProbe {
  readonly installRoot: string
  readonly executable: string
  readonly success: boolean
  readonly error: string | null
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Reuse the post-fuse packaging gate instead of maintaining a weaker Windows-
 * only startup approximation. The shared gate exercises DSH, pnpm, the
 * Profile resolver, native ripgrep, the diagnostic Worker, config composition,
 * and a real Loader boot through Electron's RunAsNode mode.
 */
export function probeInstalledWindowsRuntime(
  installRoot: string,
  smoke: PackagedElectronSmoke = smokePackagedElectronRuntime,
  platform: NodeJS.Platform = process.platform,
): InstalledWindowsRuntimeProbe {
  const root = resolve(installRoot)
  const executable = join(root, 'DSH Desktop.exe')
  try {
    if (platform !== 'win32') {
      throw new Error('installed Windows runtime probe requires a native Windows host')
    }
    if (!existsSync(executable)) throw new Error(`installed executable is missing: ${executable}`)
    smoke({
      appOutDir: root,
      electronPlatformName: 'win32',
      arch: 1,
      packager: {
        executableName: 'DSH Desktop',
        appInfo: { productFilename: 'DSH Desktop' },
      },
    })
    return { installRoot: root, executable, success: true, error: null }
  } catch (cause) {
    return { installRoot: root, executable, success: false, error: message(cause) }
  }
}

function parseInstallRoot(argv: readonly string[]): string {
  const index = argv.indexOf('--install-root')
  if (index === -1 || index + 1 >= argv.length || argv[index + 1]?.length === 0) {
    throw new Error('usage: node probe-windows-packaged-runtime.ts --install-root <directory>')
  }
  if (argv.length !== 2) {
    throw new Error(`unexpected argument: ${argv.find((_, item) => item !== index && item !== index + 1) ?? ''}`)
  }
  return argv[index + 1] as string
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  let result: InstalledWindowsRuntimeProbe
  try {
    result = probeInstalledWindowsRuntime(parseInstallRoot(process.argv.slice(2)))
  } catch (cause) {
    result = {
      installRoot: '',
      executable: '',
      success: false,
      error: message(cause),
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  if (!result.success) process.exitCode = 2
}
