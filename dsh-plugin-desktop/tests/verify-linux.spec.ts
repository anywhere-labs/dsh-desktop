import {
  chmodSync,
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  verifyLinuxAppImage,
  type LinuxArtifactVerificationOptions,
} from '../scripts/verify-linux.ts'

const temporaryRoots: string[] = []

function elfFile(): Buffer {
  const executable = Buffer.alloc(64)
  executable.writeUInt8(0x7f, 0)
  executable.write('ELF', 1, 'ascii')
  return executable
}

interface LinuxFixture {
  readonly root: string
  readonly appImage: string
  readonly application: string
  readonly appAsar: string
  readonly modeOverrides: Map<string, number>
}

function fixture(version = '2.0.0'): LinuxFixture {
  const root = mkdtempSync(join(tmpdir(), 'dsh-linux-appimage-'))
  temporaryRoots.push(root)
  const dist = join(root, 'dist')
  const unpacked = join(dist, 'linux-unpacked')
  const resources = join(unpacked, 'resources')
  mkdirSync(resources, { recursive: true })
  const modeOverrides = new Map<string, number>()
  const appImage = join(dist, `DSH-Desktop-${version}-x64.AppImage`)
  const application = join(unpacked, 'dsh-desktop')
  const appAsar = join(resources, 'app.asar')
  writeFileSync(appImage, elfFile())
  chmodSync(appImage, 0o755)
  modeOverrides.set(appImage, 0o755)
  writeFileSync(application, elfFile())
  chmodSync(application, 0o755)
  modeOverrides.set(application, 0o755)
  writeFileSync(appAsar, 'packed')
  return { root, appImage, application, appAsar, modeOverrides }
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

function options(
  root: string,
  modeOverrides: ReadonlyMap<string, number> = new Map(),
): LinuxArtifactVerificationOptions {
  return {
    desktopRoot: root,
    version: '2.0.0',
    exists: path => {
      try {
        return statSync(path).isFile()
      } catch {
        return false
      }
    },
    stat: path => {
      const result = statSync(path)
      return { size: result.size, isFile: result.isFile(), mode: modeOverrides.get(path) ?? result.mode }
    },
    readPrefix,
  }
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Linux AppImage artifact verification', () => {
  it('accepts the exact versioned AppImage and unpacked application', () => {
    const value = fixture()

    expect(verifyLinuxAppImage(options(value.root, value.modeOverrides))).toEqual({
      appImagePath: value.appImage,
      applicationPath: value.application,
    })
  })

  it('rejects a stale AppImage from a different version', () => {
    const value = fixture('1.9.0')

    expect(() => verifyLinuxAppImage(options(value.root, value.modeOverrides)))
      .toThrow('DSH-Desktop-2.0.0-x64.AppImage')
  })

  it('rejects an AppImage without an ELF header', () => {
    const value = fixture()
    writeFileSync(value.appImage, elfFile().fill(0, 0, 4))

    expect(() => verifyLinuxAppImage(options(value.root, value.modeOverrides)))
      .toThrow('does not have an ELF header')
  })

  it('rejects an unpacked application that is not executable', () => {
    const value = fixture()
    chmodSync(value.application, 0o644)
    value.modeOverrides.set(value.application, 0o644)

    expect(() => verifyLinuxAppImage(options(value.root, value.modeOverrides)))
      .toThrow('is not executable')
  })

  it('rejects an empty packaged application archive', () => {
    const value = fixture()
    writeFileSync(value.appAsar, '')

    expect(() => verifyLinuxAppImage(options(value.root, value.modeOverrides)))
      .toThrow('packaged application archive is empty')
  })
})
