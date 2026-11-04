/**
 * Plugin operation records that the Desktop journals for failure reports. Plugin manager operations use
 * the record dsh 0.2.2 defines in `@deepseek-ai/dsh-plugin-manager/diagnostic`. Plugin commands that a
 * market runs through `desktopPnpm.runPlugin`, such as dsh-market's installs and removals, bypass the
 * plugin manager service, so they use the Desktop's own record below.
 */
import { parsePluginOperationRecord, type PluginOperationRecord, type PluginOperationRunId } from '@deepseek-ai/dsh-plugin-manager/diagnostic'

/** The pnpm command a plugin command runs, by the name `dsh plugin` passes on. */
export type PluginCommandAction = 'add' | 'install' | 'remove' | 'update' | 'other'

/** One plugin command run through `desktopPnpm.runPlugin`; a start without an end has an unknown outcome. */
export type PluginCommand = {
  readonly id: string
  readonly time: string
  readonly action: PluginCommandAction
  /** The registry package the command names alone; other specs, which can carry paths or credentials, are omitted. */
  readonly target: string | null
  /** The exact version the command requested; absent for ranges, tags and other specs. */
  readonly version?: string | undefined
} & ({
  readonly phase: 'started'
} | {
  readonly phase: 'settled'
  /** The command's exit code; null when a signal ended it. */
  readonly exitCode: number | null
  readonly signal?: string | undefined
} | {
  /** The command process could not be observed to its end. */
  readonly phase: 'unknown'
})

/** One journaled plugin command, correlated with the Host run that observed it. */
export interface PluginCommandRecord {
  readonly runId: PluginOperationRunId
  readonly pluginCommand: PluginCommand
  /** Records the Host omitted before this one; a lower bound, as in {@link PluginOperationRecord}. */
  readonly transportDropped: number
}

/** A journaled plugin manager operation or plugin command. */
export type OperationRecord = PluginOperationRecord | PluginCommandRecord

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/u
const SIGNAL = /^SIG[A-Z0-9]{1,12}$/u
const ACTIONS: ReadonlySet<string> = new Set<PluginCommandAction>(['add', 'install', 'remove', 'update', 'other'])

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function boundedText(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

/**
 * @param value - Untrusted decoded IPC or file data.
 * @returns Whether it is a Host run identity, as the Host announces it with `starting`.
 */
export function isOperationRunId(value: unknown): value is PluginOperationRunId {
  return typeof value === 'string' && UUID.test(value)
}

/** The Host's plugin operation evidence: its run announcement, or one record whose content is still unchecked. */
export type OperationEvidence = { readonly type: 'starting'; readonly runId: PluginOperationRunId } | { readonly type: 'plugin-operation'; readonly record?: unknown }

/**
 * Recognize plugin operation evidence among the Host's IPC messages. A shell that keeps no history drops
 * it, as upstream Desktop's shell does without an operation sink.
 * @param message - A message the Host sent over IPC.
 * @returns Whether it is a run announcement with a valid identity or a record message.
 */
export function isOperationEvidence(message: unknown): message is OperationEvidence {
  if (!isObject(message)) return false
  return message.type === 'starting' ? isOperationRunId(message.runId) : message.type === 'plugin-operation'
}

function parsePluginCommand(value: unknown): PluginCommand | undefined {
  if (!isObject(value)) return undefined
  const { id, time, action, target, version, phase } = value
  if (typeof id !== 'string' || !UUID.test(id) || typeof time !== 'string' || !ISO_TIME.test(time) || Number.isNaN(Date.parse(time))
    || typeof action !== 'string' || !ACTIONS.has(action) || !(target === null || boundedText(target, 256))
    || !(version === undefined || boundedText(version, 128))) return undefined
  const facts = { id, time, action: action as PluginCommandAction, target, ...(version === undefined ? {} : { version }) }
  if (phase === 'started' || phase === 'unknown') return { ...facts, phase }
  if (phase !== 'settled') return undefined
  const { exitCode, signal } = value
  if (!(exitCode === null || Number.isSafeInteger(exitCode)) || !(signal === undefined || (typeof signal === 'string' && SIGNAL.test(signal)))) return undefined
  return { ...facts, phase, exitCode: exitCode as number | null, ...(signal === undefined ? {} : { signal }) }
}

/**
 * Validate a plugin command record and discard fields outside its whitelist.
 * @param value - Untrusted decoded IPC or file data.
 * @returns A bounded record, or undefined for malformed or unsupported records.
 */
export function parsePluginCommandRecord(value: unknown): PluginCommandRecord | undefined {
  if (!isObject(value) || !isOperationRunId(value.runId) || !Number.isSafeInteger(value.transportDropped) || (value.transportDropped as number) < 0) return undefined
  const pluginCommand = parsePluginCommand(value.pluginCommand)
  return pluginCommand === undefined ? undefined : { runId: value.runId, pluginCommand, transportDropped: value.transportDropped as number }
}

/**
 * Validate a journaled record of either kind and discard fields outside its whitelist.
 * @param value - Untrusted decoded IPC or file data.
 * @returns A bounded record, or undefined for malformed, oversized or unsupported records.
 */
export function parseOperationRecord(value: unknown): OperationRecord | undefined {
  return parsePluginOperationRecord(value) ?? parsePluginCommandRecord(value)
}
