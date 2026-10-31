/**
 * #1419: a Markdown link or tab whose destination is the file-URL spelling of a Windows path
 * (`/C:/…/guide.md`) reaches the Host's filesystem unchanged through the Session file address,
 * and must open the native file instead of a doubled drive (`C:\C:\…`).
 */
import { realpath as realpathCallback } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { Context } from '@deepseek-ai/cordis'
import { LocalFileSystem } from '@deepseek-ai/dsh-fs-local'
import { fileAddressFor, parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const nativeRealpath = promisify(realpathCallback.native)
const windows = process.platform === 'win32'

let dir: string
let workspace: string
let fiber: Awaited<ReturnType<Context['plugin']>>
let fs: LocalFileSystem

beforeEach(async () => {
  dir = await nativeRealpath(await mkdtemp(join(tmpdir(), 'next-drive-path-')))
  workspace = join(dir, 'Workspace')
  await mkdir(workspace)
  const ctx = new Context()
  fiber = await ctx.plugin(LocalFileSystem, { cwd: workspace })
  fs = ctx.fs as LocalFileSystem
})
afterEach(async () => {
  await fiber.dispose()
  await rm(dir, { recursive: true, force: true })
})

describe.runIf(windows)('Windows drive paths in the file-URL spelling', () => {
  it('opens /C:/… through the Session file address as the native file', async () => {
    await mkdir(join(dir, 'Project', 'docs'), { recursive: true })
    const native = join(dir, 'Project', 'docs', 'guide.md')
    await writeFile(native, '# Guide\n')
    const urlSpelling = `/${native.replaceAll('\\', '/')}`
    expect(urlSpelling).toMatch(/^\/[A-Za-z]:\//u)

    // The official client keeps the leading slash all the way to `workspaceFiles.read`.
    const parsed = parseFileAddress(fileAddressFor('s1', workspace, urlSpelling))
    expect(parsed).toEqual({ scope: 'session', sessionId: 's1', path: urlSpelling })

    expect((await fs.lstat(urlSpelling, { cwd: workspace }))?.type).toBe('file')
    const target = await fs.resolve(urlSpelling, { cwd: workspace })
    expect(target.displayPath).toBe(native)
    expect(fs.processPath(target)).toBe(native)
    expect((await fs.stat(target))?.type).toBe('file')
    expect(await fs.readText(target)).toBe('# Guide\n')
    expect(fs.processPathFromHostPath(urlSpelling)).toBe(native)
    expect(fs.processPathFromHostPath(urlSpelling.replaceAll('/', '\\'))).toBe(native)
  })

  it('leaves native, relative and UNC spellings unchanged', async () => {
    await writeFile(join(workspace, 'notes.md'), 'notes\n')
    const native = join(workspace, 'notes.md')
    expect((await fs.resolve(native)).displayPath).toBe(native)
    expect((await fs.resolve(native.replaceAll('\\', '/'))).displayPath).toBe(native)
    expect((await fs.resolve('notes.md')).displayPath).toBe(native)
    expect((await fs.resolve('./notes.md', { cwd: workspace })).displayPath).toBe(native)
    expect(fs.processPathFromHostPath('\\\\server\\share\\guide.md')).toBe('\\\\server\\share\\guide.md')
    expect(fs.processPathFromHostPath('//server/share/guide.md')).toBe('\\\\server\\share\\guide.md')
  })
})

describe.skipIf(windows)('POSIX paths that merely look like drives', () => {
  it('keeps /C:/… literal, since a POSIX directory may be named C:', async () => {
    expect(fs.processPathFromHostPath('/C:/Users/USER/guide.md')).toBe('/C:/Users/USER/guide.md')
    expect((await fs.resolve('/C:/Users/USER/guide.md')).displayPath).toBe('/C:/Users/USER/guide.md')
  })
})
