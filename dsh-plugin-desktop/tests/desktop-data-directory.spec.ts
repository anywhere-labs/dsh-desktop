import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, parse } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  assertDesktopDataDirectoryCommandGeneration,
  DesktopDataDirectoryError,
  inspectDesktopDataDirectoryTarget,
  readDesktopDataDirectoryState,
  resolveDesktopDataDirectory,
  selectDesktopDataDirectory,
} from '../src/desktop-data-directory.ts'
import { acquireDesktopDataOperationLock } from '../src/desktop-data-operation-lock.ts'

const temporaryDirectories: string[] = []

function temporaryDirectory(): string {
  const path = mkdtempSync(join(tmpdir(), 'dsh-desktop-data-directory-'))
  temporaryDirectories.push(path)
  return path
}

afterEach(() => {
  for (const path of temporaryDirectories.splice(0)) rmSync(path, { recursive: true, force: true })
})

function createDesktopHome(home: string, marker: string): void {
  mkdirSync(join(home, 'profiles', 'desktop'), { recursive: true })
  writeFileSync(join(home, 'profiles', 'desktop', 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop',
    private: true,
    dsh: { profile: { bundles: [] } },
  })}\n`)
  writeFileSync(join(home, 'marker.txt'), `${marker}\n`)
}

function fixture(): {
  readonly root: string
  readonly userData: string
  readonly source: string
  readonly emptyTarget: string
  readonly existingTarget: string
} {
  const root = temporaryDirectory()
  const userData = join(root, 'user-data')
  const source = join(root, 'source-home')
  const emptyTarget = join(root, 'empty-target')
  const existingTarget = join(root, 'existing-target')
  mkdirSync(userData)
  mkdirSync(emptyTarget)
  createDesktopHome(source, 'source')
  createDesktopHome(existingTarget, 'existing')
  return { root, userData, source, emptyTarget, existingTarget }
}

describe('Desktop DSH data directory', () => {
  it('keeps fallback precedence until Desktop selects a private locator', () => {
    const { userData, source } = fixture()
    expect(resolveDesktopDataDirectory(userData, source, 'default')).toEqual({
      homeDir: source,
      previousHome: null,
      generation: 0,
      source: 'default',
    })
    expect(resolveDesktopDataDirectory(userData, source, 'environment').source).toBe('environment')
  })

  it('accepts an empty folder or existing Desktop-compatible DSH Home', () => {
    const { source, emptyTarget, existingTarget } = fixture()
    expect(inspectDesktopDataDirectoryTarget(source, emptyTarget)).toEqual({
      targetHome: emptyTarget,
      kind: 'empty',
    })
    expect(inspectDesktopDataDirectoryTarget(source, existingTarget)).toEqual({
      targetHome: existingTarget,
      kind: 'existing',
    })
  })

  it('rejects non-DSH, overlapping, root, and symlink targets', () => {
    const { root, source, emptyTarget } = fixture()
    writeFileSync(join(emptyTarget, 'ordinary.txt'), 'not a DSH Home\n')
    expect(() => inspectDesktopDataDirectoryTarget(source, emptyTarget)).toThrowError(
      expect.objectContaining({ code: 'target-invalid' }),
    )
    expect(() => inspectDesktopDataDirectoryTarget(source, source)).toThrowError(
      expect.objectContaining({ code: 'path-conflict' }),
    )
    const child = join(source, 'nested-target')
    mkdirSync(child)
    expect(() => inspectDesktopDataDirectoryTarget(source, child)).toThrowError(
      expect.objectContaining({ code: 'path-conflict' }),
    )
    expect(() => inspectDesktopDataDirectoryTarget(source, parse(root).root)).toThrowError(
      expect.objectContaining({ code: 'path-conflict' }),
    )
    const realTarget = join(root, 'real-target')
    const link = join(root, 'target-link')
    mkdirSync(realTarget)
    symlinkSync(realTarget, link, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => inspectDesktopDataDirectoryTarget(source, link)).toThrowError(
      expect.objectContaining({ code: 'target-unavailable' }),
    )
  })

  it('selects an empty folder without changing either directory', async () => {
    const { userData, source, emptyTarget } = fixture()
    const initial = resolveDesktopDataDirectory(userData, source, 'default')
    const sourceBefore = readFileSync(join(source, 'marker.txt'), 'utf8')

    const result = await selectDesktopDataDirectory(userData, initial, emptyTarget, {
      now: () => Date.UTC(2026, 8, 5),
    })

    expect(result.target.kind).toBe('empty')
    expect(result.location).toEqual({
      homeDir: emptyTarget,
      previousHome: source,
      generation: 1,
      source: 'desktop',
    })
    expect(readFileSync(join(source, 'marker.txt'), 'utf8')).toBe(sourceBefore)
    expect(readdirSync(emptyTarget)).toEqual([])
    expect(readDesktopDataDirectoryState(userData)).toMatchObject({
      activeHome: emptyTarget,
      previousHome: source,
      generation: 1,
      updatedAt: '2026-09-05T00:00:00.000Z',
    })
  })

  it('loads an existing DSH Home as-is without copying data from the old directory', async () => {
    const { userData, source, existingTarget } = fixture()
    const initial = resolveDesktopDataDirectory(userData, source, 'default')

    const result = await selectDesktopDataDirectory(userData, initial, existingTarget)

    expect(result.target.kind).toBe('existing')
    expect(readFileSync(join(source, 'marker.txt'), 'utf8')).toBe('source\n')
    expect(readFileSync(join(existingTarget, 'marker.txt'), 'utf8')).toBe('existing\n')
    expect(existsSync(join(existingTarget, 'settings.yaml'))).toBe(false)
    assertDesktopDataDirectoryCommandGeneration(userData, existingTarget, 1)
    expect(() => assertDesktopDataDirectoryCommandGeneration(userData, source, 0)).toThrow(
      'older DSH data directory',
    )
  })

  it('creates a missing default target as an empty directory before selecting it', async () => {
    const { root, userData, source } = fixture()
    const initial = resolveDesktopDataDirectory(userData, source, 'default')
    const defaultTarget = join(root, '.dsh')

    const result = await selectDesktopDataDirectory(userData, initial, defaultTarget, {
      createIfMissing: true,
    })

    expect(result.target).toEqual({ targetHome: defaultTarget, kind: 'empty' })
    expect(readdirSync(defaultTarget)).toEqual([])
    expect(readFileSync(join(source, 'marker.txt'), 'utf8')).toBe('source\n')
  })

  it('does not change the locator when cancelled or stale', async () => {
    const { root, userData, source, emptyTarget } = fixture()
    const initial = resolveDesktopDataDirectory(userData, source, 'default')
    const aborted = new AbortController()
    aborted.abort()
    await expect(selectDesktopDataDirectory(userData, initial, emptyTarget, {
      signal: aborted.signal,
    })).rejects.toMatchObject({ name: 'AbortError' })
    expect(readDesktopDataDirectoryState(userData)).toBeUndefined()

    const selected = await selectDesktopDataDirectory(userData, initial, emptyTarget)
    const nextTarget = join(root, 'next-target')
    mkdirSync(nextTarget)
    await expect(selectDesktopDataDirectory(userData, initial, nextTarget)).rejects.toThrowError(
      DesktopDataDirectoryError,
    )
    const missingTarget = join(root, 'missing-target')
    await expect(selectDesktopDataDirectory(userData, initial, missingTarget, {
      createIfMissing: true,
    })).rejects.toMatchObject({ code: 'busy' })
    expect(existsSync(missingTarget)).toBe(false)
    expect(readDesktopDataDirectoryState(userData)?.activeHome).toBe(selected.location.homeDir)
  })

  it('fails loudly when the selected custom directory disappears', async () => {
    const { userData, source, emptyTarget } = fixture()
    const initial = resolveDesktopDataDirectory(userData, source, 'default')
    await selectDesktopDataDirectory(userData, initial, emptyTarget)
    rmSync(emptyTarget, { recursive: true })
    expect(() => resolveDesktopDataDirectory(userData, source, 'default')).toThrow(
      'configured DSH home is unavailable',
    )
  })

  it('serializes Desktop data mutations across independent callers', () => {
    const { userData } = fixture()
    const first = acquireDesktopDataOperationLock(userData, 'first operation')
    expect(() => acquireDesktopDataOperationLock(userData, 'second operation')).toThrowError(
      DesktopDataDirectoryError,
    )
    first.release()
    const second = acquireDesktopDataOperationLock(userData, 'second operation')
    second.release()
  })

  it('preserves private locator permissions', async () => {
    const { userData, source, emptyTarget } = fixture()
    chmodSync(userData, 0o700)
    const initial = resolveDesktopDataDirectory(userData, source, 'default')
    await selectDesktopDataDirectory(userData, initial, emptyTarget)
    if (process.platform !== 'win32') {
      expect(lstatSync(join(userData, 'data-directory', 'state.json')).mode & 0o777).toBe(0o600)
    }
  })
})
