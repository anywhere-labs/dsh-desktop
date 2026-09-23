/** Exercise the installed official routes and launchers without opening a graphical app. */
import { EventEmitter } from 'node:events'
import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import * as OpenInApp from '@deepseek-ai/dsh-host-open-in-app'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const fixture = vi.hoisted(() => ({
  platform: 'darwin', spawn: vi.fn(), exitCode: 0,
  directories: new Set<string>(), files: new Set<string>(),
}))
const workspace = '/fixture/workspace with spaces 中文'
const localAppData = '/fixture/local'
const githubDirectory = `${localAppData}/GitHubDesktop/app-1.0`
const missing = () => Object.assign(new Error('Fixture path is absent'), { code: 'ENOENT' })

vi.mock('node:os', async importOriginal => ({
  ...await importOriginal<typeof import('node:os')>(), platform: () => fixture.platform,
}))
vi.mock('node:child_process', () => ({ spawn: fixture.spawn }))
vi.mock('node:fs/promises', async importOriginal => ({
  ...await importOriginal<typeof import('node:fs/promises')>(),
  stat: async (path: string) => {
    const key = path.replaceAll('\\', '/')
    if (!fixture.directories.has(key) && !fixture.files.has(key)) throw missing()
    return { isDirectory: () => fixture.directories.has(key), isFile: () => fixture.files.has(key) }
  },
  readdir: async (path: string) => {
    if (path.replaceAll('\\', '/') === `${localAppData}/GitHubDesktop`) return ['app-1.0']
    throw missing()
  },
  readFile: async () => { throw missing() },
}))
vi.mock('@deepseek-ai/dsh-native-command', async importOriginal => ({
  canOpenNativePath: () => true,
  openNativePath: async () => { throw new Error('This test must only use the captured editor launcher') },
  runNativeCommand: async () => { throw missing() },
  // dsh 0.1.7 resolves Linux desktop entries through this helper. It is pure path
  // arithmetic, so the real one is used while every command-running export stays stubbed.
  desktopDataDirectories: (await importOriginal<typeof import('@deepseek-ai/dsh-native-command')>()).desktopDataDirectories,
}))

beforeEach(() => {
  fixture.directories.clear(); fixture.files.clear()
  fixture.directories.add(workspace)
  fixture.platform = 'darwin'; fixture.exitCode = 0
  fixture.spawn.mockReset().mockImplementation(() => {
    const child = Object.assign(new EventEmitter(), { unref: vi.fn() })
    queueMicrotask(() => child.emit('exit', fixture.exitCode, null))
    return child
  })
  vi.stubEnv('LOCALAPPDATA', localAppData)
  vi.stubEnv('ELECTRON_RUN_AS_NODE', '1')
  vi.stubEnv('electron_run_as_node', '1')
  vi.stubEnv('EDITOR_TEST_PLAIN', 'retained')
  vi.stubEnv('EDITOR_TEST_API_KEY', 'fixture-credential')
})
afterEach(() => { vi.unstubAllEnvs() })

function routes() {
  const handlers = new Map<string, (request: IncomingMessage, response: ServerResponse) => Promise<void>>()
  const ctx = {
    get: () => createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }]),
    effect: (register: () => unknown) => register(),
    connection: { requestRejection: () => undefined },
    subprocess: { resolveExecutable: async (name: string) => name === 'code' ? '/fixture/bin/code' : null },
    webServer: { register: (route: { path: string; handler: (request: IncomingMessage, response: ServerResponse) => Promise<void> }) => {
      handlers.set(route.path, route.handler)
      return () => {}
    } },
  }
  OpenInApp.apply(ctx as unknown as Context, { probeTimeoutMs: 100, iconTimeoutMs: 100, launchWatchMs: 100 })
  return async (app: string) => {
    const request = Object.assign(Readable.from([Buffer.from(JSON.stringify({ app, path: workspace }))]), {
      method: 'POST', headers: { 'content-type': 'application/json' }, url: '/open-in-app/open',
    })
    const response = { statusCode: 0, body: '', setHeader() {}, end(body: string) { this.body = body } }
    await handlers.get('/open-in-app/open')!(request as unknown as IncomingMessage, response as unknown as ServerResponse)
    return response
  }
}

it.each([
  ['darwin', '/Applications/Visual Studio Code.app', 'open', ['-a', '/Applications/Visual Studio Code.app', workspace]],
  ['win32', `${localAppData}/Programs/Microsoft VS Code/Code.exe`, `${localAppData}/Programs/Microsoft VS Code/Code.exe`, [workspace]],
  ['linux', '/fixture/bin/code', '/fixture/bin/code', [workspace]],
] as const)('opens VS Code through the official %s route without inheriting Host Node mode', async (platform, application, command, args) => {
  fixture.platform = platform
  if (platform === 'darwin') fixture.directories.add(application)
  else fixture.files.add(application)
  const result = await routes()('vscode')
  expect(result.statusCode).toBe(200)
  expect(JSON.parse(result.body)).toEqual({ ok: true })
  expect(fixture.spawn).toHaveBeenCalledOnce()
  const [launched, argv, options] = fixture.spawn.mock.calls[0]!
  expect(launched.replaceAll('\\', '/')).toBe(command)
  expect(argv.map((arg: string) => arg.replaceAll('\\', '/'))).toEqual(args)
  expect(options).toMatchObject({ detached: true, stdio: 'ignore' })
  const environment = options.env
  expect(Object.keys(environment).filter(key => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE')).toEqual([])
  expect(environment.EDITOR_TEST_PLAIN).toBe('retained')
  expect(environment.EDITOR_TEST_API_KEY).toBeUndefined()
  expect(environment.PATH).toBe(process.env.PATH)
  expect(process.env.ELECTRON_RUN_AS_NODE).toBe('1') // The Host still needs its original environment.
})

it('preserves explicit Node mode for the official GitHub Desktop CLI adapter', async () => {
  fixture.platform = 'win32'
  const executable = `${githubDirectory}/GitHubDesktop.exe`
  const cli = `${githubDirectory}/resources/app/cli.js`
  fixture.files.add(executable); fixture.files.add(cli)
  const result = await routes()('github')
  expect(result.statusCode).toBe(200)
  const [command, args, options] = fixture.spawn.mock.calls[0]!
  expect(command.replaceAll('\\', '/')).toBe(executable)
  expect(args.map((arg: string) => arg.replaceAll('\\', '/'))).toEqual([cli, 'open', workspace])
  expect(options.env.ELECTRON_RUN_AS_NODE).toBe('1')
  expect(Object.keys(options.env).filter(key => key.toUpperCase() === 'ELECTRON_RUN_AS_NODE')).toEqual(['ELECTRON_RUN_AS_NODE'])
  expect(options.windowsHide).toBe(true)
})

it('keeps launch failures visible to the official frontend', async () => {
  fixture.directories.add('/Applications/Visual Studio Code.app')
  fixture.exitCode = 2
  const result = await routes()('vscode')
  expect(result.statusCode).toBe(502)
  expect(JSON.parse(result.body).code).toBe('launch-failed')
})
