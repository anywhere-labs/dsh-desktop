/**
 * Client for the plugin's local RPC, contract version 1 (see contract.ts),
 * published as `@agents-anywhere/dsh-acp-bridge/client`. It finds a running DSH
 * that loaded the plugin, has it prove that it wrote its endpoint record
 * before the token leaves this process, and opens ACP connections to it.
 * It needs Node.js and meshcall only, not DSH; the stdio launcher is built on it.
 *
 * Every ACP connection behaves as one editor connection: when it ends, the
 * prompts it started that are still running are cancelled and its queued
 * messages are withdrawn. A DSH restart ends every connection, and the next
 * DSH serves a new endpoint: connect again, `initialize`, then `session/load`
 * or `session/resume` the session to continue it.
 */

import type { AnyMessage, Stream } from '@agentclientprotocol/sdk'
import { MeshCallClient, type RpcLogger } from 'meshcall'
import { randomBytes } from 'node:crypto'
import { CONTRACT_VERSION, parseInfo, PROTOCOL, RPC_SERVICE, TOKEN_METADATA, type BridgeInfo } from './contract.js'
import { processAlive, readRecords, validProof, type EndpointRecord } from './endpoint.js'
import { defaultHome, type LocalEndpoint } from './paths.js'

export { CONTRACT_VERSION, defaultHome, PROTOCOL, RPC_SERVICE, TOKEN_METADATA }
export type { BridgeInfo, EndpointRecord, LocalEndpoint }

/** One ACP JSON-RPC message as the RPC carries it: a JSON object, never rewritten. */
export type AcpMessage = Record<string, unknown>

/** One ACP connection as the raw duplex call. Read DSH's messages while sending, or DSH stops sending. */
export interface AcpCall extends AsyncIterable<AcpMessage> {
  /** Send one message to DSH; rejects once the connection has ended. */
  send(message: AcpMessage): Promise<void>
  /** Send nothing more; DSH then ends this ACP connection. */
  closeSend(): Promise<void>
  /** End this ACP connection at once. */
  cancel(): Promise<void>
}

/** `no-instance`: no running DSH (matching `instance`) loaded the plugin. `unreachable`: every candidate failed. */
export type DshAcpErrorCode = 'no-instance' | 'unreachable'

/** Why one DSH instance was not used: it could not prove that it wrote its record, or the RPC failed. */
export interface InstanceFailure {
  instanceId: string
  reason: 'unproven' | 'error'
  error?: unknown
}

export class DshAcpError extends Error {
  /** Instances tried, in order, for `unreachable`. */
  readonly failures: readonly InstanceFailure[]

  constructor(readonly code: DshAcpErrorCode, message: string, failures: readonly InstanceFailure[] = [], options?: ErrorOptions) {
    super(message, options)
    this.name = 'DshAcpError'
    this.failures = failures
  }
}

export interface FindOptions {
  /** Where the endpoint records are; `~/.agents-anywhere/dsh-acp` of the operating-system user by default. */
  home?: string
}

/** Endpoint records of running DSH processes that loaded the plugin, newest first. Records of other contract versions are skipped. */
export async function listInstances(options: FindOptions = {}): Promise<EndpointRecord[]> {
  return (await readRecords(options.home ?? defaultHome())).map(stored => stored.record).filter(record => processAlive(record.pid))
}

export interface ConnectOptions extends FindOptions {
  /** An instance ID or a prefix of it. Without it, the newest instance that proves itself is used. */
  instance?: string
  /** Restrict a background launch to the selected Profile directory. */
  application?: import('./applications.js').Application
  strictApplication?: boolean
  profileDirectory?: string
  /** How long `hello` and `info` may take per instance, in milliseconds; 5000 by default. */
  timeoutMs?: number
  /** MeshCall peer ID, for diagnostics. */
  peerId?: string
  /** MeshCall's background diagnostics. */
  logger?: RpcLogger
}

export interface DshConnection {
  /** The endpoint record of the DSH this connection reached. */
  readonly record: EndpointRecord
  /** What the plugin reported when the connection was made. */
  readonly info: BridgeInfo
  /** What the plugin reports now. */
  fetchInfo(): Promise<BridgeInfo>
  /** Open one ACP connection as a stream for the ACP SDK: `client(...).connect(connection.openAcpStream())`. */
  openAcpStream(): Stream
  /** Open one ACP connection as the raw duplex call. */
  openAcpCall(): AcpCall
  /** Close the RPC connection; every ACP connection opened through it ends. */
  close(): Promise<void>
}

const DEFAULT_TIMEOUT_MS = 5_000

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * A raw ACP call as an ACP SDK stream. A send after the connection ended rejects, which ends the
 * SDK connection and fails its pending requests instead of leaving them waiting.
 */
export function acpStream(call: AcpCall): Stream {
  const output = call[Symbol.asyncIterator]()
  return {
    readable: new ReadableStream<AnyMessage>({
      async pull(controller) {
        let next: IteratorResult<AcpMessage>
        try { next = await output.next() } catch (error) { controller.error(error); return }
        if (next.done) controller.close()
        else controller.enqueue(next.value as AnyMessage)
      },
      async cancel() { await call.cancel().catch(() => undefined) },
    }),
    writable: new WritableStream<AnyMessage>({
      async write(message) { await call.send(message as AcpMessage) },
      async close() { await call.closeSend() },
      async abort() { await call.cancel().catch(() => undefined) },
    }),
  }
}

class Connection implements DshConnection {
  constructor(readonly record: EndpointRecord, readonly info: BridgeInfo, private readonly client: MeshCallClient, private readonly timeoutMs: number) {}

  private get metadata() { return { [TOKEN_METADATA]: this.record.token } }

  async fetchInfo(): Promise<BridgeInfo> {
    return requireInfo(this.record, await this.client.unary<object, unknown>(RPC_SERVICE, 'info', {}, { metadata: this.metadata, timeoutMs: this.timeoutMs }))
  }

  openAcpCall(): AcpCall {
    return this.client.duplex<object, AcpMessage, AcpMessage>(RPC_SERVICE, 'connect', {}, { metadata: this.metadata })
  }

  openAcpStream(): Stream {
    return acpStream(this.openAcpCall())
  }

  async close(): Promise<void> {
    await this.client.close()
  }
}

function requireInfo(record: EndpointRecord, value: unknown): BridgeInfo {
  const info = parseInfo(value)
  if (!info) throw new Error(`Instance ${record.instanceId} answered info outside ${PROTOCOL} contract version ${CONTRACT_VERSION}.`)
  return info
}

/**
 * Connect to a running DSH: the newest instance first, then older ones when it does not answer
 * or cannot prove itself. The token is sent only after the proof checks out.
 */
export async function connectDsh(options: ConnectOptions = {}): Promise<DshConnection> {
  const { orderedInstances } = await import('./applications.js')
  const candidates = await listInstances(options)
  const records = (options.application ? orderedInstances(candidates, options.application, options.strictApplication) : candidates)
    .filter(record => options.instance === undefined || record.instanceId.startsWith(options.instance))
    .filter(record => options.profileDirectory === undefined || record.profileDirectory === options.profileDirectory)
  if (!records.length) {
    throw new DshAcpError('no-instance', options.instance === undefined
      ? 'No running DSH has loaded @agents-anywhere/dsh-acp-bridge.'
      : `No running DSH instance matches ${options.instance}.`)
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const failures: InstanceFailure[] = []
  for (const record of records) {
    // An endpoint belongs to one DSH process: once it is gone, connect again rather than wait for it.
    const client = new MeshCallClient(record.endpoint, options.peerId, {
      retry: false, reconnect: { enabled: false }, ...(options.logger ? { logger: options.logger } : {}),
    })
    try {
      const nonce = randomBytes(24).toString('base64url')
      const hello = await client.unary<object, { proof?: unknown }>(RPC_SERVICE, 'hello', { nonce }, { timeoutMs })
      if (!validProof(record.token, nonce, hello.proof)) {
        failures.push({ instanceId: record.instanceId, reason: 'unproven' })
        await client.close().catch(() => undefined)
        continue
      }
      const info = requireInfo(record, await client.unary<object, unknown>(RPC_SERVICE, 'info', {},
        { metadata: { [TOKEN_METADATA]: record.token }, timeoutMs }))
      return new Connection(record, info, client, timeoutMs)
    } catch (error) {
      failures.push({ instanceId: record.instanceId, reason: 'error', error })
      await client.close().catch(() => undefined)
    }
  }
  const summary = failures.map(failure => `${failure.instanceId}: ${failure.reason === 'unproven'
    ? 'could not prove that it wrote its endpoint record' : describe(failure.error)}`).join('; ')
  throw new DshAcpError('unreachable', `No running DSH could be used (${summary}).`, failures, { cause: failures.at(-1)?.error })
}
