/** Build an unsigned Windows x64 portable ZIP archive on a native Windows host. */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createWindowsPackageOptions,
  packageWindowsArtifact,
} from './package-win.ts'
import { prepareDesktopInterpreters } from './prepare-runtime.ts'

const invokedPath = process.argv[1]
if (invokedPath !== undefined && invokedPath === fileURLToPath(import.meta.url)) {
  try {
    await prepareDesktopInterpreters({ desktopRoot: resolve(dirname(fileURLToPath(import.meta.url)), '..') })
    packageWindowsArtifact(
      createWindowsPackageOptions('./verify-win-portable.ts'),
      'zip',
      'portable archive',
    )
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
