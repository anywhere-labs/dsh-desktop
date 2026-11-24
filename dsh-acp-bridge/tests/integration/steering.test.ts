/**
 * Steering a running turn (`_session/steering`) and the turn boundaries every attached client receives,
 * including for turns no prompt of its own started.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { methods, type SessionNotification } from '@agentclientprotocol/sdk'
import { startHost, type Host } from '../fixtures/host.js'
import { connect, until, type TestClient } from '../fixtures/client.js'

interface TurnEvent { sessionId: string, phase: 'started' | 'ended', turn: number, seq: number, stopReason?: string, reason?: { kind: string, message?: string } }

function turnEvents(client: TestClient, sessionId: string): TurnEvent[] {
  return client.updates.filter(item => item.sessionId === sessionId && item.update.sessionUpdate === 'session_info_update')
    .map(item => (item.update as SessionNotification['update'] & { _meta?: { dsh?: { turnEvent?: TurnEvent } } })._meta?.dsh?.turnEvent)
    .filter((event): event is TurnEvent => event !== undefined)
}

function steer(client: TestClient, sessionId: string, text: string): Promise<{ outcome: string }> {
  return client.connection.agent.request<{ outcome: string }>('_session/steering',
    { sessionId, prompt: [{ type: 'text', text }], _meta: { steering: { idleBehavior: 'promptRequired' } } })
}

/** The text of every message a person wrote that the model was sent in its latest request. */
function lastRequestUserText(host: Host): string {
  const messages = (host.adapter.requests.at(-1)?.messages ?? []) as readonly { role?: string, source?: { kind?: string }, content?: readonly { text?: string }[] }[]
  return messages.filter(message => message.role === 'user' && message.source?.kind === 'user')
    .map(message => (message.content ?? []).map(block => block.text ?? '').join('')).join('|')
}

test('steering joins the running turn, is not echoed to its sender, and asks for a prompt when nothing runs', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const other = await connect(host.acpHome)
  try {
    assert.deepEqual(client.initialized._meta?.steering, { supported: true }, 'clients find the extension in initialize')
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    assert.deepEqual(await steer(client, sessionId, '补充'), { outcome: 'promptRequired' }, 'DSH has not created the session yet')

    const prompt = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '分段' }] })
    await until(() => host.adapter.midway.reached === 1 && client.text('agent_message_chunk', sessionId) === '你好前半', 'half of the step is streamed')
    await other.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [] })
    assert.deepEqual(await steer(client, sessionId, '补充说明'), { outcome: 'injected' })
    host.adapter.midway.open()
    assert.equal((await prompt).stopReason, 'end_turn')
    // DSH runs another step for the steering before it closes the turn.
    assert.equal(lastRequestUserText(host), '分段|补充说明')
    assert.equal(client.text('agent_message_chunk', sessionId), '你好前半后半你好')
    assert.equal(client.text('user_message_chunk', sessionId), '', 'the client that steered shows its own input already')
    await until(() => other.text('user_message_chunk', sessionId).includes('补充说明'), 'another client sees the steering')
    assert.equal(other.text('user_message_chunk', sessionId), '分段补充说明', 'its load replayed the first message')

    assert.deepEqual(await steer(client, sessionId, '再补充'), { outcome: 'promptRequired' }, 'nothing runs: the client sends a prompt instead')
    await assert.rejects(client.connection.agent.request('_session/steering', { sessionId, prompt: [{ type: 'text', text: '  ' }] }), /不能为空/u)
    await assert.rejects(client.connection.agent.request('_session/steering', { sessionId: 'nope', prompt: [{ type: 'text', text: '补充' }] }), /未知的会话/u)
    await assert.rejects(client.connection.agent.request('_session/steering', { sessionId }), /sessionId 和 prompt/u)
  } finally {
    await client.close()
    await other.close()
    await host.close()
  }
})

test('a queued prompt\'s turn opens only after the prompt before it is answered', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const prompt = (text: string) => client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] })
    // DSH opens the next turn before it takes the queued message from the queue.
    const results = await Promise.all([prompt('打个招呼'), prompt('再打个招呼')])
    assert.deepEqual(results.map(result => result.stopReason), ['end_turn', 'end_turn'])
    const wire = client.wire.filter(entry => entry === 'response' || entry.startsWith('turn:')).slice(-6)
    assert.deepEqual(wire, ['turn:started', 'turn:ended', 'response', 'turn:started', 'turn:ended', 'response'])
  } finally {
    await client.close()
    await host.close()
  }
})

test('every attached client gets the boundaries of each turn, in order, whoever started it', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const watcher = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const first = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    assert.equal(first.stopReason, 'end_turn')
    const wire = [...client.wire]
    const started = wire.indexOf('turn:started')
    assert.ok(started >= 0 && started < wire.indexOf('agent_thought_chunk'), 'a turn opens before its first update')
    assert.ok(wire.indexOf('turn:ended') > wire.lastIndexOf('agent_message_chunk') && wire.indexOf('turn:ended') < wire.lastIndexOf('response'),
      'and closes after its last update, before the prompt that started it is answered')
    const [opened, closed] = turnEvents(client, sessionId)
    assert.deepEqual(opened && { phase: opened.phase, sessionId: opened.sessionId }, { phase: 'started', sessionId })
    assert.deepEqual(closed && { phase: closed.phase, turn: closed.turn, stopReason: closed.stopReason, reason: closed.reason },
      { phase: 'ended', turn: opened?.turn, stopReason: 'end_turn', reason: { kind: 'completed' } })
    assert.ok(closed && opened && closed.seq > opened.seq, 'each boundary names the DSH event it comes from')

    // A turn DSH Desktop starts: no ACP prompt answers for it, the boundaries say when it ends.
    await watcher.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [] })
    const mark = watcher.wire.length
    await host.ctx.sessionController.prompt({ requestId: 'desktop-turn' as never, sessionId: sessionId as never, mode: 'queue',
      content: [{ type: 'text', text: '桌面端的消息' }] }, new AbortController().signal)
    await until(() => watcher.wire.slice(mark).includes('turn:ended'), 'the watcher sees the turn end')
    const seen = watcher.wire.slice(mark)
    assert.ok(seen.indexOf('turn:started') < seen.indexOf('user_message_chunk'), 'the turn opens before the message DSH Desktop sent')
    assert.ok(seen.indexOf('agent_message_chunk') < seen.indexOf('turn:ended'))
    const watched = turnEvents(watcher, sessionId)
    assert.deepEqual(watched.map(event => event.phase), ['started', 'ended'])
    assert.ok(watched[0]!.turn === watched[1]!.turn && watched[0]!.turn > opened!.turn, 'the next turn of the session')
  } finally {
    await client.close()
    await watcher.close()
    await host.close()
  }
})
