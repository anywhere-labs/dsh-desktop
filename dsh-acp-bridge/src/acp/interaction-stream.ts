/**
 * A local consumer of DSH's `$events` Remote stream, the channel the Web and
 * Desktop clients answer approvals and questions on. Adapted from the Agents
 * Anywhere DSH plugin (`anywhere-labs/Agents-Anywhere`,
 * `dsh-bridge-next/src/host/dsh-runtime/interaction-stream.ts`): every owner
 * client receives every waterfall, the first result settles it, and a client
 * that cannot answer replies `next` so the others still can. A delivery that
 * gets no reply at all keeps DSH waiting, so one stream must answer each one.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-gateway'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-user-questions'
import type {} from '@deepseek-ai/dsh-user-approval'
import type { PeerScope } from '@deepseek-ai/dsh-typert-protocol'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { record } from './convert.js'
import type { Log } from './log.js'

export type InteractionOutcome = { kind: 'next' } | { kind: 'result', value: unknown }
  | { kind: 'rejected', error: { name: string, code: string, message: string } }

/** Connection renamed its local owner from operator to browserPeer in 0.2.1. */
export function interactionPeer(connection: { readonly operator?: PeerScope, readonly browserPeer?: PeerScope }): PeerScope {
  const peer = connection.browserPeer ?? connection.operator
  if (!peer) throw new Error('DSH Connection does not provide a local owner Peer.')
  return peer
}

/** Older Gateways omit uplink and peer; current ones require an explicit owner. */
function openInteractionEvents(wireStream: Context['typertGateway']['wireStream'], signal: AbortSignal, peer: PeerScope): Promise<AsyncIterable<unknown>> {
  const open = wireStream.open
  const args: unknown[] = ['$events', { args: {} }]
  if (open.length === 5) args.push((async function* () {})(), peer, signal)
  else if (open.length === 3) args.push(signal)
  else throw new Error('Unsupported DSH interaction stream signature.')
  return Reflect.apply(open, wireStream, args)
}

export class InteractionStream {
  private clientId: string | undefined
  private activeContext: Context | undefined
  private readonly dispose: () => Promise<void>
  get available(): boolean { return this.clientId !== undefined }

  constructor(ctx: Context, receive: (frame: Record<string, unknown>) => Promise<void>, log: Log) {
    const scope = ctx.inject(['typertGateway', 'connection'], ready => {
      const abort = new AbortController()
      const run = async () => {
        let failed = false
        while (!abort.signal.aborted) {
          try {
            const stream = await openInteractionEvents(ready.typertGateway.wireStream, abort.signal, interactionPeer(ready.connection))
            for await (const value of stream) {
              if (abort.signal.aborted) break
              const frame = record(value)
              if (frame.type === 'ready' && typeof frame.clientId === 'string') {
                if (failed) log.info('acp-bridge: interaction stream recovered')
                failed = false
                this.clientId = frame.clientId
                this.activeContext = ready
              } else await receive(frame)
            }
          } catch (error) {
            // Report once per outage so retries neither hide a mismatch nor flood the log.
            if (!abort.signal.aborted && !failed) log.warn('acp-bridge: interaction stream failed', error)
            failed = true
          } finally {
            this.clientId = undefined
            this.activeContext = undefined
          }
          try { await delay(500, undefined, { signal: abort.signal }) } catch { break }
        }
      }
      ready.effect(() => {
        const task = run()
        return async () => { abort.abort(); await task }
      }, 'agents-anywhere-acp-bridge: interaction stream')
    })
    this.dispose = async () => { await scope.dispose() }
  }

  async reply(eventId: string, outcome: InteractionOutcome): Promise<void> {
    const ctx = this.activeContext, clientId = this.clientId
    if (!ctx || !clientId) throw new Error('DSH interaction stream is not connected.')
    const rpcId = randomUUID()
    // Public, already-authenticated in-process carrier: no HTTP request leaves the Host.
    const handler = ctx.connection.createSharedFetchHandler('/api')
    const request = new Request('http://127.0.0.1/api/$events/result', {
      method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ type: 'client-request', rpcId, method: '$events/result', payload: { args: { clientId, eventId, outcome } } }),
    })
    const response = await Reflect.apply(handler.fetch, handler, [request, interactionPeer(ctx.connection)]) as Response
    const envelope = record(await response.json())
    if (!response.ok || envelope.type !== 'server-response' || envelope.rpcId !== rpcId || record(envelope.result).ok !== true) {
      throw new Error('DSH did not accept the interaction result.')
    }
  }

  async close(): Promise<void> { await this.dispose() }
}
