import { PassThrough } from 'node:stream'
import { delimiter, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessRuntime, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { describe, expect, it, vi } from 'vitest'
import { apply, inject, name, type DesktopPnpm, type DesktopPnpmBootstrap } from '../src/pnpm.ts'
import { PNPM_IGNORE_MINIMUM_RELEASE_AGE, withDesktopPnpmPolicy } from '../src/pnpm-policy.ts'

interface Deferred<T> { promise: Promise<T>; resolve(value: T): void; reject(cause: unknown): void }
interface ControlledSubprocess extends SubprocessHandle {
  resolveDone(outcome: SubprocessOutcome): void
  resolveTree(exited?: boolean): void
  terminate: ReturnType<typeof vi.fn<() => void>>
  waitForExit: ReturnType<typeof vi.fn<(signal?: AbortSignal) => Promise<boolean>>>
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (cause: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

function child(): ControlledSubprocess {
  const outcome = deferred<SubprocessOutcome>()
  const tree = deferred<boolean>()
  return {
    pid: 43120,
    stdin: undefined,
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    collected: {},
    done: outcome.promise,
    terminate: vi.fn(),
    waitForExit: vi.fn(() => tree.promise),
    resolveDone: value => { outcome.resolve(value) },
    resolveTree: (value = true) => { tree.resolve(value) },
  }
}

function bootstrap(root = '/desktop runtime'): DesktopPnpmBootstrap {
  return {
    activeProfileName: 'work',
    activeProfileDir: join(root, 'profiles', 'work'),
    homeDir: join(root, 'harness home'),
    appExecutable: join(root, 'DSH Desktop'),
    pnpmBinPath: join(root, 'node_modules', 'pnpm', 'bin', 'pnpm.mjs'),
    electronVersion: '43.4.0',
    nodeBinDir: join(root, 'private', 'node-bin'),
    nodeShimPath: join(root, 'private', 'node-bin', 'node'),
    clearEnvironmentPath: join(root, 'private', 'clear-env.mjs'),
    dshBootstrapPath: join(root, 'app.asar', 'lib', 'desktop-cli.js'),
  }
}

async function harness(children: ControlledSubprocess[]): Promise<{
  ctx: Context
  service: DesktopPnpm
  spawn: ReturnType<typeof vi.fn<(spec: SubprocessSpawnSpec) => SubprocessHandle>>
  dispose(): Promise<void>
}> {
  const ctx = new Context()
  const spawn = vi.fn<(spec: SubprocessSpawnSpec) => SubprocessHandle>(() => {
    const next = children.shift()
    if (next === undefined) throw new Error('empty child queue')
    return next
  })
  ctx.provide('desktopPnpmBootstrap', bootstrap())
  ctx.provide('subprocess', { spawn } as unknown as SubprocessRuntime)
  const fiber = ctx.plugin({ name, inject, apply })
  await fiber
  return { ctx, service: ctx.desktopPnpm, spawn, dispose: fiber.dispose }
}

function finish(process: ControlledSubprocess, exitCode = 0): void {
  process.resolveDone({ exitCode, signal: null })
  process.resolveTree()
}

describe('desktop pnpm execution service', () => {
  it('applies the release-age policy exactly once to direct pnpm argv', () => {
    expect(withDesktopPnpmPolicy(['remove', 'example'])).toEqual([
      PNPM_IGNORE_MINIMUM_RELEASE_AGE,
      'remove',
      'example',
    ])
    expect(withDesktopPnpmPolicy([
      PNPM_IGNORE_MINIMUM_RELEASE_AGE,
      'remove',
      'example',
    ])).toEqual([
      PNPM_IGNORE_MINIMUM_RELEASE_AGE,
      'remove',
      'example',
    ])
  })

  it('starts packaged pnpm in the active Profile without recovery side effects', async () => {
    const process = child()
    const target = await harness([process])
    const signal = new AbortController().signal
    const operation = target.service.run(['add', '--save-exact', 'example@1.2.3'], signal)
    expect(target.service).not.toHaveProperty('installPlugin')
    expect(target.service).not.toHaveProperty('rollbackPluginInstall')
    expect(target.spawn).toHaveBeenCalledWith({
      argv: [
        bootstrap().appExecutable,
        '--import',
        pathToFileURL(bootstrap().clearEnvironmentPath).href,
        bootstrap().pnpmBinPath,
        '--config.minimumReleaseAge=0',
        'add',
        '--save-exact',
        'example@1.2.3',
      ],
      cwd: bootstrap().activeProfileDir,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: 3_000,
      signal,
      env: {
        PATH: `${bootstrap().nodeBinDir}${delimiter}${globalThis.process.env.PATH ?? ''}`,
        NODE: bootstrap().nodeShimPath,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: bootstrap().homeDir,
        CI: 'true',
        npm_config_runtime: 'electron',
        npm_config_target: '43.4.0',
        npm_config_disturl: 'https://electronjs.org/headers',
      },
    })
    operation.cancel()
    expect(process.terminate).toHaveBeenCalledOnce()
    finish(process)
    await expect(operation.done).resolves.toEqual({ exitCode: 0, signal: null })
    await target.dispose()
  })

  it('runs plugin argv through the packaged DSH CLI from the caller directory', async () => {
    const process = child()
    const target = await harness([process])
    const operation = target.service.runPlugin(
      ['add', '--reporter=ndjson', 'example@1.2.3'],
      '/workspace/plugin-manager',
    )
    expect(target.spawn.mock.calls[0]?.[0]).toMatchObject({
      argv: [
        bootstrap().appExecutable,
        '--expose-internals',
        bootstrap().dshBootstrapPath,
        'plugin',
        '--profile',
        bootstrap().activeProfileName,
        'add',
        '--reporter=ndjson',
        'example@1.2.3',
      ],
      cwd: '/workspace/plugin-manager',
    })
    finish(process)
    await operation.done
    await target.dispose()
  })

  it('keeps the dshmarket install adapter exact and free of install recovery', async () => {
    const process = child()
    const target = await harness([process])
    const operation = target.service.runExternalMarketPluginInstall(
      ['add', '--reporter=ndjson', '@scope/example@1.2.3'],
      '/workspace/dshmarket',
    )
    expect(target.spawn.mock.calls[0]?.[0]).toMatchObject({
      argv: [
        bootstrap().appExecutable,
        '--expose-internals',
        bootstrap().dshBootstrapPath,
        'plugin',
        '--profile',
        bootstrap().activeProfileName,
        'add',
        '--reporter=ndjson',
        '@scope/example@1.2.3',
      ],
      cwd: '/workspace/dshmarket',
    })
    finish(process)
    await operation.done
    await target.dispose()
  })

  it('rejects malformed external Market install argv before spawning', async () => {
    const target = await harness([])
    for (const argv of [
      ['remove', 'example@1.2.3'],
      ['add', 'example'],
      ['add', 'example@latest'],
      ['add', 'example@1.2.3', 'other@1.0.0'],
    ]) {
      expect(() => target.service.runExternalMarketPluginInstall(argv, '/workspace')).toThrow()
    }
    expect(() => target.service.runPlugin(['add', 'example@1.2.3'], 'relative')).toThrow(
      'plugin invoking directory must be an absolute path',
    )
    expect(target.spawn).not.toHaveBeenCalled()
    await target.dispose()
  })

  it('holds a single operation gate until the process tree exits', async () => {
    const first = child()
    const second = child()
    const target = await harness([first, second])
    const running = target.service.run(['list'])
    expect(() => target.service.run(['remove', 'example'])).toThrow('already running')
    first.resolveDone({ exitCode: 0, signal: null })
    await Promise.resolve()
    expect(() => target.service.run(['remove', 'example'])).toThrow('already running')
    first.resolveTree()
    await running.done
    const next = target.service.run(['remove', 'example'])
    finish(second)
    await next.done
    await target.dispose()
  })

  it('rejects empty/NUL argv and a pre-aborted signal before spawning', async () => {
    const target = await harness([])
    expect(() => target.service.run([])).toThrow('must not be empty')
    expect(() => target.service.run(['add', 'bad\0name'])).toThrow('without NUL')
    const controller = new AbortController()
    controller.abort()
    expect(() => target.service.run(['list'], controller.signal)).toThrow()
    expect(target.spawn).not.toHaveBeenCalled()
    await target.dispose()
  })

  it('terminates an active operation during service disposal', async () => {
    const process = child()
    const target = await harness([process])
    target.service.run(['list'])
    const dispose = target.dispose()
    await vi.waitFor(() => expect(process.terminate).toHaveBeenCalledOnce())
    finish(process)
    await dispose
    expect(target.ctx.get('desktopPnpm')).toBeUndefined()
  })
})
