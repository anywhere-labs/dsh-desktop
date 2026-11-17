/** Per-user locations shared by the DSH plugin and its stdio launcher. Node built-ins only. */

import { userInfo } from 'node:os'
import { join } from 'node:path'

/** MeshCall service the plugin serves; one duplex call per ACP connection. */
export const RPC_SERVICE = 'aa.dsh.acp.v1.Acp'
/** Call metadata carrying the endpoint token from the endpoint record. */
export const TOKEN_METADATA = 'aa-acp-token'

export type LocalEndpoint = { unixPath: string } | { pipe: string }

/**
 * `~/.agents-anywhere/dsh-acp` under the operating-system user's home. It does
 * not follow DSH_HOME, so the launcher finds every DSH process of this user.
 */
export function defaultHome(): string {
  return join(userInfo().homedir, '.agents-anywhere', 'dsh-acp')
}

export function endpointsDirectory(home: string): string {
  return join(home, 'endpoints')
}

export function launcherPath(home: string, platform: NodeJS.Platform = process.platform): string {
  return join(home, 'bin', platform === 'win32' ? 'dsh-acp.cmd' : 'dsh-acp')
}

export function endpointName(instanceId: string): string {
  return instanceId.replaceAll('-', '').slice(0, 16)
}

export function pipeEndpoint(instanceId: string): LocalEndpoint {
  return { pipe: `\\\\.\\pipe\\agents-anywhere-dsh-acp-${endpointName(instanceId)}` }
}

/**
 * The Unix socket under the home, when it fits `sockaddr_un` (104 bytes on
 * macOS, 108 on Linux, terminator included). Otherwise the plugin listens in a
 * fresh private directory under the temporary directory; the endpoint record
 * carries the full path either way.
 */
export function homeSocket(home: string, instanceId: string): string | undefined {
  const path = join(home, 'sockets', `${endpointName(instanceId)}.sock`)
  return Buffer.byteLength(path) < 100 ? path : undefined
}
