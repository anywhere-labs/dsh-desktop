/** An ACP client that starts the real stdio launcher, as an editor would. */

import {
  client as acpClient, methods, ndJsonStream, type ClientCapabilities, type ClientConnection, type CreateElicitationRequest,
  type CreateElicitationResponse, type InitializeResponse, type RequestPermissionRequest, type RequestPermissionResponse, type SessionNotification,
} from '@agentclientprotocol/sdk'
import { spawn } from 'node:child_process'
import { Readable, Transform, Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

export const stdioScript = fileURLToPath(new URL('../../lib/stdio.js', import.meta.url))

export interface TestClient {
  connection: ClientConnection
  initialized: InitializeResponse
  updates: SessionNotification[]
  permissions: RequestPermissionRequest[]
  forms: CreateElicitationRequest[]
  /** What arrived from the agent, in wire order: `response`, a request's method, or a session update's kind. */
  wire: string[]
  answerPermission: (request: RequestPermissionRequest, signal: AbortSignal) => RequestPermissionResponse | Promise<RequestPermissionResponse>
  answerForm: (request: CreateElicitationRequest, signal: AbortSignal) => CreateElicitationResponse | Promise<CreateElicitationResponse>
  stderr(): string
  /** End the client process abruptly, as a crashing editor would. */
  kill(): void
  /** Text of every chunk of one kind, in order. */
  text(kind: 'agent_message_chunk' | 'agent_thought_chunk' | 'user_message_chunk', sessionId?: string): string
  close(): Promise<void>
}

export async function until(check: () => boolean, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (check()) return
    await delay(10)
  }
  if (!check()) throw new Error(`Timed out: ${label}`)
}

export async function connect(acpHome: string, capabilities: ClientCapabilities = {}): Promise<TestClient> {
  const child = spawn(process.execPath, [stdioScript, '--home', acpHome], { stdio: ['pipe', 'pipe', 'pipe'] })
  let stderr = ''
  child.stderr.setEncoding('utf8').on('data', (chunk: string) => { stderr += chunk })
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
  // The SDK hands over a whole chunk before promise callbacks run; only the raw lines show the order on the wire.
  const wire: string[] = []
  let partial = ''
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const lines = (partial + chunk.toString('utf8')).split('\n')
      partial = lines.pop() ?? ''
      for (const line of lines.filter(item => item.trim())) {
        const message = JSON.parse(line) as { method?: string, params?: { update?: { sessionUpdate?: string } } }
        wire.push(message.method === 'session/update' ? message.params?.update?.sessionUpdate ?? 'update' : message.method ?? 'response')
      }
      callback(null, chunk)
    },
  })
  child.stdout.pipe(tap)
  const stream = ndJsonStream(Writable.toWeb(child.stdin) as WritableStream<Uint8Array>, Readable.toWeb(tap) as ReadableStream<Uint8Array>)
  const client: Omit<TestClient, 'connection' | 'initialized'> & { connection?: ClientConnection, initialized?: InitializeResponse } = {
    updates: [], permissions: [], forms: [], wire,
    answerPermission: () => ({ outcome: { outcome: 'cancelled' } }),
    answerForm: () => ({ action: 'decline' }),
    stderr: () => stderr,
    kill: () => { child.kill('SIGKILL') },
    text(kind, sessionId) {
      return this.updates.filter(item => item.update.sessionUpdate === kind && (sessionId === undefined || item.sessionId === sessionId))
        .map(item => { const content = (item.update as { content?: { type: string, text?: string } }).content; return content?.type === 'text' ? content.text ?? '' : '' })
        .join('')
    },
    async close() {
      child.stdin.end()
      await Promise.race([exited, delay(5_000)])
      child.kill()
    },
  }
  const app = acpClient({ name: 'test-client' })
    .onNotification(methods.client.session.update, ({ params }) => { client.updates.push(params) })
    .onRequest(methods.client.session.requestPermission, async ({ params, signal }) => { client.permissions.push(params); return client.answerPermission(params, signal) })
    .onRequest(methods.client.elicitation.create, async ({ params, signal }) => { client.forms.push(params); return client.answerForm(params, signal) })
  client.connection = app.connect(stream)
  client.initialized = await client.connection.agent.request(methods.agent.initialize, {
    protocolVersion: 1, clientCapabilities: capabilities, clientInfo: { name: 'test-client', version: '1.0.0' },
  })
  return client as TestClient
}
