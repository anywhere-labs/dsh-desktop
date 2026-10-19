/**
 * Retries a fetch whose TCP connect failed.
 *
 * A loaded Windows host can report `ETIMEDOUT` while connecting to a listener
 * that is already bound in the same process, which makes request-driven specs
 * fail for reasons that have nothing to do with the behavior under test. Only a
 * failed connect is retried, so a request that may have been delivered is never
 * sent twice and a real HTTP response is never replaced.
 */

/** Transport attempts for one request before its failure surfaces. */
const ATTEMPTS = 6
/** Delay between transport attempts. */
const RETRY_DELAY_MS = 100

/**
 * Whether a failed fetch never reached the server, because its connect failed.
 * @param error - rejection from fetch.
 * @returns true when the request could not have been delivered.
 */
function isConnectFailure(error: unknown): boolean {
  if (error === null || typeof error !== 'object' || !('cause' in error)) return false
  const cause = error.cause
  if (cause === null || typeof cause !== 'object' || !('syscall' in cause)) return false
  return cause.syscall === 'connect'
}

const originalFetch = globalThis.fetch

/**
 * Fetch with bounded transport retries in front of the platform implementation.
 * @param input - request target.
 * @param init - request options.
 * @returns the response the server returned.
 */
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
  let lastError: unknown
  for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
    try {
      return await originalFetch(input, init)
    } catch (error) {
      if (!isConnectFailure(error)) throw error
      lastError = error
      await new Promise(resolve => { setTimeout(resolve, RETRY_DELAY_MS) })
    }
  }
  throw lastError
}
