/**
 * Prompts in sessions whose Agent delegates to subagents. A subagent works in
 * the background after the turn that started it ends; its result reaches the
 * Agent as a notice that starts another turn. A prompt therefore returns only
 * when the Agent and its whole subagent tree have gone quiet, as the official
 * dsh-acp does, so the client sees that work as part of the prompt.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { methods, type ContentBlock, type PromptResponse, type SessionConfigOption } from '@agentclientprotocol/sdk'
import { bridgeInfo, startHost, type Host } from '../fixtures/host.js'
import { connect, until, type TestClient } from '../fixtures/client.js'

const delegate: ContentBlock[] = [{ type: 'text', text: '请派助手' }]
const hello: ContentBlock[] = [{ type: 'text', text: '打个招呼' }]

function option(options: readonly SessionConfigOption[] | null | undefined, id: string) {
  return options?.find(item => item.id === id)
}

/** DSH's Team mode service, which the 「启用智能体团队协作」 switch drives. */
function teams(host: Host): { isEnabled(agent: unknown): boolean, setEnabled(agent: unknown, enabled: boolean): Promise<void> } {
  return (host.ctx as unknown as { agentTeams: ReturnType<typeof teams> }).agentTeams
}

function turnEnds(host: Host, sessionId: string): number {
  return host.ctx.agents.get(sessionId as never)?.session.snapshotEvents().filter(event => event.type === 'turn/end').length ?? 0
}

interface Pending { response: Promise<PromptResponse>, done(): boolean }

function send(client: TestClient, sessionId: string, prompt: ContentBlock[]): Pending {
  let done = false
  const response = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt })
  void response.then(() => { done = true }, () => { done = true })
  return { response, done: () => done }
}

/** A prompt whose turn started a subagent; returns once that turn has ended and the subagent is still working. */
async function delegating(client: TestClient, host: Host): Promise<{ sessionId: string, prompt: Pending }> {
  const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
  const prompt = send(client, sessionId, delegate)
  await until(() => host.adapter.child.reached === 1, 'the subagent is working')
  await until(() => turnEnds(host, sessionId) === 1, 'the turn that started it ended')
  return { sessionId, prompt }
}

test('a prompt returns only after its subagents and the turns their results start have finished', { timeout: 60_000 }, async () => {
  const host = await startHost({ subagents: true })
  const client = await connect(host.acpHome)
  try {
    const { sessionId, prompt } = await delegating(client, host)
    await delay(300)
    assert.equal(prompt.done(), false, 'the prompt waits while the subagent works')

    host.adapter.child.open()
    const response = await prompt.response
    assert.equal(response.stopReason, 'end_turn')
    assert.equal(turnEnds(host, sessionId), 2, 'the subagent\'s result started a turn of its own')
    assert.equal(client.text('agent_message_chunk', sessionId), '工具完成收到结果')
    assert.ok(client.wire.lastIndexOf('agent_message_chunk') < client.wire.lastIndexOf('response'),
      'the reply to the subagent\'s result comes before the response')
    assert.deepEqual(response.usage && { input: response.usage.inputTokens, output: response.usage.outputTokens }, { input: 24, output: 6 },
      'usage covers both turns')
  } finally {
    await client.close()
    await host.close()
  }
})

test('session/cancel while the prompt waits for subagents returns at once and leaves them running', { timeout: 60_000 }, async () => {
  const host = await startHost({ subagents: true })
  const client = await connect(host.acpHome)
  try {
    const { sessionId, prompt } = await delegating(client, host)
    await client.connection.agent.notify(methods.agent.session.cancel, { sessionId })
    assert.equal((await prompt.response).stopReason, 'cancelled')

    // As in DSH Desktop, stopping the conversation does not stop its subagents.
    host.adapter.child.open()
    await until(() => turnEnds(host, sessionId) === 2, 'the subagent finished, and its result still started a turn')
    await until(() => client.text('agent_message_chunk', sessionId).endsWith('收到结果'), 'the client still sees that turn')
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.equal(again.stopReason, 'end_turn')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a prompt sent while the previous one waits for subagents ends the previous one first, then waits itself', { timeout: 60_000 }, async () => {
  const host = await startHost({ subagents: true })
  const client = await connect(host.acpHome)
  try {
    const { sessionId, prompt: first } = await delegating(client, host)
    const mark = client.wire.length
    const second = send(client, sessionId, hello)
    assert.equal((await first.response).stopReason, 'end_turn')
    await until(() => turnEnds(host, sessionId) === 2, 'the second prompt ran its turn')
    const after = client.wire.slice(mark)
    assert.ok(after.indexOf('response') >= 0 && after.indexOf('response') < after.indexOf('agent_thought_chunk'),
      'the first prompt is answered before the second turn sends anything')

    await delay(300)
    assert.equal(second.done(), false, 'the subagent still works, so the second prompt waits for it')
    host.adapter.child.open()
    assert.equal((await second.response).stopReason, 'end_turn')
    assert.equal(turnEnds(host, sessionId), 3)
    assert.equal(client.text('agent_message_chunk', sessionId), '工具完成你好收到结果')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a message DSH Desktop sends while the prompt waits for subagents is part of that prompt', { timeout: 60_000 }, async () => {
  const host = await startHost({ subagents: true })
  const client = await connect(host.acpHome)
  try {
    const { sessionId, prompt } = await delegating(client, host)
    await host.ctx.sessionController.prompt({ requestId: 'desktop-message' as never, sessionId: sessionId as never, mode: 'queue',
      content: [{ type: 'text', text: '桌面上的消息' }] }, new AbortController().signal)
    await until(() => turnEnds(host, sessionId) === 2, 'the Desktop message ran its turn')
    await until(() => client.text('user_message_chunk', sessionId).endsWith('桌面上的消息'), 'the client sees the Desktop message')
    await delay(300)
    assert.equal(prompt.done(), false, 'the prompt still waits for the subagent')

    host.adapter.child.open()
    assert.equal((await prompt.response).stopReason, 'end_turn')
    assert.equal(client.text('agent_message_chunk', sessionId), '工具完成你好收到结果')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a client that disappears while its prompt waits for subagents leaves them running and nothing followed', { timeout: 60_000 }, async () => {
  const host = await startHost({ subagents: true })
  const client = await connect(host.acpHome)
  try {
    const { sessionId, prompt } = await delegating(client, host)
    void prompt.response.catch(() => undefined)
    client.kill()
    const deadline = Date.now() + 10_000
    while ((await bridgeInfo(host.acpHome)).followed !== 0) {
      if (Date.now() > deadline) throw new Error('Timed out: the bridge still follows the session')
      await delay(20)
    }
    // The bridge does not tear the subagent tree down: the session is DSH Desktop's too.
    host.adapter.child.open()
    await until(() => turnEnds(host, sessionId) === 2, 'the subagent finished, and its result started a turn')
  } finally {
    await client.close()
    await host.close()
  }
})

test('the agent team switch is a session option that DSH and the client share', { timeout: 60_000 }, async () => {
  const host = await startHost({ agentTeams: true })
  const client = await connect(host.acpHome)
  const switches = await connect(host.acpHome, { session: { configOptions: { boolean: {} } } } as never)
  try {
    const created = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const sessionId = created.sessionId
    assert.equal(option(created.configOptions, 'agent_team')?.currentValue, 'off', 'a new session starts without Team mode, as in DSH')

    // Chosen before the first message: DSH applies it as soon as the message creates the session.
    const chosen = await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'agent_team', value: 'on' })
    assert.equal(option(chosen.configOptions, 'agent_team')?.currentValue, 'on')
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    const agent = host.ctx.agents.get(sessionId as never)
    assert.equal(teams(host).isEnabled(agent), true)

    const off = await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'agent_team', value: 'off' })
    assert.equal(option(off.configOptions, 'agent_team')?.currentValue, 'off')
    assert.equal(teams(host).isEnabled(agent), false, 'switched off in DSH')

    // A client that renders switches gets a boolean option, and sees a change made in DSH Desktop.
    await switches.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    await teams(host).setEnabled(agent, true)
    for (const [viewer, value] of [[client, 'on'], [switches, true]] as const) {
      await until(() => viewer.updates.some(item => item.update.sessionUpdate === 'config_option_update'
        && option(item.update.configOptions, 'agent_team')?.currentValue === value), 'the switch made in DSH reaches the client')
    }
    const flag = switches.updates.findLast(item => item.update.sessionUpdate === 'config_option_update')
    assert.equal(flag?.update.sessionUpdate === 'config_option_update' && option(flag.update.configOptions, 'agent_team')?.type, 'boolean')
  } finally {
    await Promise.all([client.close(), switches.close()])
    await host.close()
  }
})
