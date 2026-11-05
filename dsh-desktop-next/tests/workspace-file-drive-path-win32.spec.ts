/**
 * #1419 on any CI host: the installed `dsh-fs-local` under simulated Win32 path semantics must
 * read a file-URL spelled drive path (`/C:/…`) as the native file, never as `C:\C:\…`.
 * The native Windows filesystem round trip lives in `workspace-file-drive-path.spec.ts`.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  file: 'C:\\Users\\USER\\Documents\\Project\\docs\\guide.md',
  workspace: 'C:\\Users\\USER\\Documents\\Workspace',
  probed: [] as string[],
}))

vi.mock('node:path', async importOriginal => {
  const { win32 } = await importOriginal<typeof import('node:path')>()
  return { ...win32, default: win32 }
})
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  lstat: async (path: string) => {
    fixture.probed.push(path)
    if (path !== fixture.file) throw Object.assign(new Error(`ENOENT: no such file or directory, lstat '${path}'`), { code: 'ENOENT' })
    return {
      dev: 1n, ino: 2n, size: 8n, mode: 0o100644n, mtimeNs: 3n, ctimeNs: 4n,
      isFile: () => true, isDirectory: () => false, isSymbolicLink: () => false,
    }
  },
}))

const { LocalFileSystem } = await import('@deepseek-ai/dsh-fs-local')
const platform = Object.getOwnPropertyDescriptor(process, 'platform')!
let fs: InstanceType<typeof LocalFileSystem>

beforeEach(() => {
  fixture.probed.length = 0
  // Only the two methods under test run, so the provider needs its config and no Cordis context.
  fs = Object.assign(Object.create(LocalFileSystem.prototype), { config: { cwd: fixture.workspace } })
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' })
})
afterEach(() => {
  Object.defineProperty(process, 'platform', platform)
})

it.each([
  ['forward slashes', '/C:/Users/USER/Documents/Project/docs/guide.md'],
  ['backslashes', '\\C:\\Users\\USER\\Documents\\Project\\docs\\guide.md'],
  ['native spelling', 'C:/Users/USER/Documents/Project/docs/guide.md'],
])('reads a drive path in %s as the native file', async (_label, path) => {
  expect((await fs.lstat(path, { cwd: fixture.workspace }))?.type).toBe('file')
  expect(fixture.probed).toEqual([fixture.file])
  expect(fs.processPathFromHostPath(path)).toBe(fixture.file)
})

it('keeps workspace-relative and UNC paths on their own resolution', async () => {
  expect(await fs.lstat('docs/guide.md', { cwd: fixture.workspace })).toBeUndefined()
  expect(fixture.probed).toEqual([`${fixture.workspace}\\docs\\guide.md`])
  expect(fs.processPathFromHostPath('//server/share/C:/guide.md')).toBe('\\\\server\\share\\C:\\guide.md')
  expect(fs.processPathFromHostPath('docs/guide.md')).toBeUndefined()
})
