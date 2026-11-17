/**
 * The MeshCall service the plugin serves: one duplex call carries one ACP
 * connection's JSON-RPC messages, unchanged, in both directions.
 */

import type { AnyMessage, Stream } from '@agentclientprotocol/sdk'
import { method, PermissionDeniedError, query, service, z, type DuplexChannel, type RpcContext } from 'meshcall'
import { createHash, timingSafeEqual } from 'node:crypto'
import { endpointProof } from './endpoint.js'
import { RPC_SERVICE, TOKEN_METADATA } from './paths.js'

type Message = Record<string, unknown>

/** What the RPC layer needs from the plugin. */
export interface AcpServer {
  info(): Message
  serve(stream: Stream, signal: AbortSignal): Promise<void>
}

const payload = z.looseObject({})
const helloRequest = z.object({ nonce: z.string().min(16).max(256) })
const helloResponse = z.object({ proof: z.string() })

function sameToken(given: string | undefined, expected: string): boolean {
  if (!given) return false
  const digest = (value: string) => createHash('sha256').update(value).digest()
  return timingSafeEqual(digest(given), digest(expected))
}

/** The duplex channel as an ACP SDK stream: input items are read, output items are sent. */
export function channelStream(channel: DuplexChannel<Message, Message>): Stream {
  const input = channel[Symbol.asyncIterator]()
  const readable = new ReadableStream<AnyMessage>({
    async pull(controller) {
      try {
        const next = await input.next()
        if (next.done) controller.close()
        else controller.enqueue(next.value as AnyMessage)
      } catch (error) {
        controller.error(error)
      }
    },
    async cancel() { await input.return?.() },
  })
  // Once the call has ended the client is gone: late messages are dropped
  // rather than rejected, because DSH treats an unhandled rejection as fatal.
  const writable = new WritableStream<AnyMessage>({
    async write(message) { await channel.send(message as Message).catch(() => undefined) },
    async close() { await channel.closeSend().catch(() => undefined) },
  })
  return { readable, writable }
}

@service(RPC_SERVICE, { description: 'Agent Client Protocol connections to the DeepSeek Harness this plugin runs in.' })
export class AcpRpcService {
  constructor(private readonly server: AcpServer, private readonly token: string) {}

  private authorize(context: RpcContext): void {
    if (!sameToken(context.metadata[TOKEN_METADATA], this.token)) {
      throw new PermissionDeniedError('A valid endpoint token is required; read it from the endpoint record.')
    }
  }

  /** Needs no token: a client checks this answer before it sends the token anywhere. */
  @query({ description: 'Prove this endpoint holds the token of its endpoint record, for a client-chosen nonce.', request: helloRequest, response: helloResponse })
  async hello(request: z.output<typeof helloRequest>): Promise<z.input<typeof helloResponse>> {
    return { proof: endpointProof(this.token, request.nonce) }
  }

  @query({ description: 'Identify the bridge, the DSH it runs in and the ACP version it speaks.', request: payload, response: payload })
  async info(_request: Message, context: RpcContext): Promise<Message> {
    this.authorize(context)
    return this.server.info()
  }

  @method.duplex({
    description: 'One ACP connection: JSON-RPC messages in both directions until either side ends.',
    reason: 'ACP is bidirectional JSON-RPC: the agent sends permission and form requests while client requests are still running.',
    request: payload, inputItem: payload, outputItem: payload,
  })
  async connect(_request: Message, channel: DuplexChannel<Message, Message>, context: RpcContext): Promise<void> {
    this.authorize(context)
    await this.server.serve(channelStream(channel), context.signal)
  }
}
