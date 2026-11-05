/** Folder choices that must stay clear of the installed program (#1564). */
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  pickOutsideProgramDirectory, programDirectory, programDirectoryOverlap, programDirectoryRefusal, refusedProgramDirectoryOverlap,
  type ProgramDirectoryPurpose,
} from '../src/program-directory.ts'

const PROGRAM = 'C:\\Users\\Zhou\\AppData\\Local\\Programs\\DSH NEXT'
const PROGRAMS = 'C:\\Users\\Zhou\\AppData\\Local\\Programs'
const asGiven = (path: string): string => path

const folders: string[] = []
function folder() { const path = mkdtempSync(join(tmpdir(), 'program-directory-')); folders.push(path); return path }
afterEach(() => folders.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))

describe('programDirectory', () => {
  it('names the folder an update replaces', () => {
    expect(programDirectory('win32', `${PROGRAM}\\DSH NEXT.exe`)).toBe(PROGRAM)
    expect(programDirectory('darwin', '/Applications/DSH NEXT.app/Contents/MacOS/DSH NEXT')).toBe('/Applications/DSH NEXT.app')
    expect(programDirectory('darwin', '/usr/local/lib/electron/electron')).toBe('/usr/local/lib/electron')
    expect(programDirectory('linux', '/opt/DSH NEXT/app')).toBe('/opt/DSH NEXT')
  })
})

describe('programDirectoryOverlap', () => {
  it('relates folders by Windows path rules, ignoring case', () => {
    expect(programDirectoryOverlap(PROGRAM.toUpperCase(), PROGRAM, 'win32', asGiven)).toBe('same')
    expect(programDirectoryOverlap(`${PROGRAM}\\`, PROGRAM, 'win32', asGiven)).toBe('same')
    expect(programDirectoryOverlap(`${PROGRAM}\\resources\\app`, PROGRAM, 'win32', asGiven)).toBe('inside')
    expect(programDirectoryOverlap(PROGRAMS.toLowerCase(), PROGRAM, 'win32', asGiven)).toBe('contains')
    expect(programDirectoryOverlap('C:\\', PROGRAM, 'win32', asGiven)).toBe('contains')
    expect(programDirectoryOverlap(`${PROGRAM} data`, PROGRAM, 'win32', asGiven)).toBeUndefined()
    expect(programDirectoryOverlap(`D${PROGRAM.slice(1)}`, PROGRAM, 'win32', asGiven)).toBeUndefined()
    expect(programDirectoryOverlap('C:\\Users\\Zhou\\Documents', PROGRAM, 'win32', asGiven)).toBeUndefined()
  })

  it('compares the real folders behind links', () => {
    const root = folder()
    const program = join(root, 'program')
    mkdirSync(join(program, 'resources'), { recursive: true })
    mkdirSync(join(root, 'programs'))
    symlinkSync(program, join(root, 'link'), 'junction')
    expect(programDirectoryOverlap(join(root, 'link'), program)).toBe('same')
    expect(programDirectoryOverlap(join(root, 'link', 'resources'), program)).toBe('inside')
    expect(programDirectoryOverlap(root, program)).toBe('contains')
    expect(programDirectoryOverlap(join(root, 'programs'), program)).toBeUndefined()
  })
})

describe('refusedProgramDirectoryOverlap', () => {
  const refused = (purpose: ProgramDirectoryPurpose, choice: string, platform: NodeJS.Platform = 'win32') =>
    refusedProgramDirectoryOverlap(purpose, choice, PROGRAM, platform, asGiven)

  it('keeps a Windows workspace off the program directory in both directions', () => {
    expect(refused('workspace', PROGRAM)).toBe('same')
    expect(refused('workspace', `${PROGRAM}\\resources`)).toBe('inside')
    expect(refused('workspace', PROGRAMS)).toBe('contains')
    expect(refused('workspace', 'C:\\Users\\Zhou\\Projects')).toBeUndefined()
    // Only the Windows sandbox labels folders.
    expect(refused('workspace', PROGRAM, 'darwin')).toBeUndefined()
  })

  it('keeps the data directory out of the program directory on every platform', () => {
    expect(refused('data', PROGRAM)).toBe('same')
    expect(refused('data', `${PROGRAM}\\data`)).toBe('inside')
    expect(refused('data', PROGRAMS)).toBeUndefined()
    const bundle = '/Applications/DSH NEXT.app'
    expect(refusedProgramDirectoryOverlap('data', `${bundle}/Contents/Resources/data`, bundle, 'darwin', asGiven)).toBe('inside')
    expect(refusedProgramDirectoryOverlap('data', '/Users/zhou/DSH data', bundle, 'darwin', asGiven)).toBeUndefined()
  })
})

describe('pickOutsideProgramDirectory', () => {
  it('opens the dialog again after a refused choice', async () => {
    const pick = vi.fn<() => Promise<string | undefined>>().mockResolvedValueOnce(PROGRAM).mockResolvedValueOnce('D:\\Work')
    const again = vi.fn(async () => true)
    await expect(pickOutsideProgramDirectory(pick, choice => choice === PROGRAM ? 'same' : undefined, again)).resolves.toBe('D:\\Work')
    expect(again).toHaveBeenCalledOnce()
    expect(again).toHaveBeenCalledWith('same')
    expect(pick).toHaveBeenCalledTimes(2)
  })

  it('stops when the user dismisses the dialog or the explanation', async () => {
    const refused = () => 'inside' as const
    const again = vi.fn(async () => true)
    await expect(pickOutsideProgramDirectory(async () => undefined, refused, again)).resolves.toBeUndefined()
    expect(again).not.toHaveBeenCalled()
    const pick = vi.fn(async () => PROGRAM)
    await expect(pickOutsideProgramDirectory(pick, refused, async () => false)).resolves.toBeUndefined()
    expect(pick).toHaveBeenCalledOnce()
  })
})

describe('programDirectoryRefusal', () => {
  it('names the overlap, the reason for the purpose and the installation folder', () => {
    const workspace = programDirectoryRefusal('workspace', 'contains', PROGRAM, 'zh')
    expect(workspace.title).toBe('DSH NEXT')
    expect(workspace.message).toBe('不能用这个文件夹作为工作区')
    expect(workspace.detail).toContain('所选文件夹包含 DSH NEXT 的安装目录。')
    expect(workspace.detail).toContain('低完整性（Low）标签')
    expect(workspace.detail).toContain(`安装目录：${PROGRAM}`)
    expect(workspace.buttons).toEqual(['重新选择', '取消'])
    const data = programDirectoryRefusal('data', 'inside', PROGRAM, 'en')
    expect(data.message).toBe('This folder cannot be the data directory')
    expect(data.detail).toContain('The selected folder is inside the DSH NEXT installation folder.')
    expect(data.detail).toContain('uninstalling removes it')
    expect(data.detail).toContain(`Installation folder: ${PROGRAM}`)
    expect(data.buttons).toEqual(['Choose another folder', 'Cancel'])
  })
})
