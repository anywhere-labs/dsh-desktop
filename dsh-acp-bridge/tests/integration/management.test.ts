import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { methods } from '@agentclientprotocol/sdk'
import { CONNECTIONS_PATH, MANAGEMENT_PATH, type ConnectionState, type ManagementState } from '../../src/management-contract.js'
import { interactionPeer } from '../../src/acp/interaction-stream.js'
import { launcherPath } from '../../src/paths.js'
import { readRecords } from '../../src/endpoint.js'
import { startHost } from '../fixtures/host.js'
import { connect, until } from '../fixtures/client.js'

test('management reads live status, persists settings, repairs the launcher, and unmounts with the plugin', { timeout: 60_000 }, async () => {
  const host = await startHost()
  try {
    const handler = host.ctx.connection.createSharedFetchHandler('/api')
    const request = (body?: object) => handler.fetch(new Request(`http://localhost${MANAGEMENT_PATH}`, body
      ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}), interactionPeer(host.ctx.connection))
    const forbidden = await handler.fetch(new Request(`http://localhost${MANAGEMENT_PATH}`),
      { ...interactionPeer(host.ctx.connection), principal: { kind: 'remote' } } as unknown as ReturnType<typeof interactionPeer>)
    assert.equal(forbidden.status, 403, 'only the owner can read management state')
    let response = await request()
    assert.equal(response.status, 200)
    const state = await response.json() as ManagementState
    assert.equal(state.ready, true)
    assert.equal(state.connections, 0)
    const [record] = await readRecords(host.acpHome)
    assert.ok(record)
    assert.equal(JSON.stringify(state).includes(record.record.token), false)
    response = await request({ action: 'save', settings: { enabled: false, mode: 'desktop', timeoutSeconds: 25, profile: '' } })
    assert.equal(response.status, 200)
    assert.equal(JSON.parse(await readFile(join(host.acpHome, 'startup.json'), 'utf8')).enabled, false)
    response = await request({ action: 'save', settings: { enabled: true, mode: 'cli', timeoutSeconds: 25, profile: 'desktop' } })
    assert.equal(response.status, 400)
    assert.equal(JSON.parse(await readFile(join(host.acpHome, 'startup.json'), 'utf8')).enabled, false)
    await rm(launcherPath(host.acpHome))
    assert.equal((await (await request()).json() as ManagementState).checks[0]?.ok, false)
    response = await request({ action: 'repair' })
    assert.equal(response.status, 200)
    assert.match(await readFile(launcherPath(host.acpHome), 'utf8'), /--home/u)
    await writeFile(join(host.acpHome, 'startup.json'), '{broken')
    const damaged = await (await request()).json() as ManagementState
    assert.equal(damaged.settings.enabled, false)
    assert.ok(damaged.checks.some(check => check.label === 'Startup settings' && !check.ok))
    response = await request({ action: 'save', settings: { enabled: false, mode: 'desktop', timeoutSeconds: 30, profile: '' } })
    assert.equal(response.status, 200, 'the panel can repair damaged settings')
    await host.unload()
    assert.equal((await request()).status, 404)

    // Request diagnostics immediately after reinstall, before waiting for a launcher or endpoint.
    const plugin = await import(new URL('../../lib/index.js', import.meta.url).href) as typeof import('../../src/index.js')
    await host.ctx.plugin(plugin, { home: host.acpHome }).await()
    const firstRead = await request()
    assert.equal(firstRead.status, 200)
    const reinstalled = await firstRead.json() as ManagementState
    assert.equal(reinstalled.ready, true)
    assert.equal(reinstalled.checks.find(check => check.label === 'Launcher')?.ok, true)
  } finally { await host.close() }
})

test('owner-only connection stream pushes client and session changes and closes on unload', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const handler = host.ctx.connection.createSharedFetchHandler('/api')
  const peer = interactionPeer(host.ctx.connection)
  const request = (path: string, signal?: AbortSignal) => handler.fetch(new Request(`http://localhost${path}`, signal ? { signal } : {}), peer)
  const clients: Awaited<ReturnType<typeof connect>>[] = []
  const controller = new AbortController()
  try {
    const forbidden = await handler.fetch(new Request(`http://localhost${CONNECTIONS_PATH}?watch=1`),
      { ...peer, principal: { kind: 'remote' } } as unknown as typeof peer)
    assert.equal(forbidden.status, 403)
    const response = await request(`${CONNECTIONS_PATH}?watch=1`, controller.signal)
    assert.equal(response.status, 200)
    const reader = response.body!.getReader()
    const snapshots: ConnectionState[] = []
    const consumed = (async () => {
      const decoder = new TextDecoder()
      let buffer = ''
      for (;;) {
        const chunk = await reader.read()
        if (chunk.done) return
        buffer += decoder.decode(chunk.value, { stream: true })
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          if (line) snapshots.push(JSON.parse(line) as ConnectionState)
        }
      }
    })()
    await until(() => snapshots.length > 0, 'initial connection baseline')
    assert.equal(snapshots.at(-1)!.connections, 0)
    const first = await connect(host.acpHome)
    clients.push(first)
    await until(() => snapshots.at(-1)?.clients[0]?.initialized === true, 'initialized client pushed')
    assert.deepEqual(snapshots.at(-1)!.clients[0]!.client, { name: 'test-client', version: '1.0.0' })
    const { sessionId } = await first.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await until(() => snapshots.at(-1)?.sessions === 1, 'new session pushed before its first prompt')
    assert.deepEqual(snapshots.at(-1)!.clients[0]!.sessions[0], { id: sessionId, cwd: host.workspace })
    await first.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: 'private prompt' }] })
    // The minimal Host has no title service; append the same durable event that an official rename writes.
    host.ctx.agents.get(sessionId as never)!.session.append('session/title', {
      title: 'Connection smoke session', messageSeqs: [], source: { kind: 'user' },
    })
    await until(() => snapshots.at(-1)?.clients[0]?.sessions[0]?.title === 'Connection smoke session', 'session title pushed')
    const second = await connect(host.acpHome)
    clients.push(second)
    await second.connection.agent.request(methods.agent.session.resume, { sessionId, cwd: host.workspace, mcpServers: [] })
    await until(() => snapshots.at(-1)?.clients[1]?.sessions.length === 1, 'second client attaches')
    assert.equal(snapshots.at(-1)!.connections, 2)
    assert.equal(snapshots.at(-1)!.sessions, 1, 'shared sessions count once')
    assert.equal(JSON.stringify(snapshots).includes('private prompt'), false)
    const [record] = await readRecords(host.acpHome)
    assert.equal(JSON.stringify(snapshots).includes(record!.record.token), false)
    await first.connection.agent.request(methods.agent.session.close, { sessionId })
    await until(() => snapshots.at(-1)?.clients[0]?.sessions.length === 0, 'session close pushed')
    await second.close()
    await until(() => snapshots.at(-1)?.connections === 1, 'client disconnect pushed')
    assert.equal(snapshots.at(-1)!.sessions, 0)
    assert.deepEqual(await (await request(CONNECTIONS_PATH)).json(), snapshots.at(-1), 'manual refresh reads the same live registry')
    // Cancelled readers release their subscription without trying to close an already-cancelled stream.
    const cancelled = await request(`${CONNECTIONS_PATH}?watch=1`)
    await cancelled.body!.cancel()
    const aborted = new AbortController()
    const abortResponse = await request(`${CONNECTIONS_PATH}?watch=1`, aborted.signal)
    const abortReader = abortResponse.body!.getReader()
    await abortReader.read()
    aborted.abort()
    assert.equal((await abortReader.read()).done, true)
    await host.unload()
    await consumed
    assert.equal((await request(CONNECTIONS_PATH)).status, 404)
  } finally {
    controller.abort()
    await Promise.all(clients.map(client => client.close()))
    await host.close()
  }
})
