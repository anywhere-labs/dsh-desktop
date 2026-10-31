/**
 * Bounded delivery of plugin management facts to the shell, which owns durable diagnostics. Follows
 * upstream Desktop's `apps/desktop-host/src/operation-diagnostics.ts` (added in dsh 0.2.2) for plugin
 * manager operations, and adds the plugin commands that markets such as dsh-market run through
 * `desktopPnpm.runPlugin`, which never reach the plugin manager service.
 */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-plugin-manager'
import { parsePluginOperationRecord, type PluginOperationRunId } from '@deepseek-ai/dsh-plugin-manager/diagnostic'
import type { createPackageRunner } from '../extensions.ts'
import { parsePluginCommandRecord, type OperationRecord, type PluginCommand, type PluginCommandAction } from './operation-record.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * A plugin command run through `desktopPnpm.runPlugin` started or ended; subscribers run independently of the command.
     * @mode parallel
     * @param command - Correlated command facts; a start without an end has an unknown outcome.
     */
    'desktop/plugin-command'(command: PluginCommand): void | Promise<void>
  }
}

/** Outstanding IPC deliveries; further records are counted as omitted until one settles. */
const MAX_PENDING_DELIVERIES = 32

/**
 * Observe plugin manager operations and plugin commands after Host startup, with bounded concurrent IPC deliveries.
 * @param ctx - Context owning the subscriptions and their pending deliveries.
 * @param send - IPC transport promise which settles when delivery succeeds or fails.
 * @param maxPending - Maximum number of outstanding deliveries; excess events are counted and omitted.
 * @param runId - Host lifetime identity announced before profile startup.
 */
export function installOperationDiagnostics(
  ctx: Context, send: (record: OperationRecord) => Promise<void>, maxPending: number, runId: PluginOperationRunId,
): void {
  if (!Number.isSafeInteger(maxPending) || maxPending < 1) throw new RangeError('Invalid diagnostic delivery budget')
  const pending = new Set<Promise<void>>()
  let dropped = 0
  let closed = false
  // Each record carries the omissions counted before it, so the shell learns them with the next delivery.
  const deliver = (parse: (transportDropped: number) => OperationRecord | undefined): void => {
    if (closed || pending.size >= maxPending) { dropped++; return }
    const record = parse(dropped)
    if (record === undefined) { dropped++; return }
    const delivery = Promise.resolve().then(async () => {
      try { await send(record) }
      catch (_error) { dropped++ /* IPC failure does not change the management operation. */ }
    })
    pending.add(delivery)
    void delivery.then(() => { pending.delete(delivery) })
  }
  ctx.on('plugin-manager/operation', (operation) => {
    deliver(transportDropped => parsePluginOperationRecord({ runId, operation, transportDropped }))
  })
  ctx.on('desktop/plugin-command', (pluginCommand) => {
    deliver(transportDropped => parsePluginCommandRecord({ runId, pluginCommand, transportDropped }))
  })
  ctx.effect(() => async () => {
    closed = true
    await Promise.allSettled(pending)
  })
}

/**
 * Announce this Host run to the shell before the profile starts, so a startup failure and the run's
 * records share one identity.
 * @param send - IPC transport promise which settles when delivery succeeds or fails.
 * @returns Installs the observation on the booted application's context.
 */
export function hostOperationDiagnostics(send: (message: object) => Promise<void>): { observe(ctx: Context): void } {
  const runId = randomUUID() as PluginOperationRunId
  // The shell drops records of a run it never saw announced, so a lost announcement loses only this run's records.
  void send({ type: 'starting', runId }).catch(() => {})
  return {
    observe(ctx) {
      installOperationDiagnostics(ctx, record => send({ type: 'plugin-operation', record }), MAX_PENDING_DELIVERIES, runId)
    },
  }
}

const ACTIONS = new Map<string, PluginCommandAction>([
  ['add', 'add'], ['install', 'install'], ['i', 'install'], ['remove', 'remove'], ['rm', 'remove'], ['uninstall', 'remove'],
  ['un', 'remove'], ['update', 'update'], ['up', 'update'], ['upgrade', 'update'],
])
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/u
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/u

/**
 * Describe a plugin command the way pnpm reads its arguments: the first argument that is not a flag
 * names the command, and later ones name package specs.
 * @param argv - The arguments `desktopPnpm.runPlugin` received.
 * @returns The command, and the package when exactly one registry spec names it.
 */
export function pluginCommandFacts(argv: readonly string[]): Pick<PluginCommand, 'action' | 'target' | 'version'> {
  const index = argv.findIndex(argument => !argument.startsWith('-'))
  const action = ACTIONS.get(argv[index] ?? '') ?? 'other'
  const specs = index < 0 ? [] : argv.slice(index + 1).filter(argument => !argument.startsWith('-'))
  if (specs.length !== 1) return { action, target: null }
  const spec = specs[0]!
  const at = spec.indexOf('@', 1)
  const name = at < 0 ? spec : spec.slice(0, at)
  if (name.length > 214 || !PACKAGE_NAME.test(name)) return { action, target: null }
  const version = at < 0 ? undefined : spec.slice(at + 1)
  return { action, target: name, ...(version !== undefined && version.length <= 128 && EXACT_VERSION.test(version) ? { version } : {}) }
}

/** The Desktop's package runner, provided to the plugin markets as `desktopPnpm`. */
type PackageRunner = ReturnType<typeof createPackageRunner>

/**
 * Report each plugin command started through `runPlugin` as `desktop/plugin-command` events.
 * @param ctx - Context that emits the events.
 * @param runner - The Desktop's package runner.
 * @returns The runner with an observed `runPlugin`; a command the runner refuses to start is not reported.
 */
export function recordPluginCommands(ctx: Context, runner: PackageRunner): PackageRunner {
  const report = (command: PluginCommand): void => {
    ctx.parallel('desktop/plugin-command', command).catch((_error: unknown) => {
      console.error('dsh-plugin-desktop-beta: plugin command diagnostic delivery failed')
    })
  }
  return {
    ...runner,
    runPlugin(argv, invokingDir, signal) {
      const handle = runner.runPlugin(argv, invokingDir, signal)
      const facts = { id: randomUUID(), ...pluginCommandFacts(argv) }
      report({ ...facts, time: new Date().toISOString(), phase: 'started' })
      void handle.done.then(({ exitCode, signal: ended }) => {
        report({ ...facts, time: new Date().toISOString(), phase: 'settled', exitCode, ...(ended === null ? {} : { signal: ended }) })
      }, (_error: unknown) => {
        report({ ...facts, time: new Date().toISOString(), phase: 'unknown' })
      })
      return handle
    },
  }
}
