import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { ChildProcess, SpawnOptions } from 'node:child_process'
import { delimiter } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  formatProfileMaterializationFailure,
  materializeProfile,
  type ProfileMaterializerOptions,
  type ProfileMaterializerSpawn,
} from '../src/profile-materializer.ts'

interface FakeChild extends EventEmitter {
  readonly stdout: PassThrough
  readonly stderr: PassThrough
  readonly pid: number
  kill: ReturnType<typeof vi.fn>
}

function fakeChild(): FakeChild {
  const child = new EventEmitter() as FakeChild
  Object.assign(child, {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    pid: 7301,
    kill: vi.fn(() => true),
  })
  return child
}

function options(spawn: ProfileMaterializerSpawn): ProfileMaterializerOptions {
  return {
    appExecutable: '/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop',
    clearEnvironmentPath: '/private/clear-env.mjs',
    pnpmBinPath: '/private/pnpm/bin/pnpm.mjs',
    nodeBinDir: '/private/node-bin',
    nodeShimPath: '/private/node-bin/node',
    homeDir: '/Users/test/.dsh',
    profileDir: '/Users/test/.dsh/profiles/desktop',
    electronVersion: '43.4.0',
    spawn,
  }
}

describe('profile materializer', () => {
  it('runs the fixed packaged pnpm command with the desktop lifecycle environment', async () => {
    const child = fakeChild()
    let command = ''
    let args: readonly string[] = []
    let spawnOptions: SpawnOptions | undefined
    const spawn = vi.fn((selectedCommand: string, selectedArgs: readonly string[], selectedOptions: SpawnOptions) => {
      command = selectedCommand
      args = selectedArgs
      spawnOptions = selectedOptions
      return child as unknown as ChildProcess
    }) as unknown as ProfileMaterializerSpawn

    const resultPromise = materializeProfile(options(spawn))
    child.stdout.end('installed\n')
    child.stderr.end('')
    child.emit('close', 0, null)
    const result = await resultPromise

    expect(command).toBe('/Applications/DSH Desktop.app/Contents/MacOS/DSH Desktop')
    expect(args).toEqual([
      '--import',
      pathToFileURL('/private/clear-env.mjs').href,
      '/private/pnpm/bin/pnpm.mjs',
      '--config.minimumReleaseAge=0',
      'install',
      '--frozen-lockfile',
    ])
    expect(spawnOptions).toMatchObject({
      cwd: '/Users/test/.dsh/profiles/desktop',
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        PATH: `/private/node-bin${delimiter}${process.env.PATH ?? ''}`,
        NODE: '/private/node-bin/node',
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: '/Users/test/.dsh',
        CI: 'true',
        npm_config_runtime: 'electron',
        npm_config_target: '43.4.0',
        npm_config_disturl: 'https://electronjs.org/headers',
      },
    })
    expect(result.stdout).toBe('installed\n')
    expect(result.exitCode).toBe(0)
  })

  it('allows a controlled lockfile update while migrating an old Profile layout', async () => {
    const child = fakeChild()
    let args: readonly string[] = []
    const spawn = vi.fn((_command: string, selectedArgs: readonly string[]) => {
      args = selectedArgs
      return child as unknown as ChildProcess
    }) as unknown as ProfileMaterializerSpawn

    const resultPromise = materializeProfile({ ...options(spawn), updateLockfile: true })
    child.stdout.end('migrated\n')
    child.stderr.end('')
    child.emit('close', 0, null)
    await resultPromise

    expect(args).toEqual([
      '--import',
      pathToFileURL('/private/clear-env.mjs').href,
      '/private/pnpm/bin/pnpm.mjs',
      '--config.minimumReleaseAge=0',
      'install',
      '--no-frozen-lockfile',
    ])
  })

  it('scrubs credential-like and DSH-private entries from the inherited environment', async () => {
    const savedNodeOptions = process.env.NODE_OPTIONS
    const savedNodePath = process.env.NODE_PATH
    process.env.DESKTOP_TEST_MARKET_TOKEN = 'secret-token'
    process.env.DSH_INTERNAL_NOTE = 'internal'
    process.env.NODE_OPTIONS = '--require=/tmp/payload.js'
    process.env.NODE_PATH = '/tmp/rogue-modules'
    process.env.LD_PRELOAD = '/tmp/rogue.so'
    process.env.DYLD_INSERT_LIBRARIES = '/tmp/rogue.dylib'
    process.env.NODE_EXTRA_CA_CERTS = '/tmp/rogue-ca.pem'
    process.env.npm_config_registry = 'https://evil-registry.example'
    const child = fakeChild()
    let spawnOptions: SpawnOptions | undefined
    const spawn = vi.fn((_command: string, _args: readonly string[], selectedOptions: SpawnOptions) => {
      spawnOptions = selectedOptions
      return child as unknown as ChildProcess
    }) as unknown as ProfileMaterializerSpawn
    try {
      const resultPromise = materializeProfile(options(spawn))
      child.stdout.end('installed\n')
      child.stderr.end('')
      child.emit('close', 0, null)
      await resultPromise
    } finally {
      delete process.env.DESKTOP_TEST_MARKET_TOKEN
      delete process.env.DSH_INTERNAL_NOTE
      if (savedNodeOptions === undefined) delete process.env.NODE_OPTIONS
      else process.env.NODE_OPTIONS = savedNodeOptions
      if (savedNodePath === undefined) delete process.env.NODE_PATH
      else process.env.NODE_PATH = savedNodePath
      delete process.env.LD_PRELOAD
      delete process.env.DYLD_INSERT_LIBRARIES
      delete process.env.NODE_EXTRA_CA_CERTS
      delete process.env.npm_config_registry
    }
    const environment = spawnOptions?.env as NodeJS.ProcessEnv
    expect(environment.DESKTOP_TEST_MARKET_TOKEN).toBeUndefined()
    expect(environment.DSH_INTERNAL_NOTE).toBeUndefined()
    expect(environment.NODE_OPTIONS).toBeUndefined()
    expect(environment.NODE_PATH).toBeUndefined()
    expect(environment.LD_PRELOAD).toBeUndefined()
    expect(environment.DYLD_INSERT_LIBRARIES).toBeUndefined()
    expect(environment.NODE_EXTRA_CA_CERTS).toBeUndefined()
    expect(environment.npm_config_registry).toBeUndefined()
    expect(environment.ELECTRON_RUN_AS_NODE).toBe('1')
    expect(environment.NODE).toBe('/private/node-bin/node')
  })

  it('drops case-variant duplicates of the explicit keys on Windows', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32')
    const child = fakeChild()
    let observed: NodeJS.ProcessEnv | undefined
    const spawn = vi.fn((_command: string, _args: readonly string[], selectedOptions: SpawnOptions) => {
      observed = selectedOptions.env
      return child as unknown as ChildProcess
    }) as unknown as ProfileMaterializerSpawn
    try {
      const resultPromise = materializeProfile({
        ...options(spawn),
        scrubParent: () => ({ Path: '/inherited', dsh_home: '/rogue', HOME: '/home/test' } as NodeJS.ProcessEnv),
      })
      child.stdout.end('installed\n')
      child.stderr.end('')
      child.emit('close', 0, null)
      await resultPromise
    } finally {
      platformSpy.mockRestore()
    }
    // Windows matches environment keys case-insensitively; the inherited
    // spellings of explicit overrides must be dropped while unrelated
    // entries survive and the explicit values win.
    expect(observed).toBeDefined()
    expect('Path' in (observed ?? {})).toBe(false)
    expect(observed?.dsh_home).toBeUndefined()
    expect(observed?.HOME).toBe('/home/test')
    expect(observed?.DSH_HOME).toBe('/Users/test/.dsh')
    expect(observed?.PATH).toBe(`/private/node-bin${delimiter}${process.env.PATH ?? ''}`)
  })

  it('rejects a non-zero package-manager exit and preserves bounded diagnostics', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child as unknown as ChildProcess) as unknown as ProfileMaterializerSpawn
    const resultPromise = materializeProfile(options(spawn))
    child.stderr.end('lockfile is out of date')
    child.emit('close', 1, null)
    await expect(resultPromise).rejects.toMatchObject({
      name: 'ProfileMaterializationError',
      result: { exitCode: 1, stderr: 'lockfile is out of date' },
    })
  })

  it('formats bounded package-manager details for the recovery error window', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child as unknown as ChildProcess) as unknown as ProfileMaterializerSpawn
    const resultPromise = materializeProfile(options(spawn))
    child.stdout.end('resolution completed')
    child.stderr.end('ERR_PNPM_OUTDATED_LOCKFILE')
    child.emit('close', 1, null)
    const cause = await resultPromise.catch((error: unknown) => error)

    const detail = formatProfileMaterializationFailure(cause)
    expect(detail).toContain('Command: pnpm --config.minimumReleaseAge=0 install --frozen-lockfile')
    expect(detail).toContain('Exit status: 1')
    expect(detail).toContain('stderr:\nERR_PNPM_OUTDATED_LOCKFILE')
    expect(detail).toContain('stdout:\nresolution completed')
  })

  it('terminates and rejects when the caller aborts', async () => {
    const child = fakeChild()
    const spawn = vi.fn(() => child as unknown as ChildProcess) as unknown as ProfileMaterializerSpawn
    const controller = new AbortController()
    const resultPromise = materializeProfile({ ...options(spawn), signal: controller.signal })
    controller.abort()
    expect(child.kill).toHaveBeenCalled()
    child.emit('close', null, 'SIGTERM')
    await expect(resultPromise).rejects.toThrow('aborted')
  })
})
