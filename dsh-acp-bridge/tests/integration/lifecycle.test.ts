/**
 * How a prompt ends in every stage it can be in, and what stays behind when a
 * client cancels, closes or disappears halfway. DSH takes a message from the
 * queue before it writes `user/message`, and a session can be closed at any
 * await while DSH creates or opens it.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { methods, type ContentBlock } from '@agentclientprotocol/sdk'
import type { SessionUpdateQueueRequest } from '@deepseek-ai/dsh-api-session-controller'
import { bridgeInfo, Gate, holdController, startHost, type Host } from '../fixtures/host.js'
import { connect, until, type TestClient } from '../fixtures/client.js'

const hello: ContentBlock[] = [{ type: 'text', text: '打个招呼' }]
const hold: ContentBlock[] = [{ type: 'text', text: '请等待' }]

async function started(client: TestClient, host: Host): Promise<string> {
  const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
  assert.equal((await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })).stopReason, 'end_turn')
  return sessionId
}

/** The bridge has dispatched every message this client sent so far. */
async function barrier(client: TestClient): Promise<void> {
  await client.connection.agent.request(methods.agent.session.list, {})
}

async function eventually(check: () => Promise<boolean>, label: string, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await delay(20)
  }
}

/** Sessions the bridge follows settle at `expected` and stay there. */
async function settledFollows(host: Host, expected: number): Promise<void> {
  const followed = async () => (await bridgeInfo(host.acpHome)).followed
  await eventually(async () => await followed() === expected, `${expected} sessions followed`).catch(() => undefined)
  await delay(200)
  assert.equal(await followed(), expected, 'sessions followed by the bridge')
}

test('a turn that fails before writing the message ends the prompt with an error and frees the session', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const sessionId = await started(client, host)
    host.adapter.unavailable = true
    await assert.rejects(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello }),
      /DSH 这一轮执行失败.*模型服务暂时不可用/u)
    host.adapter.unavailable = false
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn', 'the failed prompt does not keep the session busy')
  } finally {
    await client.close()
    await host.close()
  }
})

test('session/cancel right after sending ends the prompt at whatever stage it reached', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const sessionId = await started(client, host)
    for (const wait of [0, 1, 5, 20, 60, 150]) {
      const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hold })
      if (wait) await delay(wait)
      await client.connection.agent.notify(methods.agent.session.cancel, { sessionId })
      assert.equal((await running).stopReason, 'cancelled', `cancelled ${wait} ms after sending`)
    }
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
    assert.equal(client.text('agent_message_chunk', sessionId).endsWith('你好'), true)
  } finally {
    await client.close()
    await host.close()
  }
})

test('a queued message removed in DSH ends its prompt as cancelled', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const busy = await connect(host.acpHome)
  const queued = await connect(host.acpHome)
  try {
    const sessionId = await started(busy, host)
    const running = busy.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hold })
    await until(() => busy.text('agent_message_chunk', sessionId).endsWith('开始'), 'the session is busy')
    await queued.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    const waiting = queued.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    const controller = host.ctx.sessionController
    let item: { id: string } | undefined
    await eventually(async () => {
      item = (await controller.state({ sessionId: sessionId as never }, new AbortController().signal)).queue?.[0]
      return item !== undefined
    }, 'the message waits in the queue')
    assert.ok(item)
    // DSH Desktop removes it from the queue.
    await controller.updateQueue({ sessionId: sessionId as never, itemId: item.id as SessionUpdateQueueRequest['itemId'], action: { kind: 'remove' } })
    assert.equal((await waiting).stopReason, 'cancelled')

    await busy.connection.agent.notify(methods.agent.session.cancel, { sessionId })
    assert.equal((await running).stopReason, 'cancelled')
    const again = await queued.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn', 'the removed prompt does not keep the session busy')
  } finally {
    await Promise.all([busy.close(), queued.close()])
    await host.close()
  }
})

/** Messages waiting in the DSH queue for a turn of their own. */
function inbox(host: Host, sessionId: string): number {
  return host.ctx.agents.get(sessionId as never)?.inbox.nextTurn.length ?? 0
}

/** The latest user text of each model request, in order. */
function asked(host: Host): string[] {
  return host.adapter.requests.map(request => {
    const messages = request.messages as readonly { role?: string, source?: { kind?: string }, content?: readonly { text?: string }[] }[]
    const user = messages.findLast(message => message.role === 'user' && message.source?.kind === 'user')
    return (user?.content ?? []).map(block => block.text ?? '').join('')
  })
}

test('cancelling one queued prompt withdraws only its message', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const first = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '分段' }] })
    await until(() => client.text('agent_message_chunk', sessionId) === '你好前半', 'the first reply is halfway')
    const withdraw = new AbortController()
    const second = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello }, { cancellationSignal: withdraw.signal })
    const third = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '再打个招呼' }] })
    await until(() => inbox(host, sessionId) === 2, 'both wait in the DSH queue')
    withdraw.abort()
    assert.equal((await second).stopReason, 'cancelled')
    assert.equal(inbox(host, sessionId), 1, 'only the cancelled message left the queue')
    host.adapter.midway.open()
    assert.equal((await first).stopReason, 'end_turn')
    assert.equal((await third).stopReason, 'end_turn')
    assert.deepEqual(asked(host), ['分段', '再打个招呼'])
  } finally {
    await client.close()
    await host.close()
  }
})

test('cancelling the running prompt also withdraws the prompts queued behind it, which DSH would not resume', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const stop = new AbortController()
    const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hold }, { cancellationSignal: stop.signal })
    await until(() => client.text('agent_message_chunk', sessionId).endsWith('开始'), 'the session is busy')
    const queued = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    await until(() => inbox(host, sessionId) === 1, 'the second message waits in the DSH queue')
    stop.abort()
    assert.equal((await running).stopReason, 'cancelled')
    assert.equal((await queued).stopReason, 'cancelled')
    assert.equal(inbox(host, sessionId), 0)
    assert.deepEqual(asked(host), ['请等待'])
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
    assert.deepEqual(asked(host), ['请等待', '打个招呼'], 'the withdrawn message never runs later')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a failed turn ends the prompts queued behind it with an error instead of leaving them waiting', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const sessionId = await started(client, host)
    let approve!: () => void
    const approved = new Promise<void>(resolve => { approve = resolve })
    client.answerPermission = async () => { await approved; return { outcome: { outcome: 'selected', optionId: 'allow-once' } } }
    const failing = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请调用工具' }] })
    await until(() => client.permissions.length === 1, 'the turn waits for an approval')
    const queued = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    await until(() => inbox(host, sessionId) === 1, 'the second message waits in the DSH queue')
    // The step after the tool fails, so the turn ends with an error and DSH stops taking queued messages.
    host.adapter.unavailable = true
    approve()
    await assert.rejects(failing, /DSH 这一轮执行失败.*模型服务暂时不可用/u)
    await assert.rejects(queued, /这条消息没有发送/u)
    assert.equal(inbox(host, sessionId), 0)
    host.adapter.unavailable = false
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn', 'nothing withdrawn runs ahead of the next message')
    assert.equal(client.text('agent_message_chunk', sessionId).endsWith('你好'), true)
  } finally {
    await client.close()
    await host.close()
  }
})

test('a prompt queued behind another client\'s turn ends as cancelled when that client stops its turn', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const busy = await connect(host.acpHome)
  const queued = await connect(host.acpHome)
  try {
    const sessionId = await started(busy, host)
    const running = busy.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hold })
    await until(() => busy.text('agent_message_chunk', sessionId).endsWith('开始'), 'the session is busy')
    await queued.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    const waiting = queued.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    await until(() => inbox(host, sessionId) === 1, 'the message waits in the DSH queue')
    // DSH Desktop's Stop keeps its queue but takes no further message until new input arrives.
    host.ctx.sessionController.cancel({ sessionId: sessionId as never })
    assert.equal((await running).stopReason, 'cancelled')
    assert.equal((await waiting).stopReason, 'cancelled')
    assert.equal(inbox(host, sessionId), 0)
    const again = await queued.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
  } finally {
    await Promise.all([busy.close(), queued.close()])
    await host.close()
  }
})

test('session/cancel while DSH creates the session sends nothing, and the session stays usable', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const gate = new Gate()
  const restore = holdController(host.ctx, 'create', gate)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    await until(() => gate.reached === 1, 'DSH is creating the session')
    await client.connection.agent.notify(methods.agent.session.cancel, { sessionId })
    await barrier(client)
    gate.open()
    assert.equal((await running).stopReason, 'cancelled')
    assert.equal(host.adapter.requests.length, 0, 'the cancelled message never reached the model')
    assert.equal(client.text('agent_message_chunk', sessionId), '')

    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
    assert.equal(host.adapter.requests.length, 1)
  } finally {
    restore()
    await client.close()
    await host.close()
  }
})

test('session/cancel stops a slash command that is still running', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const sessionId = await started(client, host)
    await until(() => client.updates.some(item => item.update.sessionUpdate === 'available_commands_update'
      && (item.update as { availableCommands: { name: string }[] }).availableCommands.some(command => command.name === 'wait')), 'the command is offered')
    const before = client.text('agent_message_chunk', sessionId)
    const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '/wait' }] })
    await until(() => host.waits.started === 1, 'the command is running')
    await client.connection.agent.notify(methods.agent.session.cancel, { sessionId })
    assert.equal((await running).stopReason, 'cancelled')
    assert.equal(host.waits.stopped, 1, 'DSH stopped the command')
    assert.equal(client.text('agent_message_chunk', sessionId), before, 'a cancelled command reports nothing')
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
  } finally {
    await client.close()
    await host.close()
  }
})

test('session/close while DSH creates the session sends nothing and leaves nothing followed', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const gate = new Gate()
  const restore = holdController(host.ctx, 'create', gate)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    await until(() => gate.reached === 1, 'DSH is creating the session')
    await client.connection.agent.request(methods.agent.session.close, { sessionId })
    gate.open()
    assert.equal((await running).stopReason, 'cancelled')
    await delay(300)
    assert.equal(host.adapter.requests.length, 0, 'the message of a closed session never reached the model')
    await settledFollows(host, 0)
    await assert.rejects(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello }), /未知的会话/u)
  } finally {
    restore()
    await client.close()
    await host.close()
  }
})

test('a client that disappears while DSH creates or opens its session leaves nothing followed', { timeout: 60_000 }, async () => {
  const host = await startHost()
  try {
    // Gone while DSH creates the session for its first message.
    const creating = await connect(host.acpHome)
    const created = new Gate()
    const restoreCreate = holdController(host.ctx, 'create', created)
    try {
      const { sessionId } = await creating.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
      void creating.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello }).catch(() => undefined)
      await until(() => created.reached === 1, 'DSH is creating the session')
      creating.kill()
      await eventually(async () => (await bridgeInfo(host.acpHome)).connections === 0, 'the connection closed')
    } finally {
      created.open()
      restoreCreate()
      await creating.close()
    }
    await delay(300)
    assert.equal(host.adapter.requests.length, 0, 'the message of a client that left never reached the model')
    await settledFollows(host, 0)

    // Gone while DSH opens an existing session for session/load.
    const owner = await connect(host.acpHome)
    const sessionId = await started(owner, host)
    await owner.close()
    await settledFollows(host, 0)
    const loading = await connect(host.acpHome)
    const opened = new Gate()
    const restoreFollow = holdController(host.ctx, 'follow', opened)
    try {
      void loading.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [] }).catch(() => undefined)
      await until(() => opened.reached === 1, 'DSH is opening the session')
      loading.kill()
      await eventually(async () => (await bridgeInfo(host.acpHome)).connections === 0, 'the connection closed')
    } finally {
      opened.open()
      restoreFollow()
      await loading.close()
    }
    await settledFollows(host, 0)
  } finally {
    await host.close()
  }
})

test('loading a session again replaces the earlier view, even one still opening', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const sessionId = await started(client, host)
    await settledFollows(host, 1)
    const loads = await Promise.allSettled([1, 2, 3].map(() =>
      client.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [] })))
    assert.ok(loads.some(result => result.status === 'fulfilled'), 'the last load succeeds')
    await settledFollows(host, 1)
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
  } finally {
    await client.close()
    await host.close()
  }
})
