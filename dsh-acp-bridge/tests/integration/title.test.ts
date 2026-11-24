import assert from 'node:assert/strict'
import test from 'node:test'
import { methods, type SessionUpdate } from '@agentclientprotocol/sdk'
import SessionTitle from '@deepseek-ai/dsh-session-title'
import { SET_SESSION_TITLE } from '../../src/acp/title.js'
import { interactionPeer } from '../../src/acp/interaction-stream.js'
import { CONNECTIONS_PATH, type ConnectionState } from '../../src/management-contract.js'
import { connect, until } from '../fixtures/client.js'
import { startHost } from '../fixtures/host.js'

test('generic ACP retitling persists through DSH, pins user titles and notifies other clients', { timeout: 60_000 }, async () => {
  const host = await startHost()
  await host.ctx.plugin(SessionTitle, { fallbackMaxWords: 10, fallbackMaxBytes: 100, maxTitleBytes: 200 }).await()
  const first = await connect(host.acpHome)
  const second = await connect(host.acpHome)
  const rename = (sessionId: string, title: unknown) => first.connection.agent.request<{ title: string }>(SET_SESSION_TITLE, { sessionId, title })
  const titleOf = (update: SessionUpdate) => update.sessionUpdate === 'session_info_update' ? update.title : undefined
  try {
    assert.deepEqual((first.initialized.agentCapabilities?.sessionCapabilities as Record<string, unknown>).title, {})
    const { sessionId } = await first.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    assert.equal(host.ctx.agents.get(sessionId as never), undefined)
    for (const title of [null, '', '   ', 42]) await assert.rejects(rename(sessionId, title), { code: -32602 })
    assert.equal(host.ctx.agents.get(sessionId as never), undefined, 'invalid title does not create a DSH session')
    assert.deepEqual(await rename(sessionId, '  MCP   test  '), { title: 'MCP test' })
    const agent = host.ctx.agents.get(sessionId as never)!
    assert.equal(host.ctx.sessionTitle.get(agent.session)?.title, 'MCP test')
    assert.equal(host.ctx.sessionTitle.get(agent.session)?.source.kind, 'user')
    await until(() => first.updates.some(item => titleOf(item.update) === 'MCP test'), 'rename notification')
    await first.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'another prompt' }] })
    assert.equal(host.ctx.sessionTitle.get(agent.session)?.title, 'MCP test', 'automatic titles do not replace an explicit user title')
    await second.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    await first.connection.agent.request(methods.agent.session.close, { sessionId })
    assert.deepEqual(await rename(sessionId, 'Shared title'), { title: 'Shared title' }, 'a listed session need not be open on the requesting connection')
    await until(() => second.updates.some(item => titleOf(item.update) === 'Shared title'), 'other client sees rename')
    const response = await host.ctx.connection.createSharedFetchHandler('/api').fetch(
      new Request(`http://localhost${CONNECTIONS_PATH}`), interactionPeer(host.ctx.connection))
    const state = await response.json() as ConnectionState
    assert.equal(state.clients.flatMap(client => client.sessions).find(session => session.id === sessionId)?.title, 'Shared title')
    const listed = await first.connection.agent.request(methods.agent.session.list, {})
    assert.equal(listed.sessions.find(item => item.sessionId === sessionId)?.title, 'Shared title')
    await assert.rejects(rename('missing-session', 'Missing'), { code: -32002 })
    await host.ctx.workspaceRegistry.archiveSession(sessionId as never)
    await assert.rejects(rename(sessionId, 'Archived'), { code: -32002 })
  } finally {
    await first.close(); await second.close(); await host.close()
  }
})

test('a Host without the official title service does not advertise or accept retitling', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    assert.equal((client.initialized.agentCapabilities?.sessionCapabilities as Record<string, unknown>).title, undefined)
    await assert.rejects(client.connection.agent.request(SET_SESSION_TITLE, { sessionId: 'missing', title: 'Name' }), { code: -32601 })
  } finally { await client.close(); await host.close() }
})
