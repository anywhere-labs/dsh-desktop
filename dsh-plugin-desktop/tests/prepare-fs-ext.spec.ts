import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  prepareFsExtForElectron,
  type NativeBuildInvocation,
} from '../scripts/prepare-fs-ext.ts'

const roots: string[] = []

function fixture(): {
  readonly root: string
  readonly fsExtRoot: string
  readonly nanRoot: string
  readonly nodeGypCli: string
  readonly nodeBinding: string
} {
  const root = mkdtempSync(join(tmpdir(), 'dsh-prepare-fs-ext-test-'))
  roots.push(root)
  const fsExtRoot = join(root, 'node_modules', 'fs-ext')
  const nanRoot = join(root, 'node_modules', 'nan')
  const nodeGypCli = join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js')
  const nodeBinding = join(fsExtRoot, 'build', 'Release', 'fs_ext.node')
  mkdirSync(join(fsExtRoot, 'build', 'Release'), { recursive: true })
  mkdirSync(nanRoot, { recursive: true })
  mkdirSync(join(root, 'node_modules', 'node-gyp', 'bin'), { recursive: true })
  writeFileSync(join(fsExtRoot, 'package.json'), JSON.stringify({ version: '2.1.1' }))
  writeFileSync(join(fsExtRoot, 'binding.gyp'), '{"targets":[]}')
  writeFileSync(join(fsExtRoot, 'fs-ext.cc'), '// native source')
  writeFileSync(nodeBinding, 'node-abi-binding')
  writeFileSync(join(nanRoot, 'package.json'), JSON.stringify({ version: '2.24.0' }))
  writeFileSync(join(nanRoot, 'nan.h'), '// nan header')
  writeFileSync(nodeGypCli, '// node-gyp cli')
  return { root, fsExtRoot, nanRoot, nodeGypCli, nodeBinding }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('fs-ext Electron binding preparation', () => {
  it('builds in a disposable copy and atomically installs an ABI-qualified binding', () => {
    const value = fixture()
    const invocations: NativeBuildInvocation[] = []
    let temporarySource = ''
    const log = vi.fn()

    const result = prepareFsExtForElectron({
      platform: 'linux',
      hostPlatform: 'linux',
      arch: 'x64',
      fsExtRoot: value.fsExtRoot,
      nanRoot: value.nanRoot,
      nodeGypCli: value.nodeGypCli,
      nodeExecutable: '/test/node',
      electronVersion: '43.3.0',
      env: { SAFE_VALUE: 'kept' },
      runBuild: invocation => {
        invocations.push(invocation)
        temporarySource = invocation.cwd
        expect(readFileSync(join(invocation.cwd, 'fs-ext.cc'), 'utf8')).toBe('// native source')
        expect(readFileSync(join(invocation.cwd, 'node_modules', 'nan', 'nan.h'), 'utf8'))
          .toBe('// nan header')
        mkdirSync(join(invocation.cwd, 'build', 'Release'), { recursive: true })
        writeFileSync(join(invocation.cwd, 'build', 'Release', 'fs_ext.node'), 'electron-binding')
        writeFileSync(
          join(invocation.cwd, 'build', 'config.gypi'),
          JSON.stringify({ variables: { node_module_version: 148, target_arch: 'x64' } }),
        )
      },
      log,
    })

    expect(invocations).toEqual([{
      command: '/test/node',
      args: [
        value.nodeGypCli,
        'rebuild',
        '--release',
        '--runtime=electron',
        '--target=43.3.0',
        '--dist-url=https://electronjs.org/headers',
        '--arch=x64',
      ],
      cwd: temporarySource,
      env: { SAFE_VALUE: 'kept' },
    }])
    expect(result).toEqual({
      path: join(
        value.fsExtRoot,
        'prebuilds',
        'linux-x64',
        'electron.abi148.node',
      ),
      status: 'prepared',
      platform: 'linux',
      arch: 'x64',
      electronVersion: '43.3.0',
      abi: '148',
    })
    expect(result.status).toBe('prepared')
    if (result.status !== 'prepared') throw new Error('expected a prepared POSIX binding')
    expect(readFileSync(result.path, 'utf8')).toBe('electron-binding')
    expect(readFileSync(value.nodeBinding, 'utf8')).toBe('node-abi-binding')
    expect(existsSync(temporarySource)).toBe(false)
    expect(readdirSync(join(value.fsExtRoot, 'prebuilds', 'linux-x64')))
      .toEqual(['electron.abi148.node'])
    expect(log).toHaveBeenCalledOnce()
  })

  it('cleans the disposable copy and preserves the Node binding when node-gyp fails', () => {
    const value = fixture()
    let temporarySource = ''

    expect(() => prepareFsExtForElectron({
      platform: 'linux',
      hostPlatform: 'linux',
      arch: 'x64',
      fsExtRoot: value.fsExtRoot,
      nanRoot: value.nanRoot,
      nodeGypCli: value.nodeGypCli,
      electronVersion: '43.3.0',
      runBuild: invocation => {
        temporarySource = invocation.cwd
        throw new Error('simulated node-gyp failure')
      },
    })).toThrow('simulated node-gyp failure')

    expect(existsSync(temporarySource)).toBe(false)
    expect(readFileSync(value.nodeBinding, 'utf8')).toBe('node-abi-binding')
    expect(existsSync(join(value.fsExtRoot, 'prebuilds'))).toBe(false)
  })

  it('returns not-required on Windows without resolving or running node-gyp', () => {
    const runBuild = vi.fn()
    const log = vi.fn()

    expect(prepareFsExtForElectron({
      platform: 'win32',
      hostPlatform: 'win32',
      arch: 'x64',
      desktopRoot: 'C:\\missing-desktop-root',
      fsExtRoot: 'C:\\missing-fs-ext',
      nanRoot: 'C:\\missing-nan',
      nodeGypCli: 'C:\\missing-node-gyp.js',
      electronVersion: '43.3.0',
      runBuild,
      log,
    })).toEqual({
      status: 'not-required',
      platform: 'win32',
      arch: 'x64',
    })
    expect(runBuild).not.toHaveBeenCalled()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('not required on Windows'))
  })

  it('rejects cross-platform compilation before invoking node-gyp', () => {
    const value = fixture()
    const runBuild = vi.fn()
    const target = process.platform === 'win32' ? 'darwin' : 'win32'

    expect(() => prepareFsExtForElectron({
      platform: target,
      hostPlatform: process.platform,
      fsExtRoot: value.fsExtRoot,
      nanRoot: value.nanRoot,
      nodeGypCli: value.nodeGypCli,
      electronVersion: '43.3.0',
      runBuild,
    })).toThrow(`target ${target}, host ${process.platform}`)
    expect(runBuild).not.toHaveBeenCalled()
  })
})
