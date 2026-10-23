import { closeSync, openSync, readFileSync, readSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertAppImage, assertDebArchive, assertElfExecutable } from '../../dsh-plugin-desktop/scripts/verify-linux-artifacts.ts'
import { assertPortableExecutable } from '../../dsh-plugin-desktop/scripts/verify-win-installer.ts'
const root = fileURLToPath(new URL('..', import.meta.url))
const { version: sourceVersion } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
// `DSH_BETA_BUILD_VERSION` lets a drill build a release whose version differs
// from the source tree (see scripts/package.ts); electron-builder names the
// artifact after that override, so the verifier must follow it too.
const version = process.env.DSH_BETA_BUILD_VERSION ?? sourceVersion
const verifyMode = process.env.DSH_PACKAGE_VERIFY_MODE ?? 'win'
if (verifyMode === 'win-portable') {
  const archivePath = join(root, 'dist', `DSH-Desktop-Beta-${version}-x64-Portable.zip`)
  const fd = openSync(archivePath, 'r')
  const header = Buffer.alloc(4)
  try {
    readSync(fd, header, 0, 4, 0)
  } finally {
    closeSync(fd)
  }
  if (!header.equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) throw new Error(`Next portable archive is not a ZIP archive: ${archivePath}`)
  assertPortableExecutable(join(root, 'dist', 'win-unpacked', 'DSH Desktop Beta.exe'), 'Next application')
} else if (verifyMode === 'linux') {
  assertAppImage(join(root, 'dist', `DSH-Desktop-Beta-${version}-x86_64.AppImage`), 'Next AppImage')
  assertDebArchive(join(root, 'dist', `DSH-Desktop-Beta-${version}-amd64.deb`), 'Next Debian package')
  assertElfExecutable(join(root, 'dist', 'linux-unpacked', 'dsh-desktop-beta'), 'Next Linux application')
} else {
  assertPortableExecutable(join(root, 'dist', `DSH-Desktop-Beta-${version}-x64-Setup.exe`), 'Next NSIS installer')
  assertPortableExecutable(join(root, 'dist', 'win-unpacked', 'DSH Desktop Beta.exe'), 'Next application')
}
