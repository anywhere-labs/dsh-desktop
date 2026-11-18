/**
 * ACP features beyond the core prompt loop: the todo list as the client's
 * plan, deleting and forking sessions, approvals that were already waiting
 * when the client opened the session, files the editor attaches, the working
 * directory filter of `session/list`, and a launcher that survives a late
 * rejection inside MeshCall.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdir, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { methods, type ContentBlock, type SessionNotification } from '@agentclientprotocol/sdk'
import { holdInteractions, startHost, type Host } from '../fixtures/host.js'
import { connect, until, type TestClient } from '../fixtures/client.js'

const hello: ContentBlock[] = [{ type: 'text', text: '打个招呼' }]

function plans(client: TestClient, sessionId: string): SessionNotification['update'][] {
  return client.updates.filter(item => item.sessionId === sessionId && item.update.sessionUpdate === 'plan').map(item => item.update)
}

function entries(update: SessionNotification['update'] | undefined): unknown {
  return update?.sessionUpdate === 'plan' ? update.entries : undefined
}

function events(host: Host, sessionId: string) {
  return host.ctx.agents.get(sessionId as never)?.session.snapshotEvents() ?? []
}

/** A session DSH Desktop created and prompted, as its own composer does. */
async function desktopSession(host: Host, text: string, cwd = host.workspace): Promise<string> {
  const { sessionId } = await host.ctx.sessionController.create({ cwd })
  await host.ctx.sessionController.prompt({ requestId: `desktop-${Date.now()}` as never, sessionId, mode: 'queue',
    content: [{ type: 'text', text }] }, new AbortController().signal)
  return sessionId
}

const PLAN = [
  { content: '读代码', priority: 'medium', status: 'completed' },
  { content: '写测试', priority: 'medium', status: 'in_progress' },
  { content: '提交', priority: 'medium', status: 'pending' },
]

test('the DSH todo list is the client\'s plan, cleared when the next turn starts', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const other = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const planned = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '请列计划' }] })
    assert.equal(planned.stopReason, 'end_turn')
    assert.deepEqual(entries(plans(client, sessionId).at(-1)), PLAN)

    // A client that opens the session later gets the current plan with it.
    await other.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    await until(() => plans(other, sessionId).length > 0, 'the current plan reaches a client that opens the session')
    assert.deepEqual(entries(plans(other, sessionId).at(-1)), PLAN)

    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    assert.deepEqual(entries(plans(client, sessionId).at(-1)), [], 'DSH starts every turn without a todo list')
  } finally {
    await Promise.all([client.close(), other.close()])
    await host.close()
  }
})

test('session/delete archives the session in DSH, and refuses while DSH Desktop still runs it', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    assert.deepEqual(client.initialized.agentCapabilities?.sessionCapabilities?.delete, {})
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    await client.connection.agent.request(methods.agent.session.delete, { sessionId })
    assert.ok(host.ctx.workspaceRegistry.archivedSessionIds.includes(sessionId as never), 'the session is archived in DSH')
    const listed = await client.connection.agent.request(methods.agent.session.list, { cwd: host.workspace })
    assert.equal(listed.sessions.some(item => item.sessionId === sessionId), false)
    await assert.rejects(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello }), /未知的会话/u)

    // The client's own running prompt is cancelled first.
    const own = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const running = client.connection.agent.request(methods.agent.session.prompt, { sessionId: own.sessionId, prompt: [{ type: 'text', text: '请等待' }] })
    await until(() => client.text('agent_message_chunk', own.sessionId).endsWith('开始'), 'the prompt is running')
    await client.connection.agent.request(methods.agent.session.delete, { sessionId: own.sessionId })
    assert.equal((await running).stopReason, 'cancelled')
    assert.ok(host.ctx.workspaceRegistry.archivedSessionIds.includes(own.sessionId as never))

    // A turn DSH Desktop started is not the client's to stop.
    const busy = await desktopSession(host, '请等待')
    await until(() => host.ctx.agents.get(busy as never)?.status === 'running', 'DSH Desktop runs a turn')
    await client.connection.agent.request(methods.agent.session.resume, { sessionId: busy, cwd: host.workspace, mcpServers: [] })
    await assert.rejects(client.connection.agent.request(methods.agent.session.delete, { sessionId: busy }), /还有任务在运行/u)
    assert.equal(host.ctx.workspaceRegistry.archivedSessionIds.includes(busy as never), false)
    host.ctx.sessionController.cancel({ sessionId: busy as never })
  } finally {
    await client.close()
    await host.close()
  }
})

test('session/fork continues a copy of a DSH session and leaves the original alone', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  const viewer = await connect(host.acpHome)
  try {
    assert.deepEqual(client.initialized.agentCapabilities?.sessionCapabilities?.fork, {})
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: hello })
    const original = events(host, sessionId).length

    const forked = await client.connection.agent.request(methods.agent.session.fork, { sessionId, cwd: host.workspace, mcpServers: [] })
    assert.notEqual(forked.sessionId, sessionId)
    assert.ok(forked.configOptions?.some(option => option.id === 'model'))
    const again = await client.connection.agent.request(methods.agent.session.prompt, { sessionId: forked.sessionId, prompt: [{ type: 'text', text: '再打个招呼' }] })
    assert.equal(again.stopReason, 'end_turn')
    assert.equal(events(host, sessionId).length, original, 'the original session did not change')

    await viewer.connection.agent.request(methods.agent.session.load, { sessionId: forked.sessionId, cwd: host.workspace, mcpServers: [] })
    assert.equal(viewer.text('user_message_chunk', forked.sessionId), '打个招呼再打个招呼', 'the fork starts from the original history')
  } finally {
    await Promise.all([client.close(), viewer.close()])
    await host.close()
  }
})

test('an approval DSH was already waiting for reaches a client that opens the session later', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const stopDesktop = holdInteractions(host.ctx)
  const client = await connect(host.acpHome)
  let sessionId: string | undefined
  try {
    sessionId = await desktopSession(host, '请调用工具')
    await until(() => host.ctx.typertGateway.getPendingRemoteEvents().some(item => item.event === 'approval/request'), 'DSH waits for the approval')
    client.answerPermission = () => ({ outcome: { outcome: 'selected', optionId: 'allow-once' } })
    await client.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    await until(() => client.permissions.length === 1, 'the waiting approval reaches the client')
    await until(() => events(host, sessionId!).some(event => event.type === 'turn/end'), 'the turn ends')
    const result = events(host, sessionId).find(event => event.type === 'tool/result')
    assert.match(JSON.stringify(result?.data), /已执行/u, 'the client\'s answer decided the approval')
  } finally {
    // A turn still waiting for its approval would keep the host from closing.
    if (sessionId && host.ctx.agents.get(sessionId as never)?.status === 'running') host.ctx.sessionController.cancel({ sessionId: sessionId as never })
    stopDesktop()
    await client.close()
    await host.close()
  }
})

test('files the editor attaches reach DSH as uploaded files', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const bytes = Buffer.from('%PDF-1.4 测试文件')
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [
      { type: 'text', text: '看看这个文件' },
      { type: 'resource', resource: { uri: 'file:///tmp/report.pdf', mimeType: 'application/pdf', blob: bytes.toString('base64') } },
    ] })
    assert.equal(response.stopReason, 'end_turn')
    const message = events(host, sessionId).find(event => event.type === 'user/message')
    const content = (message?.data as { content?: { type: string, attachment?: { name?: string, bytes?: number } }[] } | undefined)?.content ?? []
    const file = content.find(block => block.type === 'file')
    assert.deepEqual(file?.attachment && { name: file.attachment.name, bytes: file.attachment.bytes }, { name: 'report.pdf', bytes: bytes.length })
  } finally {
    await client.close()
    await host.close()
  }
})

test('session/list matches the working directory however either side spells it', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const link = join(host.root, 'link')
    await mkdir(join(host.root, 'elsewhere'), { recursive: true })
    await symlink(host.workspace, link, 'dir')
    // DSH Desktop opened the project through a symbolic link.
    const sessionId = await desktopSession(host, '打个招呼', link)
    await until(() => events(host, sessionId).some(event => event.type === 'turn/end'), 'the turn ends')
    for (const cwd of [host.workspace, link]) {
      const listed = await client.connection.agent.request(methods.agent.session.list, { cwd })
      assert.ok(listed.sessions.some(item => item.sessionId === sessionId), `listed under ${cwd}`)
    }
    const elsewhere = await client.connection.agent.request(methods.agent.session.list, { cwd: join(host.root, 'elsewhere') })
    assert.equal(elsewhere.sessions.some(item => item.sessionId === sessionId), false)
  } finally {
    await client.close()
    await host.close()
  }
})

test('a late rejection inside the launcher does not end the ACP connection', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const probe = pathToFileURL(new URL('../fixtures/late-rejection.mjs', import.meta.url).pathname).href
  const client = await connect(host.acpHome, {}, { execArgv: ['--import', probe] })
  try {
    await delay(600)
    const listed = await client.connection.agent.request(methods.agent.session.list, {})
    assert.ok(Array.isArray(listed.sessions), 'the launcher still forwards messages')
  } finally {
    await client.close()
    await host.close()
  }
})
