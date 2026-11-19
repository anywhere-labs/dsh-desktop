import assert from 'node:assert/strict'
import test from 'node:test'
import { execFile as execFileCallback, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import { MeshCallClient } from 'meshcall'
import { readRecords, writeRecord, type EndpointRecord } from '../../src/endpoint.js'
import { launcherPath, RPC_SERVICE, TOKEN_METADATA } from '../../src/paths.js'
import { startHost } from '../fixtures/host.js'
import { stdioScript } from '../fixtures/client.js'

const execFile = promisify(execFileCallback)

test('the endpoint answers only with its token, and the stdio helpers find the running DSH', { timeout: 60_000 }, async () => {
  const host = await startHost()
  try {
    const [stored] = await readRecords(host.acpHome)
    assert.ok(stored, 'the plugin published an endpoint record')
    assert.equal(stored.record.pid, process.pid)
    if (process.platform !== 'win32') {
      assert.equal((await stat(stored.path)).mode & 0o777, 0o600, 'only the owner can read the token')
      assert.ok('unixPath' in stored.record.endpoint)
      assert.equal((await stat(stored.record.endpoint.unixPath)).mode & 0o077, 0, 'other users cannot open the socket')
    }
    const client = new MeshCallClient(stored.record.endpoint, undefined, { retry: false })
    try {
      await assert.rejects(client.unary(RPC_SERVICE, 'info', {}, {}), /token/u)
      await assert.rejects(client.unary(RPC_SERVICE, 'info', {}, { metadata: { [TOKEN_METADATA]: 'x'.repeat(43) } }), /token/u)
      const info = await client.unary<object, { bridgeVersion: string, acpProtocolVersion: number }>(RPC_SERVICE, 'info', {},
        { metadata: { [TOKEN_METADATA]: stored.record.token } })
      assert.equal(info.acpProtocolVersion, 1)
    } finally { await client.close() }

    const listed = await execFile(process.execPath, [stdioScript, '--home', host.acpHome, '--list'])
    assert.match(listed.stdout, new RegExp(stored.record.instanceId, 'u'))
    const checked = JSON.parse((await execFile(process.execPath, [stdioScript, '--home', host.acpHome, '--check'])).stdout) as Record<string, unknown>
    assert.equal(checked.instanceId, stored.record.instanceId)
    assert.deepEqual(checked.interactions, { approvals: true, questions: true })
    if (process.platform !== 'win32') {
      const launched = JSON.parse((await execFile(launcherPath(host.acpHome), ['--home', host.acpHome, '--check'])).stdout) as Record<string, unknown>
      assert.equal(launched.instanceId, stored.record.instanceId, 'the generated launcher runs the bridge with this DSH runtime')
    }

    await host.dispose()
    assert.deepEqual(await readRecords(host.acpHome), [], 'unloading the plugin withdraws the endpoint')
  } finally {
    await host.close()
  }
})

test('the launcher skips an endpoint that cannot prove it wrote the record', { timeout: 60_000 }, async () => {
  const host = await startHost()
  try {
    const [real] = await readRecords(host.acpHome)
    assert.ok(real)
    // A newer record whose endpoint does not hold its token, as after PID reuse or a squatted pipe name.
    await writeRecord(host.acpHome, { ...real.record, instanceId: 'impostor', token: randomBytes(32).toString('base64url'),
      startedAt: new Date(Date.parse(real.record.startedAt) + 60_000).toISOString() })
    const checked = JSON.parse((await execFile(process.execPath, [stdioScript, '--home', host.acpHome, '--check'])).stdout) as Record<string, unknown>
    assert.equal(checked.instanceId, real.record.instanceId, 'the newest record that proves itself is used')
    const refused = await execFile(process.execPath, [stdioScript, '--home', host.acpHome, '--instance', 'impostor', '--check'])
      .then(() => undefined, (error: { code?: number, stderr?: string }) => error)
    assert.equal(refused?.code, 1)
    assert.match(refused?.stderr ?? '', /无法证明身份/u)
  } finally {
    await host.close()
  }
})

test('a home too long for a socket path serves from a private temporary directory', { timeout: 60_000, skip: process.platform === 'win32' }, async () => {
  const host = await startHost({ homeName: 'h'.repeat(110) })
  try {
    const [stored] = await readRecords(host.acpHome)
    assert.ok(stored && 'unixPath' in stored.record.endpoint)
    const directory = dirname(stored.record.endpoint.unixPath)
    assert.equal(dirname(directory), tmpdir())
    assert.match(basename(directory), /^aa-dsh-acp-/u)
    assert.equal((await stat(directory)).mode & 0o777, 0o700, 'a fresh directory only this user can enter')
    const checked = JSON.parse((await execFile(process.execPath, [stdioScript, '--home', host.acpHome, '--check'])).stdout) as Record<string, unknown>
    assert.equal(checked.instanceId, stored.record.instanceId)
    await host.dispose()
    await assert.rejects(stat(directory), { code: 'ENOENT' }, 'unloading removes the temporary directory')
  } finally {
    await host.close()
  }
})

async function exitedPid(): Promise<number> {
  const child = spawn(process.execPath, ['-e', ''])
  await new Promise(resolve => child.once('exit', resolve))
  return child.pid!
}

function staleRecord(home: string, pid: number): EndpointRecord {
  return { version: 1, protocol: 'meshcall', service: RPC_SERVICE, instanceId: 'stale-instance', pid,
    startedAt: new Date().toISOString(), endpoint: { unixPath: join(home, 'sockets', 'stale.sock') }, token: 't'.repeat(43), bridgeVersion: '0.0.0' }
}

test('without a running DSH the launcher fails clearly and never offers exited processes', { timeout: 60_000 }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'aa-dsh-acp-home-'))
  try {
    const failed = await execFile(process.execPath, [stdioScript, '--home', home]).then(() => undefined, (error: { code?: number, stderr?: string }) => error)
    assert.equal(failed?.code, 1)
    assert.match(failed?.stderr ?? '', /没有找到正在运行的 DSH/u)
    await writeRecord(home, staleRecord(home, await exitedPid()))
    const listed = await execFile(process.execPath, [stdioScript, '--home', home, '--list'])
    assert.match(listed.stdout, /没有正在运行的 DSH 实例/u)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('a starting plugin removes records left by DSH processes that exited', { timeout: 60_000 }, async () => {
  const pid = await exitedPid()
  const host = await startHost({ prepare: async acpHome => { await writeRecord(acpHome, staleRecord(acpHome, pid)) } })
  try {
    const records = await readRecords(host.acpHome)
    assert.deepEqual(records.map(item => item.record.pid), [process.pid], 'only the live instance remains')
  } finally {
    await host.close()
  }
})
