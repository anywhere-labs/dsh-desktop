/**
 * The public RPC client (`@agents-anywhere/dsh-acp-bridge/client`), loaded from
 * the built package as other programs load it, against a running DSH.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { randomBytes } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { client as acpClient, methods, type SessionNotification } from '@agentclientprotocol/sdk'
import type * as Client from '../../src/client.js'
import { readRecords, writeRecord, type EndpointRecord } from '../../src/endpoint.js'
import { bridgeInfo, startHost } from '../fixtures/host.js'

/** The published entry point; typed from the source so type checks run before the build. */
async function load(): Promise<typeof Client> {
  const specifier = '@agents-anywhere/dsh-acp-bridge/client'
  return await import(specifier) as typeof Client
}

async function settled(acpHome: string, connections: number): Promise<void> {
  const deadline = Date.now() + 5_000
  while ((await bridgeInfo(acpHome)).connections !== connections) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${connections} ACP connections`)
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

test('another program reaches DSH through the public client and speaks ACP over it', { timeout: 60_000 }, async () => {
  const rpc = await load()
  const host = await startHost()
  const dsh = await rpc.connectDsh({ home: host.acpHome })
  try {
    const [stored] = await readRecords(host.acpHome)
    assert.equal(dsh.record.instanceId, stored?.record.instanceId)
    assert.equal(dsh.info.protocol, rpc.PROTOCOL)
    assert.equal(dsh.info.version, rpc.CONTRACT_VERSION)
    assert.equal(dsh.info.acpProtocolVersion, 1)
    assert.deepEqual(dsh.info.interactions, { approvals: true, questions: true })

    // The ACP SDK on the stream, as an editor uses it on stdio.
    const updates: SessionNotification[] = []
    const connection = acpClient({ name: 'rpc-client' })
      .onNotification(methods.client.session.update, ({ params }) => { updates.push(params) })
      .connect(dsh.openAcpStream())
    const initialized = await connection.agent.request(methods.agent.initialize, { protocolVersion: 1, clientCapabilities: {} })
    assert.equal(initialized.protocolVersion, 1)
    const { sessionId } = await connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const response = await connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })
    assert.equal(response.stopReason, 'end_turn')
    const reply = updates.filter(item => item.sessionId === sessionId && item.update.sessionUpdate === 'agent_message_chunk')
      .map(item => (item.update as { content?: { text?: string } }).content?.text ?? '').join('')
    assert.equal(reply, '你好')
    assert.equal((await dsh.fetchInfo()).connections, 1)

    // The raw call: a second ACP connection over the same RPC connection.
    const call = dsh.openAcpCall()
    const output = call[Symbol.asyncIterator]()
    await call.send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } })
    const answer = await output.next()
    assert.equal((answer.value as { id?: unknown } | undefined)?.id, 1)
    assert.equal((await dsh.fetchInfo()).connections, 2)
    await call.closeSend()
    assert.equal((await output.next()).done, true, 'DSH ends the ACP connection once the client sends nothing more')
    await settled(host.acpHome, 1)

    connection.close()
    await settled(host.acpHome, 0)
  } finally {
    await dsh.close()
    await host.close()
  }
})

test('the client refuses an endpoint that cannot prove itself before sending it the token', { timeout: 60_000 }, async () => {
  const rpc = await load()
  const host = await startHost()
  try {
    const [real] = await readRecords(host.acpHome)
    assert.ok(real)
    // A newer record whose endpoint does not hold its token, as after PID reuse or a squatted pipe name.
    await writeRecord(host.acpHome, { ...real.record, instanceId: 'impostor', token: randomBytes(32).toString('base64url'),
      startedAt: new Date(Date.parse(real.record.startedAt) + 60_000).toISOString() })
    assert.deepEqual((await rpc.listInstances({ home: host.acpHome })).map(record => record.instanceId), ['impostor', real.record.instanceId])

    const dsh = await rpc.connectDsh({ home: host.acpHome })
    assert.equal(dsh.record.instanceId, real.record.instanceId, 'the newest instance that proves itself is used')
    await dsh.close()

    const refused = await rpc.connectDsh({ home: host.acpHome, instance: 'imp' }).then(() => undefined, (error: unknown) => error)
    assert.ok(refused instanceof rpc.DshAcpError)
    assert.equal(refused.code, 'unreachable')
    // Had the token gone out, the real endpoint would have refused it in `info`: an RPC error, not a failed proof.
    assert.deepEqual(refused.failures, [{ instanceId: 'impostor', reason: 'unproven' }])

    const missing = await rpc.connectDsh({ home: host.acpHome, instance: 'nothing' }).then(() => undefined, (error: unknown) => error)
    assert.ok(missing instanceof rpc.DshAcpError)
    assert.equal(missing.code, 'no-instance')
  } finally {
    await host.close()
  }
})

test('only running instances of contract version 1 are offered, and a DSH that exits ends the connection at once', { timeout: 60_000 }, async () => {
  const rpc = await load()
  const home = await mkdtemp(join(tmpdir(), 'aa-dsh-acp-home-'))
  const host = await startHost()
  try {
    const [real] = await readRecords(host.acpHome)
    assert.ok(real)
    const record: EndpointRecord = { ...real.record, instanceId: 'later-fields' }
    const endpoints = join(home, 'endpoints')
    await writeRecord(home, record)
    // Fields added later in version 1 are ignored; records of version 2 and of exited processes are skipped.
    await writeFile(join(endpoints, 'later-fields.json'), JSON.stringify({ ...record, addedLater: true }), { mode: 0o600 })
    await writeFile(join(endpoints, 'next-version.json'),
      JSON.stringify({ ...record, instanceId: 'next-version', version: 2, service: 'aa.dsh.acp.v2.Acp' }), { mode: 0o600 })
    // Above Linux's largest process ID and macOS's: no such process can exist.
    await writeRecord(home, { ...record, instanceId: 'exited', pid: 2 ** 22 + 1 })
    assert.deepEqual((await rpc.listInstances({ home })).map(item => item.instanceId), ['later-fields'])

    const dsh = await rpc.connectDsh({ home })
    await host.dispose()
    const started = Date.now()
    await assert.rejects(dsh.fetchInfo())
    assert.ok(Date.now() - started < 4_000, 'the client does not wait for an endpoint that is gone')
    await dsh.close()
    const gone = await rpc.connectDsh({ home: host.acpHome }).then(() => undefined, (error: unknown) => error)
    assert.equal((gone as Client.DshAcpError | undefined)?.code, 'no-instance', 'the unloaded plugin withdrew its record')
  } finally {
    await host.close()
    await rm(home, { recursive: true, force: true })
  }
})

test('the client entry needs only Node.js and meshcall, and the launcher is built on it', async () => {
  const lib = fileURLToPath(new URL('../../lib/', import.meta.url))
  const bare = new Set<string>()
  const seen = new Set<string>()
  const visit = async (file: string): Promise<void> => {
    if (seen.has(file)) return
    seen.add(file)
    const code = await readFile(file, 'utf8')
    for (const match of code.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/gu)) {
      const specifier = match[1]!
      if (specifier.startsWith('.')) await visit(resolve(dirname(file), specifier))
      else bare.add(specifier)
    }
  }
  await visit(join(lib, 'client.js'))
  assert.deepEqual([...bare].filter(specifier => specifier !== 'meshcall' && !specifier.startsWith('node:')), [])
  assert.ok(bare.has('meshcall'))
  assert.match(await readFile(join(lib, 'stdio.js'), 'utf8'), /from "\.\/client\.js"/u, 'launcher tests exercise the public client too')
})

test('application selection reaches the preferred Host even when another app starts later; pinned selection cannot cross apps', { timeout: 60_000 }, async () => {
  const first = await startHost()
  const second = await startHost({ acpHome: first.acpHome })
  const { applicationId } = await import('../../src/applications.js')
  try {
    const records = (await readRecords(first.acpHome)).map(s => s.record)
    const older = records.find(r => r.instanceId !== records[0]!.instanceId)!
    const newer = records[0]!
    const makeApp = (r: EndpointRecord, kind: 'next' | 'beta'): import('../../src/applications.js').Application => ({
      id: applicationId(kind, kind, kind), kind, name: kind, bundleId: kind, version: '1', bridgeVersion: r.bridgeVersion,
      dshHome: `/${kind}`, profileDirectory: `/${kind}/profiles/desktop`, profile: 'desktop', background: true,
      registeredAt: r.startedAt, launcher: r.launcher!,
    })
    const next = makeApp(older, 'next'), beta = makeApp(newer, 'beta')
    await writeRecord(first.acpHome, { ...older, application: next, profileDirectory: next.profileDirectory })
    await writeRecord(first.acpHome, { ...newer, application: beta, profileDirectory: beta.profileDirectory })
    const rpc = await load()
    const connection = await rpc.connectDsh({ home: first.acpHome, application: next })
    assert.equal(connection.record.instanceId, older.instanceId)
    await connection.close()
    await rm((await readRecords(first.acpHome)).find(s => s.record.instanceId === older.instanceId)!.path)
    await assert.rejects(rpc.connectDsh({ home: first.acpHome, application: next, strictApplication: true }), { code: 'no-instance' })
    const fallback = await rpc.connectDsh({ home: first.acpHome, application: next })
    assert.equal(fallback.record.instanceId, newer.instanceId)
    await fallback.close()
  } finally { await second.close(); await first.close() }
})
