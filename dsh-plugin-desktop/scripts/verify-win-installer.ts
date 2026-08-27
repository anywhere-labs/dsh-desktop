/** Verify the unsigned Windows x64 NSIS installer and its embedded application payload. */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getPath7za } from 'app-builder-lib/out/toolsets/7zip.js'
import {
  verifyPackagedAsar,
  verifyUnpackedArchiveMirror,
} from './verify-packaged-runtime.ts'

/** Verify a complete in-memory Windows PE image. */
export function assertPortableExecutableBuffer(data: Buffer, label: string, source: string): void {
  if (data.byteLength < 68 || data.subarray(0, 2).toString('ascii') !== 'MZ') {
    throw new Error(`${label} does not have a Windows PE header: ${source}`)
  }
  const peOffset = data.readUInt32LE(0x3c)
  if (peOffset > data.byteLength - 4) {
    throw new Error(`${label} has an invalid Windows PE offset: ${source}`)
  }
  if (!data.subarray(peOffset, peOffset + 4).equals(Buffer.from('PE\0\0'))) {
    throw new Error(`${label} does not have a Windows PE signature: ${source}`)
  }
}

/** Paths returned after Windows installer verification succeeds. */
export interface WindowsInstallerArtifacts {
  /** NSIS installer path. */
  readonly installerPath: string
  /** Unpacked application executable path. */
  readonly applicationPath: string
}

/** Injectable Windows installer verification boundary. */
export interface WindowsInstallerVerificationOptions {
  /** Desktop package root containing package.json and dist. */
  readonly desktopRoot: string
  /** Product version embedded in the expected artifact name. */
  readonly version: string
  /** Injectable verifier for the application archive embedded in the installer. */
  readonly verifyPayload?: WindowsInstallerPayloadVerifier
}

/** Verify one NSIS installer's embedded application archive against the staged build. */
export type WindowsInstallerPayloadVerifier = (
  installerPath: string,
  stagedApplicationRoot: string,
) => Promise<void>

function readVersion(desktopRoot: string): string {
  const manifest = JSON.parse(readFileSync(join(desktopRoot, 'package.json'), 'utf8')) as {
    version?: unknown
  }
  if (typeof manifest.version !== 'string' || manifest.version.length === 0) {
    throw new Error(`desktop package at ${desktopRoot} has no valid version`)
  }
  return manifest.version
}

/** Verify that a generated Windows artifact has a valid PE header. */
export function assertPortableExecutable(path: string, label: string): void {
  const stat = statSync(path)
  if (!stat.isFile() || stat.size < 68) {
    throw new Error(`${label} is not a non-empty regular file: ${path}`)
  }
  const descriptor = openSync(path, 'r')
  const dosHeader = Buffer.alloc(64)
  try {
    const dosBytesRead = readSync(descriptor, dosHeader, 0, dosHeader.byteLength, 0)
    if (dosBytesRead !== dosHeader.byteLength || dosHeader.subarray(0, 2).toString('ascii') !== 'MZ') {
      throw new Error(`${label} does not have a Windows PE header: ${path}`)
    }
    const peOffset = dosHeader.readUInt32LE(0x3c)
    if (peOffset > stat.size - 4) {
      throw new Error(`${label} has an invalid Windows PE offset: ${path}`)
    }
    const signature = Buffer.alloc(4)
    const signatureBytesRead = readSync(descriptor, signature, 0, signature.byteLength, peOffset)
    if (signatureBytesRead !== signature.byteLength || !signature.equals(Buffer.from('PE\0\0'))) {
      throw new Error(`${label} does not have a Windows PE signature: ${path}`)
    }
  } finally {
    closeSync(descriptor)
  }
}

function normalizeArchivePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/^\/+/, '').replace(/\/+$/, '')
}

/** Parse the stable `7za l -ba -slt` path records into normalized archive entries. */
export function parseSevenZipArchiveEntries(output: string): ReadonlySet<string> {
  const entries = new Set<string>()
  for (const line of output.split(/\r?\n/)) {
    if (!line.startsWith('Path = ')) continue
    const entry = normalizeArchivePath(line.slice('Path = '.length))
    if (entry.length > 0) entries.add(entry)
  }
  if (entries.size === 0) {
    throw new Error('Windows NSIS installer contains no readable application archive entries')
  }
  return entries
}

/** Require the embedded application archive to carry the complete physical ASAR mirror. */
export function verifyWindowsInstallerPayloadMirror(
  payloadEntries: ReadonlySet<string>,
  asarEntries: ReadonlySet<string>,
): void {
  const normalizedPayloadEntries = new Set([...payloadEntries].map(normalizeArchivePath))
  const archivePath = 'resources/app.asar'
  if (!normalizedPayloadEntries.has(archivePath)) {
    throw new Error(`Windows NSIS installer payload is missing ${archivePath}`)
  }
  const unpackedRoot = 'resources/app.asar.unpacked'
  verifyUnpackedArchiveMirror(
    asarEntries,
    unpackedRoot,
    path => normalizedPayloadEntries.has(normalizeArchivePath(path)),
  )
}

function runSevenZip(sevenZipPath: string, args: readonly string[]): string {
  const result = spawnSync(sevenZipPath, args, {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  })
  if (result.error !== undefined) {
    throw new Error(`failed to inspect Windows NSIS installer with ${sevenZipPath}`, {
      cause: result.error,
    })
  }
  // 7-Zip reports the expected NSIS trailer as warning exit code 1 after
  // locating electron-builder's embedded app-64.7z. Codes >= 2 are fatal.
  if (result.status === null || result.status > 1) {
    const detail = result.stderr.trim() || result.stdout.trim()
    throw new Error(
      `failed to inspect Windows NSIS installer with ${sevenZipPath}`
      + (detail.length > 0 ? `: ${detail}` : ''),
    )
  }
  return result.stdout
}

function sha256(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function assertPayloadMatchesStaging(payloadPath: string, stagedPath: string): void {
  const payloadSize = statSync(payloadPath).size
  const stagedSize = statSync(stagedPath).size
  if (payloadSize !== stagedSize || sha256(payloadPath) !== sha256(stagedPath)) {
    throw new Error(
      `Windows NSIS installer payload ${payloadPath} does not match staged artifact ${stagedPath}`,
    )
  }
}

/**
 * Inspect electron-builder's embedded app-64.7z rather than trusting win-unpacked.
 *
 * The pinned electron-builder 7-Zip toolset finds the embedded 7z stream directly
 * inside the NSIS executable. This catches collector or release-provenance gaps
 * that an afterPack check of dist/win-unpacked cannot observe.
 */
export async function verifyWindowsInstallerPayload(
  installerPath: string,
  stagedApplicationRoot: string,
): Promise<void> {
  const extractionRoot = mkdtempSync(join(tmpdir(), 'dsh-win-installer-payload-'))
  try {
    const sevenZipPath = await getPath7za()
    const listing = runSevenZip(sevenZipPath, ['l', '-ba', '-slt', installerPath])
    const payloadEntries = parseSevenZipArchiveEntries(listing)
    runSevenZip(sevenZipPath, [
      'x',
      '-y',
      '-bb0',
      '-bd',
      `-o${extractionRoot}`,
      installerPath,
      'DSH Desktop.exe',
      'resources\\app.asar',
    ])

    const payloadApplicationPath = join(extractionRoot, 'DSH Desktop.exe')
    const payloadAsarPath = join(extractionRoot, 'resources', 'app.asar')
    assertPortableExecutable(payloadApplicationPath, 'embedded Windows application')
    assertPayloadMatchesStaging(
      payloadAsarPath,
      join(stagedApplicationRoot, 'resources', 'app.asar'),
    )
    const asarEntries = verifyPackagedAsar(payloadAsarPath)
    verifyWindowsInstallerPayloadMirror(payloadEntries, asarEntries)
  } finally {
    rmSync(extractionRoot, { recursive: true, force: true })
  }
}

function defaultOptions(): WindowsInstallerVerificationOptions {
  const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
  return {
    desktopRoot,
    version: readVersion(desktopRoot),
  }
}

/**
 * Verify the exact NSIS installer and unpacked application executable.
 * @param options - Artifact root and expected product version.
 * @returns The verified artifact paths.
 */
export async function verifyWindowsInstaller(
  options: WindowsInstallerVerificationOptions = defaultOptions(),
): Promise<WindowsInstallerArtifacts> {
  const distDir = join(options.desktopRoot, 'dist')
  const installerPath = join(
    distDir,
    `DSH-Desktop-${options.version}-x64-Setup.exe`,
  )
  const applicationPath = join(distDir, 'win-unpacked', 'DSH Desktop.exe')

  assertPortableExecutable(installerPath, 'Windows NSIS installer')
  assertPortableExecutable(applicationPath, 'unpacked Windows application')
  await (options.verifyPayload ?? verifyWindowsInstallerPayload)(
    installerPath,
    join(distDir, 'win-unpacked'),
  )
  return { installerPath, applicationPath }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  try {
    const verified = await verifyWindowsInstaller()
    console.log(`Windows installer verification passed: ${verified.installerPath}`)
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  }
}
