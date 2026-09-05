/** Verify the unsigned Linux x64 AppImage and unpacked application structure. */

import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ELF_MAGIC = Buffer.from([0x7f, 0x45, 0x4c, 0x46])

/** Verify that a buffer starts with a Linux ELF identification header. */
export function assertElfIdentification(buffer: Buffer, label: string, source: string): void {
  if (buffer.byteLength < 4 || !buffer.subarray(0, 4).equals(ELF_MAGIC)) {
    throw new Error(`${label} does not have an ELF header: ${source}`)
  }
}

/** Paths returned after Linux AppImage verification succeeds. */
export interface LinuxAppImageArtifacts {
  /** AppImage artifact path. */
  readonly appImagePath: string
  /** Unpacked application executable path. */
  readonly applicationPath: string
}

/** Injectable Linux artifact verification boundary. */
export interface LinuxArtifactVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
  /** Probe a physical artifact path. */
  readonly exists: (path: string) => boolean
  /** Report physical metadata for an artifact path. */
  readonly stat: (path: string) => {
    readonly size: number
    readonly isFile: boolean
    readonly mode: number
  }
  /** Read the ELF identification prefix of a physical artifact. */
  readonly readPrefix: (path: string, byteLength: number) => Buffer
}

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

function readPrefix(path: string, byteLength: number): Buffer {
  const descriptor = openSync(path, 'r')
  const prefix = Buffer.alloc(byteLength)
  try {
    const bytesRead = readSync(descriptor, prefix, 0, prefix.byteLength, 0)
    return bytesRead === prefix.byteLength ? prefix : prefix.subarray(0, bytesRead)
  } finally {
    closeSync(descriptor)
  }
}

function defaultOptions(): LinuxArtifactVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    desktopRoot,
    version: readVersion(desktopRoot),
    exists: path => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
    stat: path => {
      const result = statSync(path)
      return { size: result.size, isFile: result.isFile(), mode: result.mode }
    },
    readPrefix,
  }
}

/**
 * Verify the exact x64 AppImage and unpacked application executable.
 * @param options - Artifact root, expected product version, and probe seams.
 * @returns The verified artifact paths.
 */
export function verifyLinuxAppImage(
  options: LinuxArtifactVerificationOptions = defaultOptions(),
): LinuxAppImageArtifacts {
  const distDir = join(options.desktopRoot, 'dist')
  const appImagePath = join(
    distDir,
    `DSH-Desktop-${options.version}-x64.AppImage`,
  )
  const unpackedRoot = join(distDir, 'linux-unpacked')
  const applicationPath = join(unpackedRoot, 'dsh-desktop')

  for (const [path, label] of [
    [appImagePath, 'Linux AppImage'],
    [applicationPath, 'unpacked Linux application'],
  ] as const) {
    if (!options.exists(path)) {
      throw new Error(`${label} is not a non-empty regular file: ${path}`)
    }
    const artifactStat = options.stat(path)
    if (!artifactStat.isFile || artifactStat.size === 0) {
      throw new Error(`${label} is not a non-empty regular file: ${path}`)
    }
    if ((artifactStat.mode & 0o111) === 0) {
      throw new Error(`${label} is not executable: ${path}`)
    }
    assertElfIdentification(options.readPrefix(path, 4), label, path)
  }

  const appAsarPath = join(unpackedRoot, 'resources', 'app.asar')
  if (!options.exists(appAsarPath)) {
    throw new Error(`packaged application is missing ${appAsarPath}`)
  }
  const appAsarStat = options.stat(appAsarPath)
  if (!appAsarStat.isFile || appAsarStat.size === 0) {
    throw new Error(`packaged application archive is empty: ${appAsarPath}`)
  }

  return { appImagePath, applicationPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyLinuxAppImage()
    console.log(`Linux AppImage verification passed: ${verified.appImagePath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
