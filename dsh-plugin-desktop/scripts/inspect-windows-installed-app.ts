/** Inspect an installed Windows app without launching it. */

import { closeSync, existsSync, lstatSync, openSync, readSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractFile, listPackage } from '@electron/asar'
import {
  identifyWindowsNsisAbFile,
  identifyWindowsNsisAbTree,
  normalizeWindowsNsisAbRelativePath,
  type WindowsNsisAbArtifactIdentity,
  type WindowsNsisAbTreeIdentity,
} from './windows-nsis-ab.ts'

export interface InstalledWindowsAppInspection {
  readonly installRoot: string
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly application: WindowsNsisAbTreeIdentity | null
  readonly executable: WindowsNsisAbArtifactIdentity | null
  readonly resources: WindowsNsisAbTreeIdentity | null
  readonly appAsar: (WindowsNsisAbArtifactIdentity & {
    readonly entryCount: number
    readonly packageName: string | null
  }) | null
  readonly unpacked: WindowsNsisAbTreeIdentity | null
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function descendantIgnoredPaths(
  applicationRelativePaths: readonly string[],
  prefix: string,
): string[] {
  return applicationRelativePaths
    .filter(path => path.startsWith(prefix) && path.length > prefix.length)
    .map(path => path.slice(prefix.length))
}

/** Return structural and content identities used by post-install/fault probes. */
export function inspectInstalledWindowsApp(
  installRoot: string,
  ignoreRelativePaths: readonly string[] = [],
): InstalledWindowsAppInspection {
  const root = resolve(installRoot)
  const normalizedIgnoredPaths = ignoreRelativePaths.map(normalizeWindowsNsisAbRelativePath)
  const resourcesPath = join(root, 'resources')
  const executablePath = join(root, 'DSH Desktop.exe')
  const asarPath = join(resourcesPath, 'app.asar')
  const unpackedPath = join(resourcesPath, 'app.asar.unpacked')
  const errors: string[] = []
  let application: WindowsNsisAbTreeIdentity | null = null
  let executable: WindowsNsisAbArtifactIdentity | null = null
  let resources: WindowsNsisAbTreeIdentity | null = null
  let appAsar: InstalledWindowsAppInspection['appAsar'] = null
  let unpacked: WindowsNsisAbTreeIdentity | null = null

  try {
    application = identifyWindowsNsisAbTree(root, normalizedIgnoredPaths)
  } catch (cause) {
    errors.push(`application tree is unreadable: ${message(cause)}`)
  }

  try {
    executable = identifyWindowsNsisAbFile(executablePath, root)
    const descriptor = openSync(executablePath, 'r')
    const headerBuffer = Buffer.alloc(2)
    try {
      readSync(descriptor, headerBuffer, 0, headerBuffer.byteLength, 0)
    } finally {
      closeSync(descriptor)
    }
    const header = headerBuffer.toString('ascii')
    if (header !== 'MZ') errors.push('DSH Desktop.exe does not have a Windows PE header')
  } catch (cause) {
    errors.push(`application executable is unavailable: ${message(cause)}`)
  }

  try {
    resources = identifyWindowsNsisAbTree(
      resourcesPath,
      descendantIgnoredPaths(normalizedIgnoredPaths, 'resources/'),
    )
  } catch (cause) {
    errors.push(`resources tree is unreadable: ${message(cause)}`)
  }

  try {
    const entries = listPackage(asarPath, { isPack: false })
      .map(entry => entry.replace(/^[/\\]+/u, '').replaceAll('\\', '/'))
    for (const required of ['package.json', 'lib/main.js']) {
      if (!entries.includes(required)) errors.push(`app.asar is missing ${required}`)
    }
    let packageName: string | null = null
    try {
      const manifest: unknown = JSON.parse(extractFile(asarPath, 'package.json').toString('utf8'))
      if (typeof manifest === 'object' && manifest !== null && 'name' in manifest
          && typeof manifest.name === 'string') {
        packageName = manifest.name
      } else {
        errors.push('app.asar package.json has no package name')
      }
    } catch (cause) {
      errors.push(`app.asar package.json is unreadable: ${message(cause)}`)
    }
    appAsar = {
      ...identifyWindowsNsisAbFile(asarPath, root),
      entryCount: entries.length,
      packageName,
    }
  } catch (cause) {
    errors.push(`app.asar is unreadable: ${message(cause)}`)
  }

  if (existsSync(unpackedPath)) {
    try {
      const stat = lstatSync(unpackedPath)
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        errors.push('app.asar.unpacked is not a real directory')
      } else {
        unpacked = identifyWindowsNsisAbTree(
          unpackedPath,
          descendantIgnoredPaths(normalizedIgnoredPaths, 'resources/app.asar.unpacked/'),
        )
      }
    } catch (cause) {
      errors.push(`app.asar.unpacked is unreadable: ${message(cause)}`)
    }
  }

  return {
    installRoot: root,
    valid: errors.length === 0,
    errors,
    application,
    executable,
    resources,
    appAsar,
    unpacked,
  }
}

export interface InstalledWindowsAppArguments {
  readonly installRoot: string
  readonly ignoreRelativePaths: readonly string[]
}

export function parseInstalledWindowsAppArguments(
  argv: readonly string[],
): InstalledWindowsAppArguments {
  let installRoot: string | undefined
  const ignoreRelativePaths: string[] = []
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (argument !== '--install-root' && argument !== '--ignore-relative-path') {
      throw new Error(`unexpected argument: ${argument ?? ''}`)
    }
    const value = argv[index + 1]
    if (value === undefined || value.length === 0 || value.startsWith('--')) {
      throw new Error(`${argument} requires a value`)
    }
    index += 1
    if (argument === '--install-root') {
      if (installRoot !== undefined) throw new Error('--install-root may only be provided once')
      installRoot = value
    } else {
      ignoreRelativePaths.push(normalizeWindowsNsisAbRelativePath(value))
    }
  }
  if (installRoot === undefined) {
    throw new Error(
      'usage: node inspect-windows-installed-app.ts --install-root <directory> '
        + '[--ignore-relative-path <application-relative-path>]...',
    )
  }
  return { installRoot, ignoreRelativePaths: [...new Set(ignoreRelativePaths)] }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const arguments_ = parseInstalledWindowsAppArguments(process.argv.slice(2))
    const result = inspectInstalledWindowsApp(
      arguments_.installRoot,
      arguments_.ignoreRelativePaths,
    )
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    if (!result.valid) process.exitCode = 2
  } catch (error) {
    process.stdout.write(`${JSON.stringify({
      installRoot: null,
      valid: false,
      errors: [message(error)],
      application: null,
      executable: null,
      resources: null,
      appAsar: null,
      unpacked: null,
    }, null, 2)}\n`)
    process.exitCode = 2
  }
}
