/**
 * Plugin lifecycle: serve the RPC endpoint inside the DSH process, publish the
 * endpoint record and launcher, and close every ACP connection on unload.
 */

import { PROTOCOL_VERSION, type Stream } from '@agentclientprotocol/sdk'
import type { Context } from '@deepseek-ai/cordis'
import { MeshCallServer, type LogContext, type LogLevel, type RpcLogger } from 'meshcall'
import { randomBytes, randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { AcpConnection } from './acp/connection.js'
import { DshHost } from './acp/host.js'
import { InteractionHub } from './acp/interactions.js'
import type { Log } from './acp/log.js'
import { processAlive, readRecords, writeRecord, type EndpointRecord } from './endpoint.js'
import { writeLauncher } from './launcher.js'
import { endpointName, homeSocket, pipeEndpoint, RPC_SERVICE, type LocalEndpoint } from './paths.js'
import { AcpRpcService, type AcpServer } from './rpc.js'

function packageVersion(specifier: string): string | undefined {
  try { return String(createRequire(import.meta.url)(specifier).version) || undefined } catch { return undefined }
}

/** The host resolves this peer to its own copy, so it reports the running DSH release. */
const RUNTIME_VERSION = packageVersion('@deepseek-ai/dsh-typert-protocol/package.json')
const BRIDGE_VERSION = packageVersion('@agents-anywhere/dsh-acp-bridge/package.json') ?? '0.0.0'

/** MeshCall diagnostics through the plugin log; request content is never logged. */
class BridgeRpcLogger implements RpcLogger {
  constructor(private readonly sink: Log) {}
  bind(_context: LogContext): RpcLogger { return this }
  log(level: LogLevel, message: string): void {
    if (level === 'error') this.sink.warn(`acp-bridge rpc: ${message}`)
    else if (level === 'warning') this.sink.info(`acp-bridge rpc: ${message}`)
  }
  debug(): void {}
  info(): void {}
  warning(message: string): void { this.log('warning', message) }
  error(message: string): void { this.log('error', message) }
}

/**
 * A directory only this user can enter. A symbolic link, a non-directory or a
 * directory owned by someone else is refused, never followed or changed.
 */
async function privateDirectory(path: string): Promise<void> {
  await mkdir(path, { recursive: true, mode: 0o700 })
  if (process.platform === 'win32') return
  const info = await lstat(path)
  if (!info.isDirectory() || (process.getuid && info.uid !== process.getuid())) {
    throw new Error(`ACP endpoint directory is not a directory owned by this user: ${path}`)
  }
  if ((info.mode & 0o077) !== 0) await chmod(path, 0o700)
}

/** Fresh directories this plugin makes for sockets whose home path is too long. */
const TEMPORARY_PREFIX = 'aa-dsh-acp-'
function temporarySocketDirectory(socket: string): string | undefined {
  const directory = dirname(socket)
  return dirname(directory) === tmpdir() && basename(directory).startsWith(TEMPORARY_PREFIX) ? directory : undefined
}

export interface BridgeOptions {
  /** Where endpoint records, sockets and the launcher live. */
  home: string
}

export class AcpBridge implements AcpServer {
  private readonly host: DshHost
  private readonly hub: InteractionHub
  private readonly connections = new Set<AcpConnection>()
  private server: MeshCallServer | undefined
  private published: { path: string, endpoint: LocalEndpoint } | undefined
  private closed = false
  private starting: Promise<void> | undefined

  constructor(ctx: Context, private readonly options: BridgeOptions, private readonly log: Log) {
    this.host = new DshHost(ctx, log)
    this.hub = new InteractionHub(ctx, log)
    ctx.on('commands/change', () => { for (const connection of this.connections) connection.refreshCommands() }, { global: true })
  }

  info(): Record<string, unknown> {
    return {
      protocol: 'agents-anywhere-dsh-acp', version: 1, acpProtocolVersion: PROTOCOL_VERSION,
      bridgeVersion: BRIDGE_VERSION, ...(RUNTIME_VERSION ? { runtimeVersion: RUNTIME_VERSION } : {}),
      pid: process.pid, connections: this.connections.size, followed: this.hub.size, interactions: this.hub.available,
    }
  }

  async serve(stream: Stream, signal: AbortSignal): Promise<void> {
    if (this.closed) throw new Error('The ACP bridge is closing.')
    const connection = new AcpConnection(this.host, this.hub, this.log, { version: BRIDGE_VERSION })
    this.connections.add(connection)
    const onAbort = () => { void connection.close().catch(error => this.log.debug('acp-bridge: connection close failed', error)) }
    signal.addEventListener('abort', onAbort, { once: true })
    try {
      await connection.serve(stream)
    } finally {
      signal.removeEventListener('abort', onAbort)
      this.connections.delete(connection)
    }
  }

  start(): Promise<void> {
    return this.starting ??= this.open()
  }

  private async open(): Promise<void> {
    const home = this.options.home
    await privateDirectory(home)
    await this.removeStale()
    const instanceId = randomUUID()
    const token = randomBytes(32).toString('base64url')
    let endpoint: LocalEndpoint
    if (process.platform === 'win32') endpoint = pipeEndpoint(instanceId)
    else {
      const preferred = homeSocket(home, instanceId)
      if (preferred) {
        await privateDirectory(dirname(preferred))
        await rm(preferred, { force: true })
        endpoint = { unixPath: preferred }
      } else {
        // mkdtemp creates a new 0700 directory, so nobody can prepare it in advance.
        endpoint = { unixPath: join(await mkdtemp(join(tmpdir(), TEMPORARY_PREFIX)), `${endpointName(instanceId)}.sock`) }
      }
    }
    const server = new MeshCallServer({
      services: [new AcpRpcService(this, token)], ...endpoint, instanceId,
      accessLog: false, logger: new BridgeRpcLogger(this.log),
    })
    await server.start()
    if (this.closed) { await server.close().catch(() => undefined); return }
    this.server = server
    if ('unixPath' in endpoint) await chmod(endpoint.unixPath, 0o600).catch(() => undefined)
    const record: EndpointRecord = {
      version: 1, protocol: 'meshcall', service: RPC_SERVICE, instanceId, pid: process.pid,
      startedAt: new Date().toISOString(), endpoint, token, bridgeVersion: BRIDGE_VERSION,
      ...(RUNTIME_VERSION ? { runtimeVersion: RUNTIME_VERSION } : {}),
    }
    this.published = { path: await writeRecord(home, record), endpoint }
    // DSH Desktop runs its host with ELECTRON_RUN_AS_NODE=1, which proves its binary allows
    // Node mode. Any other Electron host could start a second app instead: use Node from PATH.
    const electron = Boolean(process.versions.electron)
    const runtime = electron && process.env.ELECTRON_RUN_AS_NODE !== '1' ? 'node' : process.execPath
    const launcher = await writeLauncher(home, {
      runtime, electron: electron && runtime === process.execPath,
      script: fileURLToPath(new URL('./stdio.js', import.meta.url)),
    })
    this.log.info(`acp-bridge: ACP clients can start ${launcher}`)
  }

  /** Records left by DSH processes that exited without unloading the plugin. */
  private async removeStale(): Promise<void> {
    for (const { path, record } of await readRecords(this.options.home)) {
      if (processAlive(record.pid)) continue
      await rm(path, { force: true }).catch(() => undefined)
      if ('unixPath' in record.endpoint) await this.removeSocket(record.endpoint.unixPath)
    }
  }

  private async removeSocket(path: string): Promise<void> {
    await rm(path, { force: true }).catch(() => undefined)
    const temporary = temporarySocketDirectory(path)
    if (temporary) await rm(temporary, { recursive: true, force: true }).catch(() => undefined)
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.starting?.catch(() => undefined)
    const published = this.published
    this.published = undefined
    if (published) await rm(published.path, { force: true }).catch(() => undefined)
    await Promise.allSettled([...this.connections].map(connection => connection.close()))
    await this.server?.close().catch(error => this.log.debug('acp-bridge: RPC server close failed', error))
    if (published && 'unixPath' in published.endpoint) await this.removeSocket(published.endpoint.unixPath)
    await this.hub.close()
  }
}
