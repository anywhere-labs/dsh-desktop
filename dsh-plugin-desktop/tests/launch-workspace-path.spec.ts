import { describe, expect, it } from 'vitest'
import {
  DESKTOP_WORKSPACE_ARGUMENT,
  desktopArgumentsWithoutLaunchWorkspace,
  desktopLaunchWorkspaceFromArguments,
  desktopLaunchWorkspaceRequest,
} from '../src/launch-workspace-path.ts'
import { isDesktopBackgroundNodeRequest } from '../src/desktop-installer-quit.ts'

describe('Desktop launch workspace path', () => {
  it('names the launcher hand-off flag', () => {
    expect(DESKTOP_WORKSPACE_ARGUMENT).toBe('--dsh-desktop-workspace')
  })

  it('accepts a bare absolute folder using the launching platform semantics', () => {
    expect(desktopLaunchWorkspaceFromArguments(['C:\\Work\\repo'], 'win32'))
      .toEqual({ paths: ['C:\\Work\\repo'], explicit: false })
    expect(desktopLaunchWorkspaceFromArguments(['/home/anna/work'], 'linux'))
      .toEqual({ paths: ['/home/anna/work'], explicit: false })
  })

  it('rejects a path that is absolute only on another platform', () => {
    expect(desktopLaunchWorkspaceFromArguments(['C:\\Work'], 'linux')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments(['work/repo'], 'win32')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments(['./work'], 'linux')).toBeUndefined()
  })

  it('never reads the executable slot', () => {
    expect(desktopLaunchWorkspaceRequest(['C:\\Program Files\\DSH Desktop\\DSH Desktop.exe'], 'win32'))
      .toBeUndefined()
    expect(desktopLaunchWorkspaceRequest(['/opt/dsh/dsh-desktop', '/home/anna/work'], 'linux'))
      .toEqual({ paths: ['/home/anna/work'], explicit: false })
  })

  it('skips switches and Node entry scripts when scanning for a bare folder', () => {
    expect(desktopLaunchWorkspaceFromArguments(['--profile', 'desktop'], 'win32')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments(['C:\\app\\lib\\main.js'], 'win32')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments(['/app/lib/main.cjs'], 'linux')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments(['/app/lib/main.MJS'], 'linux')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments(['C:\\app\\lib\\main.js', 'C:\\Work'], 'win32'))
      .toEqual({ paths: ['C:\\Work'], explicit: false })
  })

  it('marks the launcher flag as an explicit hand-off', () => {
    expect(desktopLaunchWorkspaceFromArguments(
      ['C:\\app\\lib\\main.js', DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Work'],
      'win32',
    )).toEqual({ paths: ['C:\\Work'], explicit: true })
    expect(desktopLaunchWorkspaceFromArguments(
      ['/app/lib/main.js', DESKTOP_WORKSPACE_ARGUMENT, '/home/anna/work'],
      'linux',
    )).toEqual({ paths: ['/home/anna/work'], explicit: true })
  })

  it('reads the folder attached to the flag', () => {
    expect(desktopLaunchWorkspaceFromArguments(
      [`${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work\\repo`, 'C:\\app\\lib\\main.js'],
      'win32',
    )).toEqual({ paths: ['C:\\Work\\repo'], explicit: true })
    expect(desktopLaunchWorkspaceFromArguments(
      [`${DESKTOP_WORKSPACE_ARGUMENT}=/home/anna/work`],
      'linux',
    )).toEqual({ paths: ['/home/anna/work'], explicit: true })
    expect(desktopLaunchWorkspaceFromArguments([`${DESKTOP_WORKSPACE_ARGUMENT}=work`], 'win32'))
      .toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments([`${DESKTOP_WORKSPACE_ARGUMENT}=`], 'win32'))
      .toBeUndefined()
  })

  it('still reads the hand-off after a command line rebuild moved the value', () => {
    // Chromium hands a second instance its switches first and its positional
    // arguments last, which tears a space separated value away from its flag.
    expect(desktopLaunchWorkspaceFromArguments(
      [
        '--user-data-dir=C:\\data',
        DESKTOP_WORKSPACE_ARGUMENT,
        '--allow-file-access-from-files',
        'C:\\app\\lib\\main.js',
        'C:\\Work\\repo',
      ],
      'win32',
    )).toEqual({ paths: ['C:\\Work\\repo'], explicit: true })
  })

  it('refuses a flag that carries no usable value', () => {
    expect(desktopLaunchWorkspaceFromArguments([DESKTOP_WORKSPACE_ARGUMENT], 'win32')).toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments([DESKTOP_WORKSPACE_ARGUMENT, '--profile'], 'win32'))
      .toBeUndefined()
    expect(desktopLaunchWorkspaceFromArguments([DESKTOP_WORKSPACE_ARGUMENT, 'work'], 'win32'))
      .toBeUndefined()
  })

  it('prefers the explicit flag over a bare folder', () => {
    expect(desktopLaunchWorkspaceFromArguments(
      ['C:\\Bare', DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Explicit'],
      'win32',
    )).toEqual({ paths: ['C:\\Explicit'], explicit: true })
  })

  it('collects every folder the attached flag repeats, in launch order', () => {
    expect(desktopLaunchWorkspaceFromArguments(
      [
        `${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work\\main`,
        'C:\\app\\lib\\main.js',
        `${DESKTOP_WORKSPACE_ARGUMENT}=D:\\Data\\fixtures`,
        `${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work\\docs`,
      ],
      'win32',
    )).toEqual({
      paths: ['C:\\Work\\main', 'D:\\Data\\fixtures', 'C:\\Work\\docs'],
      explicit: true,
    })
    expect(desktopLaunchWorkspaceFromArguments(
      [`${DESKTOP_WORKSPACE_ARGUMENT}=/home/anna/work`, `${DESKTOP_WORKSPACE_ARGUMENT}=/home/anna/docs`],
      'linux',
    )).toEqual({ paths: ['/home/anna/work', '/home/anna/docs'], explicit: true })
  })

  it('collects every folder the spaced flag repeats, in launch order', () => {
    expect(desktopLaunchWorkspaceFromArguments(
      [
        DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Work\\main',
        DESKTOP_WORKSPACE_ARGUMENT, 'D:\\Data\\fixtures',
      ],
      'win32',
    )).toEqual({ paths: ['C:\\Work\\main', 'D:\\Data\\fixtures'], explicit: true })
  })

  it('keeps launch order while dropping a folder the launcher named twice', () => {
    expect(desktopLaunchWorkspaceFromArguments(
      [
        `${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work`,
        `${DESKTOP_WORKSPACE_ARGUMENT}=D:\\Data`,
        `${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work`,
      ],
      'win32',
    )).toEqual({ paths: ['C:\\Work', 'D:\\Data'], explicit: true })
  })

  it('refuses the whole attached root set when any folder is unusable', () => {
    // Never silently narrow the requested roots or change their primary.
    expect(desktopLaunchWorkspaceFromArguments(
      [
        `${DESKTOP_WORKSPACE_ARGUMENT}=`,
        `${DESKTOP_WORKSPACE_ARGUMENT}=relative/work`,
        `${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work`,
      ],
      'win32',
    )).toBeUndefined()
  })

  it('keeps the bare folder form a single hand-off', () => {
    expect(desktopLaunchWorkspaceFromArguments(['C:\\Work', 'D:\\Data'], 'win32'))
      .toEqual({ paths: ['C:\\Work'], explicit: false })
  })

  it('reads nothing from a background Node re-entry command line', () => {
    const vectors = [
      ['DSH Desktop.exe', 'C:\\app\\pnpm\\bin\\pnpm.mjs', 'install'],
      ['DSH Desktop.exe', '--require', 'C:\\runtime\\clear-env.cjs'],
      ['DSH Desktop.exe', '--import=file:///runtime/clear-env.mjs'],
      ['DSH Desktop.exe', '--expose-internals', 'desktop-cli.js'],
    ]
    for (const argv of vectors) {
      expect(isDesktopBackgroundNodeRequest(argv)).toBe(true)
      expect(desktopLaunchWorkspaceRequest(argv, 'win32')).toBeUndefined()
    }
  })

  it('drops the hand-off without disturbing the rest of the command line', () => {
    expect(desktopArgumentsWithoutLaunchWorkspace(
      ['--dsh-desktop-safe-mode', DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Work', '--profile'],
      'win32',
    )).toEqual(['--dsh-desktop-safe-mode', '--profile'])
    expect(desktopArgumentsWithoutLaunchWorkspace(
      ['C:\\app\\lib\\main.js', 'C:\\Work'],
      'win32',
    )).toEqual(['C:\\app\\lib\\main.js'])
    expect(desktopArgumentsWithoutLaunchWorkspace([DESKTOP_WORKSPACE_ARGUMENT, '--profile'], 'win32'))
      .toEqual(['--profile'])
    expect(desktopArgumentsWithoutLaunchWorkspace(['--profile', 'desktop'], 'win32'))
      .toEqual(['--profile', 'desktop'])
  })

  it('drops every repetition of the hand-off, not just the first', () => {
    expect(desktopArgumentsWithoutLaunchWorkspace(
      [
        `${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work`,
        `${DESKTOP_WORKSPACE_ARGUMENT}=D:\\Data`,
        '--profile=work',
      ],
      'win32',
    )).toEqual(['--profile=work'])
    expect(desktopArgumentsWithoutLaunchWorkspace(
      [
        DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Work',
        DESKTOP_WORKSPACE_ARGUMENT, 'D:\\Data',
        '--profile=work',
      ],
      'win32',
    )).toEqual(['--profile=work'])
  })

  it('leaves no shape of the hand-off readable in a relaunch command line', () => {
    const shapes = [
      [`${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work`, '--profile=work'],
      [DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Work', '--profile=work'],
      [DESKTOP_WORKSPACE_ARGUMENT, '--allow-file-access-from-files', 'C:\\Work'],
      ['C:\\app\\lib\\main.js', 'C:\\Work'],
      [`${DESKTOP_WORKSPACE_ARGUMENT}=C:\\Work`, `${DESKTOP_WORKSPACE_ARGUMENT}=D:\\Data`, '--profile=work'],
      [DESKTOP_WORKSPACE_ARGUMENT, 'C:\\Work', DESKTOP_WORKSPACE_ARGUMENT, 'D:\\Data', '--profile=work'],
    ]
    for (const args of shapes) {
      const filtered = desktopArgumentsWithoutLaunchWorkspace(args, 'win32')
      expect(filtered).not.toContain('C:\\Work')
      expect(filtered).not.toContain('D:\\Data')
      expect(desktopLaunchWorkspaceFromArguments(filtered, 'win32')).toBeUndefined()
    }
  })
})


describe('Electron application entry normalization', () => {
  it('does not adopt either shipped Stable start entry or an explicit package-directory entry', () => {
    // Stable bin.ts spawns lib/main.js; direct Electron launches may use its package root.
    expect(desktopLaunchWorkspaceRequest(['/electron', '/app/dsh/lib/main.js'], 'linux', '/app/dsh')).toBeUndefined()
    expect(desktopLaunchWorkspaceRequest(['/electron', '/app/dsh'], 'linux', '/app/dsh/')).toBeUndefined()
    expect(desktopLaunchWorkspaceRequest(['/electron', '--allow-file-access-from-files', '/app/dsh'], 'linux', '/app/dsh')).toBeUndefined()
  })
  it('keeps a legitimate bare-folder handoff after the known application entry', () => {
    expect(desktopLaunchWorkspaceRequest(['/electron', '/app/dsh', '/work/project'], 'linux', '/app/dsh'))
      .toEqual({ paths: ['/work/project'], explicit: false })
    expect(desktopLaunchWorkspaceRequest(['C:\\Electron.exe', 'C:\\APP\\DSH', 'D:\\Work'], 'win32', 'c:\\app\\dsh'))
      .toEqual({ paths: ['D:\\Work'], explicit: false })
  })
  it('never removes an explicitly selected application directory', () => {
    expect(desktopLaunchWorkspaceRequest(['/electron', '/app/dsh', '--dsh-desktop-workspace=/app/dsh', '--dsh-desktop-workspace=/extra'], 'linux', '/app/dsh'))
      .toEqual({ paths: ['/app/dsh', '/extra'], explicit: true })
    expect(desktopLaunchWorkspaceRequest(['/electron', '/app/dsh', '--dsh-desktop-workspace', '/app/dsh'], 'linux', '/app/dsh'))
      .toEqual({ paths: ['/app/dsh'], explicit: true })
  })
})
