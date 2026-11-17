/**
 * Client failures, reported to the Desktop log: slot entries and Factory occurrences that crashed, with the plugin
 * that registered them; client logger warnings and errors, which the official client writes nowhere, with the Loader
 * entry whose fiber logged them, including those logged before this plugin started; and errors and rejections that
 * nothing caught, with their stacks. At most {@link MAX_CLIENT_REPORTS_PER_SECOND} reports a second leave the page;
 * the rest are counted.
 */
import type { Context, Exporter, Message } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { MAX_CLIENT_NAME_CHARS, MAX_CLIENT_STACK_CHARS, MAX_CLIENT_TEXT_CHARS, type ClientDiagnostic, type ClientError } from '../client-diagnostic.ts'

/** Reports a second that leave the page. */
export const MAX_CLIENT_REPORTS_PER_SECOND = 50

const cut = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit - 1).replace(/[\uD800-\uDBFF]$/u, '')}…`

function describe(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try { return JSON.stringify(value) ?? String(value) } catch { return String(value) }
}

/**
 * Bound whatever the page threw, including a value that is not an Error.
 * @param value - The thrown value or rejection reason.
 * @returns Its name, message and stack within the report limits.
 */
export function clientError(value: unknown): ClientError {
  if (typeof value === 'object' && value !== null && 'message' in value) {
    const error = value as { name?: unknown; message?: unknown; stack?: unknown }
    return { name: cut(String(error.name ?? 'Error'), MAX_CLIENT_NAME_CHARS), message: cut(String(error.message), MAX_CLIENT_TEXT_CHARS),
      stack: cut(typeof error.stack === 'string' ? error.stack : '', MAX_CLIENT_STACK_CHARS) }
  }
  return { name: 'Error', message: cut(describe(value), MAX_CLIENT_TEXT_CHARS), stack: '' }
}

/**
 * Render a logger message as one line: printf-style placeholders in a leading string take the next arguments.
 * @param args - The logger call's arguments.
 * @returns The line within the report limit.
 */
export function formatLogMessage(args: readonly unknown[]): string {
  const rest = [...args]
  const first = rest.shift()
  let text = typeof first === 'string'
    ? first.replace(/%([sdiojOcC%])/gu, (placeholder, kind: string) => kind === '%' ? '%' : rest.length === 0 ? placeholder : describe(rest.shift()))
    : describe(first)
  for (const arg of rest) text += ` ${describe(arg)}`
  return cut(text, MAX_CLIENT_TEXT_CHARS)
}

/** The Loader entry whose fiber logged a message: its module name, else its id. */
function entryOf(message: Message): string | null {
  const options = (message.fiber?.deref() as { entry?: { options?: { name?: unknown; id?: unknown } } } | undefined)?.entry?.options
  const name = typeof options?.name === 'string' ? options.name : typeof options?.id === 'string' ? options.id : undefined
  return name === undefined ? null : cut(name, MAX_CLIENT_NAME_CHARS)
}

/**
 * Report this page's client failures until the returned function is called.
 * @param ctx - The Next client plugin's context, which also owns the logger exporter.
 * @param send - Delivers one report to the main process; its failures are ignored.
 * @param now - The clock the rate limit reads.
 * @returns Stops reporting.
 */
export function installClientDiagnostics(ctx: Context, send: (report: ClientDiagnostic) => void, now: () => number = Date.now): () => void {
  let second = Number.NEGATIVE_INFINITY
  let sent = 0
  let dropped = 0
  const deliver = (report: ClientDiagnostic): void => {
    try { send(report) } catch { /* The page goes on whether or not the Desktop received the report. */ }
  }
  const report = (diagnostic: ClientDiagnostic): void => {
    const time = now()
    if (time - second >= 1000) {
      second = time
      sent = 0
      if (dropped > 0) { deliver({ kind: 'dropped', count: dropped }); dropped = 0; sent = 1 }
    }
    if (sent >= MAX_CLIENT_REPORTS_PER_SECOND) { dropped++; return }
    sent++
    deliver(diagnostic)
  }
  deliver({ kind: 'ready' })
  const unsubscribe = ctx.slots.onEntryError((slot, registration, error, { abdicated }) => {
    report({ kind: 'slot-crash', slot: cut(slot, MAX_CLIENT_NAME_CHARS), plugin: registration.registrant === undefined ? null : cut(registration.registrant, MAX_CLIENT_NAME_CHARS),
      abdicated, error: clientError(error) })
  })
  const exporter: Exporter = {
    colors: false,
    levels: { default: 3 },
    export(message) {
      if (message.type !== 'error' && message.type !== 'warn') return
      report({ kind: 'log', level: message.type, logger: cut(message.name, MAX_CLIENT_NAME_CHARS), entry: entryOf(message), message: formatLogMessage(message.args), sn: message.sn })
    },
  }
  // What was logged before this plugin started, such as an entry that failed to load, waits in the logger's buffer.
  for (const message of ctx.logger.buffer) exporter.export(message)
  const removeExporter = ctx.logger.exporter(exporter)
  const onError = (event: ErrorEvent): void => { report({ kind: 'uncaught', rejection: false, error: clientError(event.error ?? event.message) }) }
  const onRejection = (event: PromiseRejectionEvent): void => { report({ kind: 'uncaught', rejection: true, error: clientError(event.reason) }) }
  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    removeExporter()
    unsubscribe()
  }
}
