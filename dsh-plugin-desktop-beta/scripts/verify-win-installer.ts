import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { unzipSync } from 'fflate'
import { assertWindowsArchitecture, assertWindowsArchitectureBuffer, windowsArchitecture, windowsUnpackedDirectory } from '../../dsh-plugin-desktop/scripts/windows-architecture.ts'
import { assertAppImage, assertDebArchive, assertElfExecutable } from '../../dsh-plugin-desktop/scripts/verify-linux-artifacts.ts'
import { assertPortableExecutable } from '../../dsh-plugin-desktop/scripts/verify-win-installer.ts'
import { linuxPackageTargets } from './package-targets.ts'
const root = fileURLToPath(new URL('..', import.meta.url))
const { version: sourceVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// `DSH_BETA_BUILD_VERSION` lets a drill build a release whose version differs
// from the source tree (see scripts/package.ts); electron-builder names the
// artifact after that override, so the verifier must follow it too.
const version = process.env.DSH_BETA_BUILD_VERSION ?? sourceVersion
const verifyMode = process.env.DSH_PACKAGE_VERIFY_MODE ?? 'win'
if (verifyMode === 'win-portable') {
  const archivePath = join(root, 'dist', `DSH-Desktop-Beta-${version}-${process.arch}-Portable.zip`)
  const fd = openSync(archivePath, 'r')
  const header = Buffer.alloc(4)
  try {
    readSync(fd, header, 0, 4, 0)
  } finally {
    closeSync(fd)
  }
  if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error(`Next portable archive is not a ZIP archive: ${archivePath}`)
  const binary = unzipSync(readFileSync(archivePath), { filter: entry => entry.name === 'DSH Desktop Beta.exe' })['DSH Desktop Beta.exe']
  if (binary === undefined) throw new Error(`Portable archive has no application executable: ${archivePath}`)
  assertWindowsArchitectureBuffer(Buffer.from(binary.buffer, binary.byteOffset, binary.byteLength), windowsArchitecture(), archivePath)
  assertPortableExecutable(join(root, 'dist', windowsUnpackedDirectory(), 'DSH Desktop Beta.exe'), 'Next application')
  assertWindowsArchitecture(join(root, 'dist', windowsUnpackedDirectory(), 'DSH Desktop Beta.exe'), process.arch === 'arm64' ? 'arm64' : 'x64')
} else if (verifyMode === 'linux') {
  // Linux packages the host CPU; electron-builder spells x64 as x86_64 and amd64 and keeps arm64 as is.
  const arm64 = process.arch === 'arm64'
  const targets = linuxPackageTargets(process.env)
  if (targets.includes('AppImage')) assertAppImage(join(root, 'dist', `DSH-Desktop-Beta-${version}-${arm64 ? 'arm64' : 'x86_64'}.AppImage`), 'Next AppImage')
  if (targets.includes('deb')) assertDebArchive(join(root, 'dist', `DSH-Desktop-Beta-${version}-${arm64 ? 'arm64' : 'amd64'}.deb`), 'Next Debian package')
  assertElfExecutable(join(root, 'dist', arm64 ? 'linux-arm64-unpacked' : 'linux-unpacked', 'dsh-desktop-beta'), 'Next Linux application')
} else {
  assertPortableExecutable(join(root, 'dist', `DSH-Desktop-Beta-${version}-${process.arch}-Setup.exe`), 'Next NSIS installer')
  assertPortableExecutable(join(root, 'dist', windowsUnpackedDirectory(), 'DSH Desktop Beta.exe'), 'Next application')
  assertWindowsArchitecture(join(root, 'dist', windowsUnpackedDirectory(), 'DSH Desktop Beta.exe'), process.arch === 'arm64' ? 'arm64' : 'x64')
}
