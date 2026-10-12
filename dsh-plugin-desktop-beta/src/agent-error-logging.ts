/** Persist reported agent failures, with their whole `cause` chain, to the desktop log files. */

import type { Context } from '@deepseek-ai/cordis'
// Pulls in the `agent/error` entry that `@deepseek-ai/dsh-agent` merges into
// Cordis' `Events` interface; without it the event name does not type-check.
import type {} from '@deepseek-ai/dsh-agent'

/** Logger name every recorded failure carries, and the token to grep the logs for. */
const AGENT_ERROR_LOGGER = 'dsh-agent-error'

/** Ceiling for the one-line chain summary; the per-level stacks below it carry the rest. */
const MAX_CHAIN_TEXT = 2000

/** A flattened failure chain plus the stable codes found along it. */
export interface AgentErrorDigest {
  /** Outermost message first, each distinct cause appended with `: `. */
  readonly text: string
  /** De-duplicated `code` values along the chain, outermost first. */
  readonly codes: readonly string[]
}

/**
 * Read a non-empty string `code` without `instanceof`: a `HarnessError` may
 * arrive from a separately resolved copy of the kernel packages, and Node
 * system errors (`ENOENT`, `ECONNRESET`) expose the same field shape.
 * @param value - one level of a cause chain.
 * @returns the stable failure code, or undefined when the level carries none.
 */
function codeOf(value: unknown): string | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  try {
    const code: unknown = (value as { code?: unknown }).code
    return typeof code === 'string' && code.length > 0 ? code : undefined
  } catch {
    // A hostile or throwing accessor must never break a failure report.
    return undefined
  }
}

/**
 * Render one chain level, mirroring the shape of the kernel's `errorChain()`
 * (`packages/llm/llm/src/error.ts`) so the persisted text matches the failure
 * notice the renderer already showed the user.
 * @param value - the level to render.
 * @param path - the active recursion path, for cycle detection.
 * @param codes - collector for every code seen along the chain.
 * @returns the level's message with its members and cause appended.
 */
function renderLevel(value: unknown, path: Set<unknown>, codes: Set<string>): string {
  if (path.has(value)) return '<circular cause>'
  path.add(value)
  try {
    const code = codeOf(value)
    if (code !== undefined) codes.add(code)
    if (!(value instanceof Error)) {
      if (typeof value === 'object' && value !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(value, 'message')
        if (descriptor !== undefined && 'value' in descriptor && typeof descriptor.value === 'string') {
          return descriptor.value
        }
      }
      return String(value)
    }
    const message = value.message === '' ? value.name : value.message
    const members = value instanceof AggregateError && value.errors.length > 0
      ? ` [${value.errors.map(member => renderLevel(member, path, codes)).join('; ')}]`
      : ''
    const causeText = value.cause === undefined || value.cause === null
      ? ''
      : renderLevel(value.cause, path, codes)
    // Wrappers built as `new HarnessError(String(value), code, { cause: value })`
    // repeat their cause verbatim; rendering it twice is pure noise.
    const cause = causeText === '' || causeText === message ? '' : `: ${causeText}`
    return `${message}${members}${cause}`
  } catch {
    // Only hostile coercion reaches here; collapse this node, keep the chain.
    return '<unrenderable value>'
  } finally {
    path.delete(value)
  }
}

/**
 * Flatten one reported failure into a bounded single-line summary plus the
 * stable codes along its chain. A `HarnessError` keeps its code in a field, so
 * neither `message` nor `stack` contains it — only this pass makes a code such
 * as `REQUEST_EXTENSION` searchable in the logs.
 * @param error - the value reported by `agent/error` (declared `unknown`).
 * @returns the capped chain text and its de-duplicated failure codes.
 */
export function digestAgentError(error: unknown): AgentErrorDigest {
  const codes = new Set<string>()
  const rendered = renderLevel(error, new Set<unknown>(), codes)
  const text = rendered.length > MAX_CHAIN_TEXT ? `${rendered.slice(0, MAX_CHAIN_TEXT)}…` : rendered
  return { text, codes: [...codes] }
}

/**
 * Build the searchable line recorded for one reported agent failure.
 *
 * Field names are deliberately not written as `code:` or `session:`:
 * `maskSecrets()` treats both as secret-shaped names and would replace the
 * value that follows with `****`, erasing the two identifiers this line exists
 * to expose.
 * @param sessionId - the failing agent's session identity.
 * @param turn - the turn in which the failure surfaced.
 * @param step - the step at which the failure surfaced.
 * @param error - the value reported by `agent/error`.
 * @returns one masking-safe line carrying the codes and the whole cause chain.
 */
export function formatAgentErrorLine(
  sessionId: string,
  turn: number,
  step: number,
  error: unknown,
): string {
  const { text, codes } = digestAgentError(error)
  const tags = codes.length === 0 ? '' : ` [${codes.join(' ')}]`
  return `agent turn failed (session ${sessionId}, turn ${String(turn)}, step ${String(step)})${tags}: ${text}`
}

/**
 * Record every reported agent failure on the Host logger, so the desktop file
 * exporter persists a searchable digest followed by each cause level's stack.
 *
 * `agent/error` is the only place the live exception is still reachable: the
 * `api-session/error` relay flattens it to text for the renderer, and
 * `LlmError.failure` drops `cause` altogether. Cordis expands `cause` only for
 * a single-argument `logger.error(error)` call, so the digest and the error
 * object must be logged as two separate calls.
 * @param ctx - the Host context whose logger owns the desktop file exporter.
 * @returns a disposer removing the listener; the owning fiber also unloads it.
 */
export function installAgentErrorLogging(ctx: Context): () => boolean {
  const logger = ctx.logger(AGENT_ERROR_LOGGER)
  return ctx.on('agent/error', ({ agent, turn, step, error }) => {
    try {
      logger.error(formatAgentErrorLine(String(agent.id), turn, step, error))
      // Single argument, on its own call: Cordis walks `cause` and
      // `AggregateError.errors` only when the sole argument is an Error. A
      // non-Error payload stays with the digest above, because `Logger.format`
      // would otherwise `JSON.stringify` it and throw on a circular structure.
      if (error instanceof Error) logger.error(error)
    } catch {
      // The sink can fail (denied permission, full volume). Diagnostics must
      // never destabilize a turn that has already failed.
    }
  })
}
