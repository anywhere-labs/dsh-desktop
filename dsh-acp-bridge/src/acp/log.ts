/** Diagnostics for the plugin: DSH's logger in production, nothing in tests. */

export interface Log {
  debug(message: string, error?: unknown): void
  info(message: string, error?: unknown): void
  warn(message: string, error?: unknown): void
  error(message: string, error?: unknown): void
}

/** Error text without request content: only the error's own message and code. */
export function describe(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code
    return `${error.name}${typeof code === 'string' || typeof code === 'number' ? ` [${code}]` : ''}: ${error.message}`
  }
  return String(error)
}

interface CordisLogger {
  debug(format: string, ...args: unknown[]): void
  info(format: string, ...args: unknown[]): void
  warn(format: string, ...args: unknown[]): void
  error(format: string, ...args: unknown[]): void
}

export function fromCordis(logger: CordisLogger): Log {
  const write = (level: keyof CordisLogger) => (message: string, error?: unknown) => {
    try {
      if (error === undefined) logger[level]('%s', message)
      else logger[level]('%s: %s', message, describe(error))
    } catch { /* Logging never fails an operation. */ }
  }
  return { debug: write('debug'), info: write('info'), warn: write('warn'), error: write('error') }
}

export const silentLog: Log = { debug() {}, info() {}, warn() {}, error() {} }
