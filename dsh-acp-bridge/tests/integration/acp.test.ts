import assert from 'node:assert/strict'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { methods, type SessionConfigOption } from '@agentclientprotocol/sdk'
import { startHost } from '../fixtures/host.js'
import { connect, until } from '../fixtures/client.js'

function option(options: readonly SessionConfigOption[], id: string) {
  return options.find(item => item.id === id)
}

test('a new ACP session streams a DSH reply and creates a normal DSH session', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const capabilities = client.initialized.agentCapabilities
    assert.equal(client.initialized.protocolVersion, 1)
    assert.equal(capabilities?.loadSession, true)
    assert.deepEqual(capabilities?.sessionCapabilities, { list: {}, resume: {}, close: {}, delete: {}, fork: {} })
    assert.equal(capabilities?.promptCapabilities?.image, true)

    const created = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const options = created.configOptions ?? []
    assert.equal(option(options, 'model')?.currentValue, 'test/text')
    assert.equal(option(options, 'permission')?.currentValue, 'workspace-write')
    assert.equal(option(options, 'agent_preset')?.currentValue, 'standard')
    // Nothing exists in DSH until the first prompt.
    assert.equal(host.ctx.agents.get(created.sessionId as never), undefined)

    const switched = await client.connection.agent.request(methods.agent.session.setConfigOption, {
      sessionId: created.sessionId, configId: 'model', value: 'test/thinking' })
    assert.equal(option(switched.configOptions, 'model')?.currentValue, 'test/thinking')
    assert.equal(option(switched.configOptions, 'reasoning_effort')?.currentValue, 'low')

    const response = await client.connection.agent.request(methods.agent.session.prompt, {
      sessionId: created.sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    assert.equal(response.stopReason, 'end_turn')
    assert.deepEqual(response.usage && { input: response.usage.inputTokens, output: response.usage.outputTokens }, { input: 12, output: 3 })
    assert.equal(client.text('agent_thought_chunk', created.sessionId), '想一想')
    assert.equal(client.text('agent_message_chunk', created.sessionId), '你好')
    assert.equal(client.text('user_message_chunk', created.sessionId), '', 'the client is not sent its own prompt back')

    const agent = host.ctx.agents.get(created.sessionId as never)
    assert.ok(agent, 'the ACP session is a DSH session')
    assert.equal(agent.session.header.cwd, host.workspace)
    const workspace = host.ctx.workspaceRegistry.list().find(item => item.path === host.workspace)
    assert.ok(workspace?.sessionIds.includes(created.sessionId as never), 'the session appears under its workspace')
    assert.equal(host.adapter.requests.at(-1)?.model, 'thinking', 'the model chosen before the first prompt is applied')
    await until(() => client.updates.some(item => item.update.sessionUpdate === 'available_commands_update'), 'slash menu published')
  } finally {
    await client.close()
    await host.close()
  }
})

test('another client lists and loads the session, then sees messages sent from DSH live', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const first = await connect(host.acpHome)
  const second = await connect(host.acpHome)
  try {
    const { sessionId } = await first.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await first.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })

    const listed = await second.connection.agent.request(methods.agent.session.list, { cwd: host.workspace })
    assert.deepEqual(listed.sessions.map(item => item.sessionId), [sessionId])
    assert.equal(listed.sessions[0]?.cwd, host.workspace)
    const elsewhere = await second.connection.agent.request(methods.agent.session.list, { cwd: host.root })
    assert.deepEqual(elsewhere.sessions, [], 'the cwd filter applies')

    await assert.rejects(second.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.root, mcpServers: [] }),
      /工作目录/u, 'a session opens only in its own workspace')
    const loaded = await second.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [] })
    assert.equal(option(loaded.configOptions ?? [], 'model')?.currentValue, 'test/text')
    assert.equal(option(loaded.configOptions ?? [], 'agent_preset'), undefined, 'the preset is fixed once the session exists')
    assert.equal(second.text('user_message_chunk', sessionId), '打个招呼', 'history is replayed before the response')
    assert.equal(second.text('agent_thought_chunk', sessionId), '想一想')
    assert.equal(second.text('agent_message_chunk', sessionId), '你好')

    // DSH Desktop (or AA) sends a message through the same Session Controller.
    await host.ctx.sessionController.prompt({ requestId: 'desktop-message' as never, sessionId: sessionId as never, mode: 'queue',
      content: [{ type: 'text', text: '桌面上的消息' }] }, new AbortController().signal)
    for (const client of [first, second]) {
      await until(() => client.text('user_message_chunk', sessionId).endsWith('桌面上的消息'), 'the desktop message reaches every client')
      await until(() => client.text('agent_message_chunk', sessionId).endsWith('你好你好'), 'and so does the reply')
    }

    await assert.rejects(second.connection.agent.request(methods.agent.session.load, { sessionId: 'missing-session', cwd: host.workspace, mcpServers: [] }),
      /没有这个会话/u)
  } finally {
    await Promise.all([first.close(), second.close()])
    await host.close()
  }
})

test('session/cancel ends every prompt the client sent, the queued ones included, and the session keeps working', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请等待' }] })
    await until(() => client.text('agent_message_chunk', sessionId).includes('开始'), 'streaming started')
    const queued = ['打个招呼', '再打个招呼'].map(text => client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text }] }))
    const inbox = () => host.ctx.agents.get(sessionId as never)?.inbox.nextTurn.length ?? 0
    await until(() => inbox() === 2, 'both wait in the DSH queue')
    const asked = host.adapter.requests.length
    await client.connection.agent.notify(methods.agent.session.cancel, { sessionId })
    assert.deepEqual((await Promise.all([running, ...queued])).map(response => response.stopReason), ['cancelled', 'cancelled', 'cancelled'])
    assert.equal(inbox(), 0, 'the queued messages left the DSH queue')
    assert.equal(host.adapter.requests.length, asked, 'no queued message reached the model')
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '再打个招呼' }] })
    assert.equal(again.stopReason, 'end_turn')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a prompt sent while another runs waits in the DSH queue and gets a turn of its own', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const meta = client.initialized.agentCapabilities?._meta as { claudeCode?: { promptQueueing?: boolean } } | undefined
    assert.equal(meta?.claudeCode?.promptQueueing, true, 'clients that check this flag send prompts while a turn runs')
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const ended: string[] = []
    const responses = client.wire.filter(entry => entry === 'response').length
    const first = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '分段' }] })
    void first.then(() => ended.push('first'))
    await until(() => client.text('agent_message_chunk', sessionId) === '你好前半', 'the first reply is halfway')
    const second = client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    void second.then(() => ended.push('second'))
    // As after Enter in DSH Desktop during a reply: the message waits for the turn to end.
    await until(() => host.ctx.agents.get(sessionId as never)?.inbox.nextTurn.length === 1, 'the second message waits in the DSH queue')
    assert.equal(host.adapter.requests.length, 1)

    host.adapter.midway.open()
    assert.equal((await first).stopReason, 'end_turn')
    const answered = await second
    assert.equal(answered.stopReason, 'end_turn')
    assert.deepEqual(ended, ['first', 'second'], 'each prompt returns when its own turn ends')
    assert.deepEqual(answered.usage && { input: answered.usage.inputTokens, output: answered.usage.outputTokens }, { input: 12, output: 3 },
      'usage counts the second turn only')
    assert.equal(client.text('agent_message_chunk', sessionId), '你好前半后半你好')
    // ACP updates name no prompt: clients file each one under the prompt still unanswered.
    const secondTurn = client.wire.indexOf('agent_thought_chunk')
    assert.ok(secondTurn > 0, 'the second reply starts with its reasoning')
    assert.equal(client.wire.slice(0, secondTurn).filter(entry => entry === 'response').length, responses + 1,
      'the first prompt is answered before the second turn sends anything')
    assert.equal(host.adapter.requests.length, 2)
    const turns = host.ctx.agents.get(sessionId as never)!.session.snapshotEvents().filter(event => event.type === 'turn/end')
    assert.equal(turns.length, 2, 'the queued message ran in a turn of its own')
  } finally {
    await client.close()
    await host.close()
  }
})

test('DSH approvals reach the client as permission requests on the tool card', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const cardFirst: boolean[] = []
    for (const [optionId, result] of [['allow-once', '已执行'], ['reject', '已拒绝']] as const) {
      client.answerPermission = request => {
        // DSH sends approvals on another stream than the tool call; ACP clients look the card up by its ID.
        cardFirst.push(client.updates.some(item => item.update.sessionUpdate === 'tool_call' && item.update.toolCallId === request.toolCall.toolCallId))
        return { outcome: { outcome: 'selected', optionId } }
      }
      const before = client.permissions.length
      const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请调用工具' }] })
      assert.equal(response.stopReason, 'end_turn')
      const request = client.permissions[before]
      assert.ok(request, 'a permission request was sent')
      assert.deepEqual(request.options.map(item => item.optionId), ['allow-once', 'reject'])
      assert.equal(request.toolCall.title, 'danger', 'clients that show only the request still see which tool asks')
      const call = client.updates.find(item => item.update.sessionUpdate === 'tool_call' && item.update.toolCallId === request.toolCall.toolCallId)
      assert.equal((call?.update as { title?: string } | undefined)?.title, 'danger', 'the request points at the open tool card')
      const done = client.updates.findLast(item => item.update.sessionUpdate === 'tool_call_update' && item.update.toolCallId === request.toolCall.toolCallId)
      assert.match(JSON.stringify(done?.update), new RegExp(result, 'u'))
    }
    assert.deepEqual(cardFirst, [true, true], 'each permission request follows the card it points at')
    assert.ok(client.text('agent_message_chunk', sessionId).includes('工具完成'))
  } finally {
    await client.close()
    await host.close()
  }
})

test('a permission request the client dismisses leaves the decision to DSH, and the turn still ends', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    // The test client answers `cancelled` by default, as when the user closes the dialog.
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请调用工具' }] })
    assert.equal(response.stopReason, 'end_turn')
    const request = client.permissions[0]
    assert.ok(request && client.permissions.length === 1)
    const done = client.updates.findLast(item => item.update.sessionUpdate === 'tool_call_update' && item.update.toolCallId === request.toolCall.toolCallId)
    assert.match(JSON.stringify(done?.update), /已拒绝/u, 'with nobody approving, DSH does not run the tool')
    assert.ok(client.text('agent_message_chunk', sessionId).includes('工具完成'))
  } finally {
    await client.close()
    await host.close()
  }
})

test('ask_user_question becomes a form; a client without forms leaves it to DSH', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const forms = await connect(host.acpHome, { elicitation: { form: {} } })
  const plain = await connect(host.acpHome)
  try {
    forms.answerForm = () => ({ action: 'accept', content: { mode: '快速', notes: '保持简短' } })
    const { sessionId } = await forms.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const response = await forms.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请提问' }] })
    assert.equal(response.stopReason, 'end_turn')
    const form = forms.forms[0]
    assert.ok(form && form.mode === 'form', 'a form elicitation was sent')
    const schema = form.requestedSchema as { properties: Record<string, { oneOf?: { const: string }[] }> }
    assert.deepEqual(schema.properties.mode?.oneOf?.map(item => item.const), ['标准', '快速'])
    const result = forms.updates.findLast(item => item.update.sessionUpdate === 'tool_call_update' && item.update.status === 'completed')
    assert.match(JSON.stringify(result?.update), /快速/u, 'the answer reached the tool')
    assert.match(JSON.stringify(result?.update), /保持简短/u)

    const other = await plain.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const passed = await plain.connection.agent.request(methods.agent.session.prompt, { sessionId: other.sessionId, prompt: [{ type: 'text', text: '请提问' }] })
    assert.equal(passed.stopReason, 'end_turn')
    assert.match(plain.text('agent_message_chunk', other.sessionId), /请在 DSH 中作答/u, 'a free-text question still needs DSH')
    assert.equal(plain.forms.length, 0)
    assert.equal(plain.permissions.length, 0, 'a request with a free-text question is not offered as choices')
  } finally {
    await Promise.all([forms.close(), plain.close()])
    await host.close()
  }
})

test('a client without forms answers single-choice questions from a list of choices', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    client.answerPermission = request => {
      const option = request.options.find(item => item.name.startsWith('快速'))
      return option ? { outcome: { outcome: 'selected', optionId: option.optionId } } : { outcome: { outcome: 'cancelled' } }
    }
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请单选' }] })
    assert.equal(response.stopReason, 'end_turn')
    const request = client.permissions[0]
    assert.ok(request, 'the question was offered as choices')
    assert.equal(request.toolCall.title, '模式：选择模式')
    assert.deepEqual(request.options.map(item => [item.name, item.kind]), [['标准', 'allow_once'], ['快速（少做检查）', 'allow_once']])
    const card = client.updates.findLast(item => item.update.sessionUpdate === 'tool_call_update' && item.update.toolCallId === request.toolCall.toolCallId)
    assert.equal((card?.update as { status?: string } | undefined)?.status, 'completed', 'the question card closes with the choice')
    const result = client.updates.findLast(item => item.update.sessionUpdate === 'tool_call_update' && item.update.status === 'completed'
      && item.update.toolCallId !== request.toolCall.toolCallId)
    assert.match(JSON.stringify(result?.update), /快速/u, 'the choice reached ask_user_question as its answer')
    assert.doesNotMatch(client.text('agent_message_chunk', sessionId), /请在 DSH 中作答/u)
  } finally {
    await client.close()
    await host.close()
  }
})

test('configuration and slash commands act on the shared DSH session', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const preset = await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'agent_preset', value: 'minimal' })
    assert.equal(option(preset.configOptions, 'agent_preset')?.currentValue, 'minimal')
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    assert.equal(host.ctx.agents.get(sessionId as never)?.session.header.agentPreset, 'minimal', 'the preset chosen before the first prompt composes the Agent')
    // Without this update the client keeps offering an Agent mode it can no longer change, and no plan mode.
    await until(() => client.updates.some(item => item.update.sessionUpdate === 'config_option_update'
      && option((item.update as { configOptions: SessionConfigOption[] }).configOptions, 'agent_preset') === undefined),
    'the options of the session the first prompt created are pushed to the client')
    await assert.rejects(client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'agent_preset', value: 'standard' }),
      /第一条消息前/u)

    const changed = await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'permission', value: 'danger-full-access' })
    assert.equal(option(changed.configOptions, 'permission')?.currentValue, 'danger-full-access')
    assert.equal(option(changed.configOptions, 'agent_team'), undefined, 'no team switch where DSH has no agent teams')
    assert.equal(host.ctx.permissionPresets.current(host.ctx.agents.get(sessionId as never)!.session), 'danger-full-access')

    const menu = client.updates.findLast(item => item.update.sessionUpdate === 'available_commands_update')
    assert.ok((menu?.update as { availableCommands?: { name: string }[] }).availableCommands?.some(item => item.name === 'permission'))
    const command = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '/permission workspace-write' }] })
    assert.equal(command.stopReason, 'end_turn')
    assert.equal(host.ctx.permissionPresets.current(host.ctx.agents.get(sessionId as never)!.session), 'workspace-write', 'the command ran in DSH')
    await until(() => client.updates.some(item => item.update.sessionUpdate === 'config_option_update'
      && option((item.update as { configOptions: SessionConfigOption[] }).configOptions, 'permission')?.currentValue === 'workspace-write'),
    'the change made by the command is pushed to the client')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a client that loads in the middle of a step still gets the whole step', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const first = await connect(host.acpHome)
  const second = await connect(host.acpHome)
  try {
    const { sessionId } = await first.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const running = first.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请分段回答' }] })
    await until(() => host.adapter.midway.reached === 1 && first.text('agent_message_chunk', sessionId) === '你好前半', 'half of the step is streamed')
    await second.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [] })
    assert.equal(second.text('user_message_chunk', sessionId), '请分段回答')
    assert.equal(second.text('agent_message_chunk', sessionId), '你好前半', 'the load replays the step so far')
    host.adapter.midway.open()
    assert.equal((await running).stopReason, 'end_turn')
    await until(() => second.text('agent_message_chunk', sessionId) === '你好前半后半', 'the rest follows live')
    await delay(200)
    assert.equal(second.text('agent_message_chunk', sessionId), '你好前半后半', 'the committed message is not sent again')
    assert.equal(first.text('agent_message_chunk', sessionId), '你好前半后半')
  } finally {
    host.adapter.midway.open()
    await Promise.all([first.close(), second.close()])
    await host.close()
  }
})

test('a client that disappears mid-turn cancels its turn without disturbing DSH', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const rejections: unknown[] = []
  const onRejection = (reason: unknown) => { rejections.push(reason) }
  process.on('unhandledRejection', onRejection)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    void client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请等待' }] }).catch(() => undefined)
    await until(() => client.text('agent_message_chunk', sessionId).includes('开始'), 'streaming started')
    void client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] }).catch(() => undefined)
    await until(() => host.ctx.agents.get(sessionId as never)?.inbox.nextTurn.length === 1, 'a second message waits in the DSH queue')
    client.kill()
    const events = () => host.ctx.agents.get(sessionId as never)?.session.snapshotEvents() ?? []
    await until(() => events().some(event => event.type === 'turn/end'), 'the abandoned turn was cancelled')
    await until(() => host.ctx.agents.get(sessionId as never)?.inbox.nextTurn.length === 0, 'the abandoned queued message was withdrawn')

    const other = await connect(host.acpHome)
    try {
      await other.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
      const response = await other.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
      assert.equal(response.stopReason, 'end_turn')
      assert.equal(other.text('agent_message_chunk', sessionId), '你好', 'resume does not replay history')
    } finally { await other.close() }
    assert.deepEqual(rejections, [], 'no promise rejection escaped into the DSH process')
  } finally {
    process.off('unhandledRejection', onRejection)
    await client.close()
    await host.close()
  }
})

test('an approval answered in DSH first is withdrawn from the client', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  // DSH Desktop: another owner client of the same interaction stream, answering a moment later.
  const { InteractionStream } = await import('../../src/acp/interaction-stream.js')
  const desktop: InstanceType<typeof InteractionStream> = new InteractionStream(host.ctx, async frame => {
    if (frame.type !== 'waterfall') return
    if (frame.event !== 'approval/request') { await desktop.reply(frame.eventId as string, { kind: 'next' }); return }
    await until(() => client.permissions.length > 0, 'the client was asked too')
    await desktop.reply(frame.eventId as string, { kind: 'result', value: 'rejected' })
  }, { debug() {}, info() {}, warn() {}, error() {} })
  try {
    await until(() => desktop.available, 'desktop stream connected')
    let withdrawn = false
    client.answerPermission = (_request, signal) => new Promise(resolve => {
      signal.addEventListener('abort', () => { withdrawn = true; resolve({ outcome: { outcome: 'cancelled' } }) }, { once: true })
    })
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请调用工具' }] })
    assert.equal(response.stopReason, 'end_turn')
    await until(() => withdrawn, 'the pending permission request was cancelled on the client')
    const result = client.updates.findLast(item => item.update.sessionUpdate === 'tool_call_update' && item.update.status === 'completed')
    assert.match(JSON.stringify(result?.update), /已拒绝/u, 'DSH followed the answer given in DSH')
  } finally {
    await desktop.close()
    await client.close()
    await host.close()
  }
})

test('images reach the model and model changes made in DSH reach the client', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [
      { type: 'text', text: '看看这张图' }, { type: 'image', data: png, mimeType: 'image/png' }] })
    assert.equal(response.stopReason, 'end_turn')
    const sent = host.adapter.requests.at(-1)?.messages.findLast(message => message.role === 'user' && (message as { source?: { kind?: string } }).source?.kind === 'user')
    assert.ok((sent?.content as readonly { type: string }[] | undefined)?.some(block => block.type === 'image'), 'the model received the image')

    // DSH Desktop switches the model of the same session.
    await host.ctx.sessionController.selectModel({ sessionId: sessionId as never, provider: 'test', model: 'thinking' })
    await until(() => client.updates.some(item => item.update.sessionUpdate === 'config_option_update'
      && option((item.update as { configOptions: SessionConfigOption[] }).configOptions, 'model')?.currentValue === 'test/thinking'),
    'the client follows the model chosen in DSH')
  } finally {
    await client.close()
    await host.close()
  }
})
