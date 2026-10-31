import { PassThrough } from 'node:stream'
import { Context } from '@deepseek-ai/cordis'
import type { PluginOperation } from '@deepseek-ai/dsh-plugin-manager/types'
import type { PluginOperationRunId } from '@deepseek-ai/dsh-plugin-manager/diagnostic'
import { describe, expect, it, onTestFinished, vi } from 'vitest'
import type { createPackageRunner } from '../../src/extensions.ts'
import { hostOperationDiagnostics, installOperationDiagnostics, pluginCommandFacts, recordPluginCommands } from '../../src/upstream-family/operation-diagnostics.ts'
import type { OperationRecord, PluginCommand } from '../../src/upstream-family/operation-record.ts'

const operation: PluginOperation = {
  id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9' as PluginOperation['id'],
  time: '2026-10-19T00:00:00.000Z', reason: 'plugin', phase: 'started', target: 'managed', stage: 'enable',
}
const runId = 'c254ab28-97c9-4382-95e6-2db9c66f98c8' as PluginOperationRunId
const command: PluginCommand = {
  id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca', time: '2026-10-19T00:00:01.000Z', action: 'remove', target: 'dsh-foo', phase: 'started',
}

it('bounds outstanding deliveries and drains them on context disposal', async () => {
  const ctx = new Context()
  const entered = Promise.withResolvers<undefined>()
  const release = Promise.withResolvers<undefined>()
  onTestFinished(async () => { release.resolve(undefined); await ctx.fiber.dispose() })
  const send = vi.fn(async (_record: OperationRecord) => { entered.resolve(undefined); await release.promise })
  installOperationDiagnostics(ctx, send, 1, runId)
  ctx.emit('plugin-manager/operation', operation)
  await entered.promise
  for (let i = 0; i < 1000; i++) ctx.emit('plugin-manager/operation', operation)
  expect(send).toHaveBeenCalledTimes(1)
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ runId }))
  let stopped = false
  const stopping = ctx.fiber.dispose().then(() => { stopped = true })
  await Promise.resolve(undefined)
  expect(stopped).toBe(false)
  release.resolve(undefined)
  await stopping
  ctx.emit('plugin-manager/operation', operation)
  expect(send).toHaveBeenCalledTimes(1)
})

it('contains transport rejections during teardown', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  installOperationDiagnostics(ctx, async () => { throw new Error('disconnected') }, 1, runId)
  ctx.emit('plugin-manager/operation', operation)
  await expect(ctx.fiber.dispose()).resolves.toBeUndefined()
})

it('delivers plugin commands with the omissions counted before them', async () => {
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  const sent: OperationRecord[] = []
  let fail = true
  installOperationDiagnostics(ctx, async (record) => {
    sent.push(record)
    if (fail) { fail = false; throw new Error('disconnected') }
  }, 32, runId)
  ctx.emit('desktop/plugin-command', command)
  await vi.waitFor(() => { expect(sent).toHaveLength(1) })
  await Promise.resolve(undefined)
  ctx.emit('desktop/plugin-command', { ...command, phase: 'settled', exitCode: 0 })
  ctx.emit('plugin-manager/operation', operation)
  await vi.waitFor(() => { expect(sent).toHaveLength(3) })
  expect(sent).toEqual([
    { runId, pluginCommand: command, transportDropped: 0 },
    { runId, pluginCommand: { ...command, phase: 'settled', exitCode: 0 }, transportDropped: 1 },
    { runId, operation, transportDropped: 1 },
  ])
})

it('announces the run before observing and sends its records with the same identity', async () => {
  const messages: unknown[] = []
  const operations = hostOperationDiagnostics(async (message) => { messages.push(message) })
  expect(messages).toEqual([{ type: 'starting', runId: expect.stringMatching(/^[0-9a-f-]{36}$/u) }])
  const announced = (messages[0] as { runId: string }).runId
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  operations.observe(ctx)
  ctx.emit('plugin-manager/operation', operation)
  await vi.waitFor(() => { expect(messages).toHaveLength(2) })
  expect(messages[1]).toEqual({ type: 'plugin-operation', record: { runId: announced, operation, transportDropped: 0 } })
})

describe('plugin commands run through desktopPnpm', () => {
  type PackageRunner = ReturnType<typeof createPackageRunner>
  function runner(done: Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>, start = vi.fn()) {
    return {
      run: vi.fn(), dispose: vi.fn(async () => {}),
      runPlugin: vi.fn((...args: Parameters<PackageRunner['runPlugin']>) => {
        start(...args)
        return { stdout: new PassThrough(), stderr: new PassThrough(), done, cancel: vi.fn() }
      }),
    } satisfies PackageRunner
  }
  function observe(ctx: Context): PluginCommand[] {
    const events: PluginCommand[] = []
    ctx.on('desktop/plugin-command', (event) => { events.push(event) })
    return events
  }

  it.each([
    [['add', '--force', '--config.minimum-release-age=0', 'dsh-foo@1.2.3'], { action: 'add', target: 'dsh-foo', version: '1.2.3' }],
    [['add', '@scope/dsh-bar@latest', '--reporter=ndjson'], { action: 'add', target: '@scope/dsh-bar' }],
    [['remove', 'dsh-foo'], { action: 'remove', target: 'dsh-foo' }],
    [['rm', '@scope/dsh-bar'], { action: 'remove', target: '@scope/dsh-bar' }],
    [['install'], { action: 'install', target: null }],
    [['add', 'dsh-foo', 'dsh-bar'], { action: 'add', target: null }],
    [['add', '--offline', 'file:/Users/someone/plugin'], { action: 'add', target: null }],
    [['add', 'github:someone/plugin'], { action: 'add', target: null }],
    [['update', 'dsh-foo@^2.0.0'], { action: 'update', target: 'dsh-foo' }],
    [['outdated'], { action: 'other', target: null }],
  ] as const)('describes %j without raw specs', (argv, facts) => {
    expect(pluginCommandFacts(argv)).toEqual(facts)
  })

  it('reports a started command and how it ended, keeping the runner otherwise unchanged', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const events = observe(ctx)
    const ended = Promise.withResolvers<{ exitCode: number | null; signal: NodeJS.Signals | null }>()
    const original = runner(ended.promise)
    const observed = recordPluginCommands(ctx, original)
    expect(observed.run).toBe(original.run)
    expect(observed.dispose).toBe(original.dispose)
    const signal = new AbortController().signal
    const handle = observed.runPlugin(['add', 'dsh-foo@1.2.3'], '/profiles/desktop', signal)
    expect(original.runPlugin).toHaveBeenCalledWith(['add', 'dsh-foo@1.2.3'], '/profiles/desktop', signal)
    expect(handle.done).toBe(ended.promise)
    await vi.waitFor(() => { expect(events).toHaveLength(1) })
    ended.resolve({ exitCode: 1, signal: null })
    await vi.waitFor(() => { expect(events).toHaveLength(2) })
    expect(events[0]).toMatchObject({ action: 'add', target: 'dsh-foo', version: '1.2.3', phase: 'started' })
    expect(events[1]).toMatchObject({ id: events[0]!.id, action: 'add', target: 'dsh-foo', phase: 'settled', exitCode: 1 })
    expect(events[1]).not.toHaveProperty('signal')
  })

  it('reports a killed command with its signal and a command it could not observe as unknown', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const events = observe(ctx)
    recordPluginCommands(ctx, runner(Promise.resolve({ exitCode: null, signal: 'SIGTERM' }))).runPlugin(['remove', 'dsh-foo'], '/profiles/desktop')
    const failed = Promise.reject(new Error('spawn ENOENT'))
    failed.catch(() => {})
    recordPluginCommands(ctx, runner(failed)).runPlugin(['remove', 'dsh-bar'], '/profiles/desktop')
    await vi.waitFor(() => { expect(events).toHaveLength(4) })
    expect(events.filter(event => event.phase !== 'started')).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: 'dsh-foo', phase: 'settled', exitCode: null, signal: 'SIGTERM' }),
      expect.objectContaining({ target: 'dsh-bar', phase: 'unknown' }),
    ]))
  })

  it('reports nothing for a command the runner refuses to start', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    const events = observe(ctx)
    const refusing = runner(Promise.resolve({ exitCode: 0, signal: null }), vi.fn(() => { throw new Error('A profile package operation is already active') }))
    expect(() => recordPluginCommands(ctx, refusing).runPlugin(['add', 'dsh-foo'], '/profiles/desktop')).toThrow('already active')
    await new Promise(resolve => setImmediate(resolve))
    expect(events).toEqual([])
  })
})
