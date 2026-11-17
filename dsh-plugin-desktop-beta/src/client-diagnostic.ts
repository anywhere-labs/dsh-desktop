/**
 * Client failures the main window reports to the Desktop log over its diagnostic channel, and their
 * validation in the main process. The client sends plain data that it has already bounded; the main process
 * accepts only these kinds, with every string within its limit, from the main window's current document.
 */
import type { LogInput } from './log-record.ts'

/** Longest message or error message one report carries. */
export const MAX_CLIENT_TEXT_CHARS = 8192
/** Longest stack one report carries. */
export const MAX_CLIENT_STACK_CHARS = 16384
/** Longest slot, plugin or logger name one report carries. */
export const MAX_CLIENT_NAME_CHARS = 512

/** An error from the page, as plain bounded text. */
export interface ClientError {
  readonly name: string
  readonly message: string
  readonly stack: string
}

/** One report from the Next client in the main window. */
export type ClientDiagnostic =
  /** The client's reports are live for this document, so its console no longer needs to be read for them. */
  | { readonly kind: 'ready' }
  /** A slot entry or Factory occurrence crashed; `plugin` is the registrant the slot registry names. */
  | { readonly kind: 'slot-crash'; readonly slot: string; readonly plugin: string | null; readonly abdicated: boolean; readonly error: ClientError }
  /**
   * A client logger warning or error, which the official client writes nowhere. `entry` is the Loader entry whose
   * fiber logged it: the plugin for its own messages, the enclosing group for the Loader's import failures.
   * `sn` orders the logger's messages.
   */
  | { readonly kind: 'log'; readonly level: 'error' | 'warn'; readonly logger: string; readonly entry: string | null; readonly message: string; readonly sn: number }
  /** An error or rejection that nothing caught. */
  | { readonly kind: 'uncaught'; readonly rejection: boolean; readonly error: ClientError }
  /** Reports the client dropped over its rate. */
  | { readonly kind: 'dropped'; readonly count: number }

const bounded = (value: unknown, limit: number): value is string => typeof value === 'string' && value.length <= limit
const nameOrNull = (value: unknown): value is string | null => value === null || bounded(value, MAX_CLIENT_NAME_CHARS)
const count = (value: unknown): value is number => Number.isSafeInteger(value) && (value as number) >= 0

function isClientError(value: unknown): value is ClientError {
  if (typeof value !== 'object' || value === null) return false
  const error = value as Record<string, unknown>
  return bounded(error.name, MAX_CLIENT_NAME_CHARS) && bounded(error.message, MAX_CLIENT_TEXT_CHARS) && bounded(error.stack, MAX_CLIENT_STACK_CHARS)
}

/**
 * Accept one report from the page.
 * @param value - What the page sent.
 * @returns The report, or `undefined` for anything that is not one.
 */
export function parseClientDiagnostic(value: unknown): ClientDiagnostic | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const report = value as Record<string, unknown>
  switch (report.kind) {
    case 'ready':
      return { kind: 'ready' }
    case 'slot-crash':
      return bounded(report.slot, MAX_CLIENT_NAME_CHARS) && nameOrNull(report.plugin) && typeof report.abdicated === 'boolean' && isClientError(report.error)
        ? { kind: 'slot-crash', slot: report.slot, plugin: report.plugin, abdicated: report.abdicated, error: report.error } : undefined
    case 'log':
      return (report.level === 'error' || report.level === 'warn') && bounded(report.logger, MAX_CLIENT_NAME_CHARS) && nameOrNull(report.entry)
        && bounded(report.message, MAX_CLIENT_TEXT_CHARS) && count(report.sn)
        ? { kind: 'log', level: report.level, logger: report.logger, entry: report.entry, message: report.message, sn: report.sn } : undefined
    case 'uncaught':
      return typeof report.rejection === 'boolean' && isClientError(report.error) ? { kind: 'uncaught', rejection: report.rejection, error: report.error } : undefined
    case 'dropped':
      return count(report.count) ? { kind: 'dropped', count: report.count } : undefined
    default:
      return undefined
  }
}

/**
 * The Desktop log record of one report.
 * @param diagnostic - A report {@link parseClientDiagnostic} accepted.
 * @returns The record, or `undefined` for `ready`, which only opens the channel.
 */
export function clientDiagnosticRecord(diagnostic: ClientDiagnostic): LogInput | undefined {
  const source = 'renderer.client'
  switch (diagnostic.kind) {
    case 'ready':
      return undefined
    case 'slot-crash':
      return { source, event: 'slot.crashed', level: 'error', message: `${diagnostic.error.name}: ${diagnostic.error.message}`,
        fields: { slot: diagnostic.slot, plugin: diagnostic.plugin, abdicated: diagnostic.abdicated }, error: diagnostic.error }
    case 'log':
      return { source, event: 'log', level: diagnostic.level, message: diagnostic.message, fields: { logger: diagnostic.logger, entry: diagnostic.entry } }
    case 'uncaught':
      return { source, event: diagnostic.rejection ? 'unhandled-rejection' : 'uncaught-error', level: 'error',
        message: `${diagnostic.error.name}: ${diagnostic.error.message}`, error: diagnostic.error }
    case 'dropped':
      return { source, event: 'reports.dropped', level: 'warn', fields: { count: diagnostic.count } }
  }
}
