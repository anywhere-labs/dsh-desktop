/**
 * A Host that could not listen on the port fixed in the Desktop preferences. The Host web server reports it as
 * Node's `listen EADDRINUSE: address already in use <address>:<port>` in the startup failure it sends. Only a
 * failure naming that very port counts: plugins can fail to listen on ports of their own, and an automatic port
 * (0) is always free when the Host takes it.
 */

/** The address another program holds, which the Desktop preferences fix for the Host. */
export interface DesktopPortConflict {
  /** The address the Host tried, such as `127.0.0.1:3000`. */
  readonly address: string
  /** The port the Desktop preferences fix for the Host. */
  readonly port: number
}

const LISTEN_IN_USE = /\blisten EADDRINUSE: address already in use (\S+:(\d+))/gu

/**
 * Find the Host's own listen conflict in a failure.
 * @param text - The failure text and its context.
 * @param configuredPort - The Host port the Desktop preferences fix; 0 for an automatic one.
 * @returns The conflict, or `undefined` when no listen failure names that port.
 */
export function portConflict(text: string, configuredPort: number): DesktopPortConflict | undefined {
  if (configuredPort === 0) return undefined
  for (const match of text.matchAll(LISTEN_IN_USE)) {
    if (Number(match[2]) === configuredPort) return { address: match[1]!, port: configuredPort }
  }
  return undefined
}
