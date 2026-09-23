import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyLinuxArtifacts } from '../scripts/verify-linux-artifacts.ts'

const temporaryRoots: string[] = []

function appImage(): Buffer {
  const image = Buffer.alloc(4096)
  image[0] = 0x7f
  image.write('ELF', 1, 'ascii')
  image.write('AI\x02', 8, 'binary')
  return image
}

function debArchive(): Buffer {
  const archive = Buffer.alloc(256)
  archive.write('!<arch>\n', 0, 'ascii')
  archive.write('debian-binary/       0        ', 8, 'ascii')
  return archive
}

function fixture(version = '2.0.0'): {
  readonly root: string
  readonly appImage: string
  readonly deb: string
  readonly application: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-linux-artifacts-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist')
  const unpacked = join(dist, 'linux-unpacked')
  mkdirSync(unpacked, { recursive: true })
  const appImagePath = join(dist, `DSH-Desktop-Beta-${version}-x86_64.AppImage`)
  const debPath = join(dist, `DSH-Desktop-Beta-${version}-amd64.deb`)
  const application = join(unpacked, 'dsh-desktop-beta')
  writeFileSync(appImagePath, appImage(), { mode: 0o755 })
  chmodSync(appImagePath, 0o755)
  writeFileSync(debPath, debArchive())
  writeFileSync(application, appImage().subarray(0, 512), { mode: 0o755 })
  chmodSync(application, 0o755)
  return { root, appImage: appImagePath, deb: debPath, application }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Linux artifact verification', () => {
  it('accepts the exact versioned AppImage, Debian package, and unpacked application', () => {
    const value = fixture()

    expect(verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' })).toEqual({
      appImagePath: value.appImage,
      debPath: value.deb,
      applicationPath: value.application,
    })
  })

  it('rejects an AppImage from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('DSH-Desktop-Beta-2.0.0-x86_64.AppImage')
  })

  it('rejects an AppImage without the AppImage magic', () => {
    const value = fixture()
    const invalid = appImage()
    invalid.fill(0, 8, 11)
    writeFileSync(value.appImage, invalid)

    expect(() => verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have an AppImage magic')
  })

  it('rejects an unpacked application without an ELF header', () => {
    const value = fixture()
    const invalid = appImage().subarray(0, 512)
    invalid.fill(0, 0, 4)
    writeFileSync(value.application, invalid)

    expect(() => verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have an ELF header')
  })

  it('rejects an AppImage that lost its executable bit', () => {
    const value = fixture()
    chmodSync(value.appImage, 0o644)

    expect(() => verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('is not executable')
  })

  it('rejects a Debian package without an ar archive header', () => {
    const value = fixture()
    const invalid = debArchive()
    invalid.write('not-ar!!', 0, 'ascii')
    writeFileSync(value.deb, invalid)

    expect(() => verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not have an ar archive header')
  })

  it('rejects a Debian package whose first member is not debian-binary', () => {
    const value = fixture()
    const invalid = debArchive()
    invalid.write('control.tar.xz/     0        ', 8, 'ascii')
    writeFileSync(value.deb, invalid)

    expect(() => verifyLinuxArtifacts({ desktopRoot: value.root, version: '2.0.0' }))
      .toThrow('does not lead with a debian-binary member')
  })
})
