/**
 * MCP servers the ACP client declares, mounted the way the official dsh-acp does: each one is a
 * DSH mcp-client in the session Agent's scope, so its tools are that session's alone. DSH
 * sessions are shared, so clients that declare the same server share one connection, and the
 * server is unmounted when the last of them stops following the session.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'
import { methods, type ContentBlock, type McpServer } from '@agentclientprotocol/sdk'
import { startHost, type Host } from '../fixtures/host.js'
import { connect, until, type TestClient } from '../fixtures/client.js'

const serverScript = fileURLToPath(new URL('../fixtures/mcp-server.mjs', import.meta.url))
const echo: ContentBlock[] = [{ type: 'text', text: '用 MCP 回声' }]

/** The fixture server; `prefix` changes what it answers, so two declarations of it differ. */
function echoServer(host: Host, prefix = 'echo', name = 'echo'): McpServer {
  return { name, command: process.execPath, args: [serverScript], env: [
    { name: 'MCP_EVENTS', value: join(host.root, 'mcp-events.log') },
    { name: 'ECHO_PREFIX', value: prefix },
  ] }
}

/** `ready …` and `exit …` lines the fixture servers wrote, in order: one pair per MCP connection. */
async function serverEvents(host: Host): Promise<string[]> {
  try { return (await readFile(join(host.root, 'mcp-events.log'), 'utf8')).split('\n').filter(Boolean) } catch { return [] }
}

async function count(host: Host, event: 'ready' | 'exit'): Promise<number> {
  return (await serverEvents(host)).filter(line => line.startsWith(`${event} `)).length
}

/** Like `until`, for checks that read files. */
async function eventually(check: () => Promise<boolean>, label: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`)
    await delay(20)
  }
}

/** MCP tool names one session's Agent sees, or the ones every session sees. */
function mcpTools(host: Host, sessionId?: string): string[] {
  const agent = sessionId === undefined ? undefined : host.ctx.agents.get(sessionId as never)
  if (sessionId !== undefined && !agent) return []
  return host.ctx.tools.definitions(agent).map(tool => tool.name).filter(name => name.startsWith('mcp__'))
}

/** Title or status and text of each tool card update the client received for the session. */
function cards(client: TestClient, sessionId: string): string[] {
  return client.updates.filter(item => item.sessionId === sessionId).flatMap(item => {
    const update = item.update
    if (update.sessionUpdate !== 'tool_call' && update.sessionUpdate !== 'tool_call_update') return []
    const text = (update.content ?? []).map(block => block.type === 'content' && block.content.type === 'text' ? block.content.text : '').join('')
    return [`${update.sessionUpdate === 'tool_call' ? update.title : update.status}${text ? ` ${text}` : ''}`]
  })
}

test('declared MCP servers mount in the session Agent when the first prompt creates the session', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    assert.equal(client.initialized.agentCapabilities?.mcpCapabilities?.http, true, 'HTTP servers are accepted, as in the official dsh-acp')
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [echoServer(host)] })
    assert.equal(await count(host, 'ready'), 0, 'nothing starts before DSH creates the session')

    const answered = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: echo })
    assert.equal(answered.stopReason, 'end_turn')
    assert.deepEqual(cards(client, sessionId), ['mcp__echo__echo', 'completed echo: 你好'])
    assert.equal(client.text('agent_message_chunk', sessionId), '工具完成')
    assert.deepEqual(mcpTools(host, sessionId), ['mcp__echo__echo'])
    assert.deepEqual(mcpTools(host), [], 'the tools belong to that session only')

    // Another session of the same client has no such tool.
    const other = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId: other.sessionId, prompt: echo })
    assert.equal(client.text('agent_message_chunk', other.sessionId), '没有 MCP 工具')

    await client.connection.agent.request(methods.agent.session.close, { sessionId })
    await until(() => mcpTools(host, sessionId).length === 0, 'closing the session unmounts its servers')
    await eventually(async () => await count(host, 'exit') === 1, 'the server process ends')
    assert.equal(await count(host, 'ready'), 1)
  } finally {
    await client.close()
    await host.close()
  }
})

test('declarations are checked before DSH creates or copies anything', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const refused = async (mcpServers: unknown[], pattern: RegExp) => {
      await assert.rejects(client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: mcpServers as McpServer[] }), pattern)
    }
    await refused([{ name: 'relative', command: 'node', args: [], env: [] }], /绝对路径/u)
    await refused([echoServer(host), echoServer(host, 'other')], /重名/u)
    await refused([{ type: 'sse', name: 'old', url: 'https://example.com/sse', headers: [] }], /sse/u)
    await refused([{ type: 'http', name: 'web', url: 'ftp://example.com/mcp', headers: [] }], /HTTP/u)
    await refused([{ type: 'http', name: 'web', url: 'https://example.com/mcp', headers: [{ name: 'X-Key', value: 'a' }, { name: 'x-key', value: 'b' }] }], /请求头/u)

    // A fork with a bad declaration is refused before DSH copies the session.
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    const before = (await host.ctx.sessionController.list({}, new AbortController().signal)).items.length
    await assert.rejects(client.connection.agent.request(methods.agent.session.fork, { sessionId, cwd: host.workspace,
      mcpServers: [{ name: 'relative', command: 'node', args: [], env: [] }] }), /绝对路径/u)
    assert.equal((await host.ctx.sessionController.list({}, new AbortController().signal)).items.length, before)
  } finally {
    await client.close()
    await host.close()
  }
})

test('a server that cannot start fails the prompt with its name and leaves DSH usable', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const broken: McpServer = { name: 'broken', command: process.execPath, args: ['-e', 'process.exit(3)'], env: [] }
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [broken] })
    await assert.rejects(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: echo }), /broken/u)
    assert.deepEqual(mcpTools(host, sessionId), [])

    const healthy = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const answered = await client.connection.agent.request(methods.agent.session.prompt, { sessionId: healthy.sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    assert.equal(answered.stopReason, 'end_turn')
  } finally {
    await client.close()
    await host.close()
  }
})

test('clients following one session share a server they declare the same way', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const first = await connect(host.acpHome)
  const second = await connect(host.acpHome)
  const third = await connect(host.acpHome)
  try {
    const { sessionId } = await first.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [echoServer(host)] })
    await first.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: echo })
    await second.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [echoServer(host)] })
    assert.equal(await count(host, 'ready'), 1, 'the same declaration reuses the running server')
    await assert.rejects(third.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [echoServer(host, 'other')] }),
      /同名.*echo|echo.*同名/u, 'one session cannot hold two different servers under one name')

    await first.connection.agent.request(methods.agent.session.close, { sessionId })
    const answered = await second.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: echo })
    assert.equal(answered.stopReason, 'end_turn')
    assert.ok(cards(second, sessionId).includes('completed echo: 你好'), 'the server stays while another client declared it')
    assert.equal(await count(host, 'exit'), 0)

    await second.connection.agent.request(methods.agent.session.close, { sessionId })
    await until(() => mcpTools(host, sessionId).length === 0, 'the last client\'s close unmounts the server')
  } finally {
    await Promise.all([first.close(), second.close(), third.close()])
    await host.close()
  }
})

test('session/load mounts the declared servers in an existing session, and a disconnect unmounts them', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await host.ctx.sessionController.create({ cwd: host.workspace })
    await client.connection.agent.request(methods.agent.session.load, { sessionId, cwd: host.workspace, mcpServers: [echoServer(host)] })
    assert.equal(await count(host, 'ready'), 1, 'the server is ready when session/load answers')
    assert.deepEqual(mcpTools(host, sessionId), ['mcp__echo__echo'])
    const answered = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: echo })
    assert.equal(answered.stopReason, 'end_turn')
    assert.ok(cards(client, sessionId).includes('completed echo: 你好'))

    await client.close()
    await until(() => mcpTools(host, sessionId).length === 0, 'a closed connection unmounts its servers')
  } finally {
    await client.close()
    await host.close()
  }
})
