import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extendWorkspaceSourceSandbox } from '../src/workspace-source-sandbox.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const directory of tempDirs.splice(0)) rmSync(directory, { recursive: true, force: true })
})

function directory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(path)
  return path
}

function bwrapArgv(primaryRoot: string, command = ['bash', '-c', 'echo ok']): string[] {
  return [
    'bwrap',
    '--ro-bind', '/', '/',
    '--dev', '/dev',
    '--unshare-pid',
    '--proc', '/proc',
    '--die-with-parent',
    '--tmpfs', '/tmp',
    '--bind', primaryRoot, primaryRoot,
    '--',
    ...command,
  ]
}

function sbplString(path: string): string {
  return `"${path.replaceAll('\\', String.raw`\\`).replaceAll('"', String.raw`\"`)}"`
}

describe('workspace source sandbox argv extension', () => {
  it.skipIf(process.platform === 'win32')('adds canonical, deduplicated bwrap binds before the command and keeps the original argv intact', () => {
    const primaryRoot = directory('dsh-source-primary-')
    const attachedRoot = directory('dsh-source-attached-')
    const alias = join(directory('dsh-source-alias-'), 'alias')
    symlinkSync(attachedRoot, alias, 'dir')
    const argv = Object.freeze(bwrapArgv(primaryRoot, ['bash', '-c', 'echo --']))

    const result = extendWorkspaceSourceSandbox(
      argv,
      'linux',
      primaryRoot,
      [attachedRoot, alias, primaryRoot],
    )

    expect(result).toEqual([
      ...argv.slice(0, argv.indexOf('--')),
      '--bind', attachedRoot, attachedRoot,
      ...argv.slice(argv.indexOf('--')),
    ])
    expect(argv).toEqual(bwrapArgv(primaryRoot, ['bash', '-c', 'echo --']))

    expect(extendWorkspaceSourceSandbox(result, 'linux', primaryRoot, [alias])).toEqual(result)
  })

  it.skipIf(process.platform === 'win32')('adds Landlock write grants without disturbing its existing read/write policy', () => {
    const primaryRoot = directory('dsh-source-primary-')
    const attachedRoot = directory('dsh-source-attached-')
    const argv = [
      join(directory('dsh-landlock-bin-'), 'landlock-run'),
      '--ro', '/',
      '--rw', '/dev/null',
      '--rw', '/tmp',
      '--rw', primaryRoot,
      '--',
      'bash', '-c', 'echo ok',
    ]

    const result = extendWorkspaceSourceSandbox(argv, 'linux', primaryRoot, [attachedRoot, attachedRoot])

    expect(result).toEqual([
      ...argv.slice(0, argv.indexOf('--')),
      '--rw', attachedRoot,
      ...argv.slice(argv.indexOf('--')),
    ])
  })

  it.skipIf(process.platform === 'win32')('extends Seatbelt with escaped roots while retaining the existing policy forms', () => {
    const primaryRoot = directory('dsh-source-primary-')
    const sourceParent = directory('dsh-source-parent-')
    const attachedRoot = join(sourceParent, 'attached "source"')
    mkdirSync(attachedRoot)
    const tempRoot = realpathSync.native(tmpdir())
    const originalProfile = [
      '(version 1)',
      '(allow default)',
      '(deny file-write*)',
      '(allow file-write* (literal "/dev/null"))',
      `(allow file-write* (subpath ${sbplString(primaryRoot)}) (subpath ${sbplString(tempRoot)}))`,
    ].join(' ')
    const argv = ['sandbox-exec', '-p', originalProfile, '--', 'bash', '-c', 'echo ok']

    const result = extendWorkspaceSourceSandbox(argv, 'darwin', primaryRoot, [attachedRoot])
    const updatedProfile = result[2]

    expect(updatedProfile).toBe(`${originalProfile} (allow file-write* (subpath ${sbplString(attachedRoot)}))`)
    expect(result.slice(0, 2)).toEqual(argv.slice(0, 2))
    expect(result.slice(3)).toEqual(argv.slice(3))
    expect(argv[2]).toBe(originalProfile)
  })

  it.skipIf(process.platform === 'win32')('canonicalizes symlink roots, drops duplicate grants, and rejects invalid roots', () => {
    const primaryRoot = directory('dsh-source-primary-')
    const attachedRoot = directory('dsh-source-attached-')
    const alias = join(directory('dsh-source-alias-'), 'alias')
    symlinkSync(attachedRoot, alias, 'dir')

    const result = extendWorkspaceSourceSandbox(
      bwrapArgv(primaryRoot),
      'linux',
      primaryRoot,
      [alias, attachedRoot],
    )
    expect(result.filter(argument => argument === '--bind')).toHaveLength(2)

    expect(() => extendWorkspaceSourceSandbox(bwrapArgv(primaryRoot), 'linux', primaryRoot, ['/'])).toThrow(
      'filesystem root',
    )
    expect(() => extendWorkspaceSourceSandbox(bwrapArgv(primaryRoot), 'linux', primaryRoot, [join(primaryRoot, 'missing')])).toThrow(
      'accessible existing directory',
    )
  })

  it('fails closed for a Windows host, unknown commands, unsupported platforms, and unsupported policy shapes', () => {
    const primaryRoot = directory('dsh-source-primary-')
    const unknownArgv = ['custom-sandbox', '--', 'bash']

    expect(() => extendWorkspaceSourceSandbox(unknownArgv, 'win32', 'C:\\workspace', [])).toThrow('Windows is unsupported')
    expect(() => extendWorkspaceSourceSandbox(unknownArgv, 'linux', primaryRoot, [])).toThrow('unsupported linux runner command')
    expect(() => extendWorkspaceSourceSandbox(unknownArgv, 'freebsd', primaryRoot, [])).toThrow('unsupported platform')

  })
})
