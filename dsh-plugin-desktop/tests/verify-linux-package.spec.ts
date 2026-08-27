import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { verifyLinuxPackage, type LinuxPackageVerificationOptions } from '../scripts/verify-linux-package.ts'

const temporaryRoots: string[] = []

const AR_MAGIC = Buffer.from('!<arch>\n')

function fixture(version = '2.0.0'): { readonly root: string } {
  const root = mkdtempSync(join(tmpdir(), 'dsh-linux-package-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist', 'linux')
  mkdirSync(join(dist, 'linux-unpacked', 'resources'), { recursive: true })
  writeFileSync(join(dist, `DSH-Desktop-${version}-x86_64.AppImage`), 'appimage')
  writeFileSync(join(dist, `DSH-Desktop-${version}-amd64.deb`), AR_MAGIC)
  writeFileSync(join(dist, 'linux-unpacked', 'dsh-desktop'), 'binary')
  writeFileSync(join(dist, 'linux-unpacked', 'resources', 'app.asar'), 'asar')
  chmodSync(join(dist, `DSH-Desktop-${version}-x86_64.AppImage`), 0o755)
  chmodSync(join(dist, 'linux-unpacked', 'dsh-desktop'), 0o755)
  return { root }
}

function options(root: string, version = '2.0.0'): LinuxPackageVerificationOptions {
  return {
    distDir: join(root, 'dist', 'linux'),
    version,
    executableName: 'dsh-desktop',
    archNames: ['x86_64', 'amd64', 'x64'],
    exists: path => {
      try {
        statSync(path)
        return true
      } catch {
        return false
      }
    },
    stat: path => {
      const result = statSync(path)
      return { size: result.size, isFile: result.isFile(), mode: result.mode }
    },
    readPrefix: (path, length) => readFileSync(path).subarray(0, length),
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Linux package artifact verification', () => {
  it('accepts valid AppImage, deb, and unpacked application', () => {
    const value = fixture()

    const result = verifyLinuxPackage(options(value.root))

    expect(result.appImage).toContain('DSH-Desktop-2.0.0-x86_64.AppImage')
    expect(result.deb).toContain('DSH-Desktop-2.0.0-amd64.deb')
  })

  it('rejects a missing AppImage artifact', () => {
    const value = fixture()
    rmSync(join(value.root, 'dist', 'linux', 'DSH-Desktop-2.0.0-x86_64.AppImage'))

    expect(() => verifyLinuxPackage(options(value.root)))
      .toThrow('missing the AppImage')
  })

  it('rejects a non-executable AppImage artifact', () => {
    const value = fixture()
    chmodSync(join(value.root, 'dist', 'linux', 'DSH-Desktop-2.0.0-x86_64.AppImage'), 0o644)

    expect(() => verifyLinuxPackage(options(value.root)))
      .toThrow('not executable')
  })

  it('rejects a deb artifact that is not an ar archive', () => {
    const value = fixture()
    writeFileSync(join(value.root, 'dist', 'linux', 'DSH-Desktop-2.0.0-amd64.deb'), 'not-an-archive')

    expect(() => verifyLinuxPackage(options(value.root)))
      .toThrow('not an ar archive')
  })

  it('rejects an unpacked application without an executable', () => {
    const value = fixture()
    rmSync(join(value.root, 'dist', 'linux', 'linux-unpacked', 'dsh-desktop'))

    expect(() => verifyLinuxPackage(options(value.root)))
      .toThrow('missing the unpacked executable')
  })

  it('rejects an unpacked application without app.asar', () => {
    const value = fixture()
    rmSync(join(value.root, 'dist', 'linux', 'linux-unpacked', 'resources', 'app.asar'))

    expect(() => verifyLinuxPackage(options(value.root)))
      .toThrow('missing the unpacked application archive')
  })
})
