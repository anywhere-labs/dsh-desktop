import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFile } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { access, cp, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { test } from 'node:test'
import { promisify, stripVTControlCharacters } from 'node:util'
import { runInNewContext } from 'node:vm'
import { AA_WORKSPACES } from './agents-anywhere-release-policy.mjs'

// Exercise the installed upstream artifact used by every Desktop channel.
function loadConnector(workspace, environment) {
  const source = readFileSync(new URL(`../${workspace}/node_modules/@agents-anywhere/dsh-bridge-next/lib/index.js`, import.meta.url), 'utf8')
  const start = source.indexOf('\n// src/host/connector/logs.ts\n')
  const end = source.indexOf('\n// src/host/desktop/process.ts\n', start)
  assert.ok(start >= 0 && end > start)
  return runInNewContext(`${source.slice(start, end)}; SourceConnector`, {
    execFile, promisify, stripVTControlCharacters, dirname, join, relative, createHash, setTimeout, clearTimeout,
    access, cp, mkdtemp, readFile, readdir, rename, rm,
    process: { platform: process.platform, env: environment },
    readJson$1: async () => [], writeJson: async () => {}, mkdir,
    resolveUv: async () => 'uv',
    DEFAULT_CONNECTOR_SETTINGS: { syncIntervalSeconds: 30 },
  })
}

for (const workspace of AA_WORKSPACES) {
  test(`${workspace}: rc.2 tool results retain the same hash after JSON transport`, () => {
    const source = readFileSync(new URL(`../${workspace}/node_modules/@agents-anywhere/dsh-bridge-next/lib/index.js`, import.meta.url), 'utf8')
    const region = name => {
      const marker = `\n// src/host/dsh-runtime/${name}.ts\n`
      const start = source.indexOf(marker)
      const end = source.indexOf('\n// src/', start + marker.length)
      assert.ok(start >= 0 && end > start)
      return source.slice(start, end)
    }
    const { createProjection, contentHash } = runInNewContext(
      // types carries the JSON helpers history applies before hashing, including lone-surrogate normalization.
      ['types', 'identity', 'tools', 'history'].map(region).join('\n') + ';({ createProjection, contentHash })',
      { createHash, Buffer },
    )
    const projection = createProjection('native-session', 'platform-session')
    projection.apply({ type: 'tool/result', seq: 0, time: '2026-09-24T00:00:00Z',
      data: { message: { role: 'tool', toolCallId: 'call-1', content: [] }, meta: {} } })
    const item = JSON.parse(JSON.stringify(projection.snapshot()[0]))
    // Python json.dumps(..., sort_keys=True, separators=(',', ':')) for this payload.
    const canonical = '{"content":{"callId":"call-1","dshResultMeta":{},"input":{},"isError":false,"kind":"tool_call","output":"","result":[],"title":"tool","toolName":"tool"},"role":"assistant","status":"done","type":"tool"}'
    assert.equal(item.contentHash, `sha256:${createHash('sha256').update(canonical).digest('hex')}`)
    assert.equal(item.content.callId, 'call-1')
    // Optional fields omitted by JSON must not change the hash sent to Python.
    assert.equal(contentHash({ ...item, content: { ...item.content, optional: undefined } }), item.contentHash)
    // A lone surrogate an old plugin sends is normalized before the hash Python recomputes from UTF-8.
    projection.apply({ type: 'tool/result', seq: 1, time: '2026-09-24T00:00:01Z',
      data: { message: { role: 'tool', toolCallId: 'call-2', content: [{ type: 'text', text: 'ok\uD800' }] }, meta: {} } })
    const normalized = JSON.parse(JSON.stringify(projection.snapshot().find(entry => entry.content.callId === 'call-2')))
    assert.equal(normalized.content.output, 'ok\uFFFD')
    assert.equal(normalized.content.result[0].text, 'ok\uFFFD')
    assert.equal(normalized.contentHash, contentHash(normalized))
    assert.throws(() => projection.apply({ type: 'tool/result', seq: 2, time: '2026-09-24T00:00:02Z',
      data: { message: { content: [{}] }, meta: {} } }), /Invalid DSH tool result message/)
  })

  test(`${workspace}: Python gets a compatible bypass list and a writable project copy`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-aa-connector-'))
    t.after(() => rm(root, { recursive: true, force: true }))
    const source = join(root, 'package', 'connector-source')
    const stateRoot = join(root, 'state')
    await mkdir(join(source, 'connector'), { recursive: true })
    await writeFile(join(source, 'pyproject.toml'), '[project]\nname = "fixture"\n')
    await writeFile(join(source, 'connector', 'cli.py'), '# fixture\n')
    const env = {
      NO_PROXY: 'localhost,127.0.0.1,::1,[::1],.example.com',
      no_proxy: 'internal.test, [::1] ',
      HTTPS_PROXY: 'http://127.0.0.1:7890',
    }
    const original = { ...env }
    const Connector = loadConnector(workspace, env)
    // Stop at the launch boundary: control now uses Mesh, not stdin JSON-RPC.
    const launchCaptured = new Error('launch captured')
    let launched, launchedArgs
    const connector = new Connector({ stateRoot, connectorSourceDir: source, uvPath: 'uv' },
      (_command, args, options) => { launched = options; launchedArgs = args; throw launchCaptured },
      undefined, undefined, undefined, { log() {} }, {})
    await assert.rejects(connector.start({ connectorId: 'device', connectorToken: 'private-test-token' }, 'https://example.com', new AbortController().signal),
      error => error === launchCaptured)
    assert.equal(launched.env.NO_PROXY, 'localhost,127.0.0.1,::1,::1,.example.com')
    assert.equal(launched.env.no_proxy, 'internal.test, ::1 ')
    assert.equal(launched.env.HTTPS_PROXY, env.HTTPS_PROXY)
    assert.deepEqual(env, original)
    assert.ok(launched.cwd.startsWith(join(stateRoot, 'connector-source') + sep))
    assert.equal(launchedArgs[launchedArgs.indexOf('--directory') + 1], launched.cwd)
    assert.deepEqual(Array.from(launchedArgs.slice(3, 5)), ['anywhere-cli', 'rpc'])
    assert.equal(await readFile(join(launched.cwd, 'connector', 'cli.py'), 'utf8'), '# fixture\n')
    await writeFile(join(launched.cwd, 'uv.lock'), 'fixture lock\n')
    await assert.rejects(access(join(source, 'uv.lock')), { code: 'ENOENT' })
    await connector.logs.flush()
  })

  test(`${workspace}: Connector output retains errors and redacts credentials`, async t => {
    const stateRoot = await mkdtemp(join(tmpdir(), 'dsh-aa-logs-'))
    t.after(() => rm(stateRoot, { recursive: true, force: true }))
    const Connector = loadConnector(workspace, {})
    const connector = new Connector({ stateRoot }, () => {}, undefined, undefined, undefined, { log() {} }, {})
    await connector.logs.startSession(['private-test-token'])
    const output = "ERROR: Invalid port: ':1]' private-test-token\nInvalidURL private-test-token\n"
    connector.logs.output(output.slice(0, 31))
    connector.logs.output(output.slice(31))
    await connector.logs.flush()
    const lines = Array.from(connector.logs.entries, entry => entry.text)
    assert.deepEqual(lines, ["ERROR: Invalid port: ':1]' [REDACTED]", 'InvalidURL [REDACTED]'])
  })
}
