import { chmod, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  DESKTOP_INSTALLATION_ID_HEADER,
  MAX_DESKTOP_INSTALLATION_ID_BYTES,
  assertDesktopInstallationId,
  desktopInstallationIdPath,
  getOrCreateDesktopInstallationId,
  parseDesktopInstallationId,
} from '../src/desktop-installation-id.ts'

const roots: string[] = []
const FIRST = '01234567-89ab-4cde-8f01-23456789abcd'
const SECOND = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'

async function userData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-installation-id-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('Desktop installation identity', () => {
  it('parses only canonical lowercase UUID v4 values', () => {
    expect(parseDesktopInstallationId(FIRST)).toBe(FIRST)
    expect(parseDesktopInstallationId('01234567-89AB-4CDE-8F01-23456789ABCD')).toBeUndefined()
    expect(parseDesktopInstallationId('01234567-89ab-1cde-8f01-23456789abcd')).toBeUndefined()
    expect(parseDesktopInstallationId(` ${FIRST}`)).toBeUndefined()
    expect(() => assertDesktopInstallationId('not-a-uuid')).toThrow('canonical lowercase UUID v4')
    expect(DESKTOP_INSTALLATION_ID_HEADER).toBe('X-DSH-Desktop-Installation-Id')
  })

  it('creates one private stable identity below userData', async () => {
    const root = await userData()
    const first = await getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST })
    const second = await getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND })
    const statePath = desktopInstallationIdPath(root)

    expect(first).toBe(FIRST)
    expect(second).toBe(FIRST)
    expect(statePath).toBe(join(root, 'identity', 'installation-id'))
    expect(await readFile(statePath, 'utf8')).toBe(`${FIRST}\n`)
    if (process.platform !== 'win32') {
      expect((await lstat(join(root, 'identity'))).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it('narrows existing private state permissions', async () => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory, { mode: 0o777 })
    await writeFile(statePath, `${FIRST}\n`, { mode: 0o666 })
    await chmod(directory, 0o777)
    await chmod(statePath, 0o666)

    await expect(getOrCreateDesktopInstallationId(root)).resolves.toBe(FIRST)
    if (process.platform !== 'win32') {
      expect((await lstat(directory)).mode & 0o777).toBe(0o700)
      expect((await lstat(statePath)).mode & 0o777).toBe(0o600)
    }
  })

  it.each([
    ['malformed contents', async (path: string) => { await writeFile(path, 'not-a-uuid\n') }],
    ['oversized contents', async (path: string) => { await writeFile(path, 'x'.repeat(MAX_DESKTOP_INSTALLATION_ID_BYTES + 1)) }],
    ['non-UTF-8 contents', async (path: string) => { await writeFile(path, Buffer.from([0xff, 0xfe])) }],
  ] as const)('atomically rebuilds an ordinary file with %s', async (_label, prepare) => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory)
    await prepare(statePath)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND })).resolves.toBe(SECOND)
    expect(await readFile(statePath, 'utf8')).toBe(`${SECOND}\n`)
  })

  it('rejects a linked identity directory without writing through it', async () => {
    const root = await userData()
    const outside = await userData()
    await symlink(outside, join(root, 'identity'), process.platform === 'win32' ? 'junction' : 'dir')

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }))
      .rejects.toThrow('must be an ordinary directory')
    await expect(readFile(join(outside, 'installation-id'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it.skipIf(process.platform === 'win32')('rejects a symlink at the identity file path', async () => {
    const root = await userData()
    const outside = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(directory)
    const target = join(outside, 'target')
    await writeFile(target, `${FIRST}\n`)
    await symlink(target, statePath)

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .rejects.toThrow('must be an ordinary file')
  })

  it('rejects a directory at the identity file path', async () => {
    const root = await userData()
    const directory = join(root, 'identity')
    const statePath = join(directory, 'installation-id')
    await mkdir(statePath, { recursive: true })

    await expect(getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }))
      .rejects.toThrow('must be an ordinary file')
  })

  it('serializes concurrent first use onto one persisted identity', async () => {
    const root = await userData()
    const values = await Promise.all([
      getOrCreateDesktopInstallationId(root, { randomUUID: () => FIRST }),
      getOrCreateDesktopInstallationId(root, { randomUUID: () => SECOND }),
    ])

    expect(new Set(values)).toEqual(new Set([values[0]]))
    expect(await readFile(desktopInstallationIdPath(root), 'utf8')).toBe(`${values[0]}\n`)
  })

  it.each(['', 'relative/path', `/tmp/bad\0path`])('rejects unsafe userData path %j', async (root) => {
    await expect(getOrCreateDesktopInstallationId(root)).rejects.toThrow('must be an absolute path')
  })
})
