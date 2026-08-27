/** Verify the unsigned Linux x64 AppImage and deb artifacts sealed by electron-builder. */

import { readFileSync } from 'node:fs'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const AR_ARCHIVE_MAGIC = '!<arch>\n'

/** Injectable filesystem and command boundaries for Linux package verification. */
export interface LinuxPackageVerificationOptions {
  /** Directory containing the electron-builder Linux artifacts. */
  readonly distDir: string
  /** Product version expected in artifact filenames. */
  readonly version: string
  /** Candidate architectures that Linux electron-builder may emit. */
  readonly archNames: readonly string[]
  /** Main executable basename inside linux-unpacked. */
  readonly executableName: string
  /** Probe a physical path. */
  readonly exists: (path: string) => boolean
  /** Report file metadata for a physical path. */
  readonly stat: (path: string) => { readonly size: number, readonly isFile: boolean, readonly mode: number }
  /** Read the beginning of a physical file. */
  readonly readPrefix: (path: string, length: number) => Buffer
}

function statInfo(path: string): { readonly size: number, readonly isFile: boolean, readonly mode: number } {
  const result = statSync(path)
  return { size: result.size, isFile: result.isFile(), mode: result.mode }
}

function readPrefix(path: string, length: number): Buffer {
  return readFileSync(path).subarray(0, length)
}

function defaultOptions(): LinuxPackageVerificationOptions {
  const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as { version?: unknown }
  if (typeof manifest.version !== 'string') throw new Error('dsh-plugin-desktop has no string version')
  return {
    distDir: process.argv[2] === undefined
      ? join(packageRoot, 'dist', 'linux')
      : resolve(process.argv[2]),
    version: manifest.version,
    executableName: 'dsh-desktop',
    archNames: ['x86_64', 'amd64', 'x64'],
    exists: existsSync,
    stat: statInfo,
    readPrefix,
  }
}

/**
 * Assert that an artifact is a regular, non-empty, executable file.
 * @param options - Filesystem boundary.
 * @param path - Absolute artifact path.
 * @param label - Human-readable artifact description.
 */
function assertRegularFile(
  options: LinuxPackageVerificationOptions,
  path: string,
  label: string,
): void {
  if (!options.exists(path)) {
    throw new Error(`Linux package is missing the ${label}: ${path}`)
  }
  const info = options.stat(path)
  if (!info.isFile || info.size === 0) {
    throw new Error(`Linux package has an invalid ${label}: ${path}`)
  }
}

/**
 * Verify the unsigned Linux x64 artifacts produced by electron-builder.
 * @param options - Filesystem boundary.
 * @returns The verified artifact paths.
 */
export function verifyLinuxPackage(
  options: LinuxPackageVerificationOptions = defaultOptions(),
): { readonly appImage: string, readonly deb: string } {
  const candidates = options.archNames.map(arch => ({
    appImage: join(options.distDir, `DSH-Desktop-${options.version}-${arch}.AppImage`),
    deb: join(options.distDir, `DSH-Desktop-${options.version}-${arch}.deb`),
  }))
  const appImage = candidates.find(candidate => options.exists(candidate.appImage))?.appImage
  const deb = candidates.find(candidate => options.exists(candidate.deb))?.deb
  if (appImage === undefined) {
    throw new Error(`Linux package is missing the AppImage for ${options.version}`)
  }
  if (deb === undefined) {
    throw new Error(`Linux package is missing the deb package for ${options.version}`)
  }

  assertRegularFile(options, appImage, 'AppImage')
  const appImageStat = options.stat(appImage)
  if ((appImageStat.mode & 0o111) === 0) {
    throw new Error(`Linux AppImage is not executable: ${appImage}`)
  }

  assertRegularFile(options, deb, 'deb package')
  const debPrefix = options.readPrefix(deb, AR_ARCHIVE_MAGIC.length).toString('ascii')
  if (!debPrefix.startsWith(AR_ARCHIVE_MAGIC)) {
    throw new Error(`Linux deb package is not an ar archive: ${deb}`)
  }

  const unpackedRoot = join(options.distDir, 'linux-unpacked')
  if (!options.exists(unpackedRoot)) {
    throw new Error(`Linux package is missing the unpacked application: ${unpackedRoot}`)
  }
  const executable = join(unpackedRoot, options.executableName)
  assertRegularFile(options, executable, 'unpacked executable')
  const executableStat = options.stat(executable)
  if ((executableStat.mode & 0o111) === 0) {
    throw new Error(`Linux unpacked executable is not executable: ${executable}`)
  }
  const appAsar = join(unpackedRoot, 'resources', 'app.asar')
  assertRegularFile(options, appAsar, 'unpacked application archive')

  return { appImage, deb }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = verifyLinuxPackage()
    console.log(`Linux package verification passed: ${verified.appImage}, ${verified.deb}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
