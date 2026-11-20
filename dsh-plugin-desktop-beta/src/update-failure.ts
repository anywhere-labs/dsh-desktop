/** Why an installer download failed, for update copy the user can act on. */

/** Download failures the update copy explains, as in the official Desktop. */
export type UpdateDownloadFailure = 'space' | 'permission' | 'busy' | 'network'

/** Chromium and Node connection failures, the transport's idle timeout included. */
const NETWORK_FAILURE = /\b(?:ERR_CONNECTION_(?:CLOSED|RESET|REFUSED|TIMED_OUT|FAILED)|ERR_INTERNET_DISCONNECTED|ERR_NAME_NOT_RESOLVED|ERR_NETWORK_CHANGED|ERR_TIMED_OUT|ETIMEDOUT|ECONNRESET)\b/u

/** Nesting depth of causes and aggregated errors that a classification follows. */
const MAX_CAUSE_DEPTH = 4

/**
 * Classify a failed installer download by the filesystem or connection error under it. A filesystem cause wins:
 * it names what the user can fix on this computer.
 * @param error - Download failure, possibly wrapping its cause or aggregating a cleanup failure.
 * @returns The failure kind, or undefined when the error names none.
 */
export function updateDownloadFailure(error: unknown): UpdateDownloadFailure | undefined {
  const errors = causes(error, 0)
  for (const cause of errors) {
    const code = errorCode(cause)
    if (code === 'ENOSPC') return 'space'
    if (code === 'EACCES' || code === 'EPERM' || code === 'EROFS') return 'permission'
    if (code === 'EBUSY') return 'busy'
  }
  return errors.some(cause => NETWORK_FAILURE.test(`${errorCode(cause) ?? ''} ${cause.message}`)) ? 'network' : undefined
}

function errorCode(error: Error): string | undefined {
  return 'code' in error && typeof error.code === 'string' ? error.code : undefined
}

function causes(error: unknown, depth: number): Error[] {
  if (!(error instanceof Error) || depth > MAX_CAUSE_DEPTH) return []
  const nested = error instanceof AggregateError ? error.errors : []
  return [error, ...causes(error.cause, depth + 1), ...nested.flatMap(item => causes(item, depth + 1))]
}
