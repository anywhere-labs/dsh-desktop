import assert from 'node:assert/strict'
import test from 'node:test'
import * as McpClient from '@deepseek-ai/dsh-mcp-client'
import { McpConfigError, resolveDeclarations } from '../../src/acp/mcp.js'

const stdio = (name: string, extra: object = {}) => ({ name, command: '/usr/bin/files-mcp', args: ['--root', '.'], env: [], ...extra })
const config = (servers: unknown[]) => resolveDeclarations(McpClient, servers, '/work').map(item => ({ name: item.name, config: item.config as unknown as Record<string, unknown> }))

test('declarations keep the standard stdio and HTTP fields and normalize names like the official dsh-acp', () => {
  const [files, docs, odd] = config([
    stdio('files', { env: [{ name: 'B', value: '2' }, { name: 'A', value: '1' }] }),
    { type: 'http', name: 'docs', url: 'https://example.com/mcp', headers: [{ name: 'Authorization', value: 'Bearer x' }] },
    stdio('我的 服务器!'),
  ])
  assert.equal(files?.name, 'files')
  assert.deepEqual([files?.config.transport, files?.config.serverName, files?.config.command, files?.config.args, files?.config.cwd, files?.config.failOnStartupError],
    ['stdio', 'files', '/usr/bin/files-mcp', ['--root', '.'], '/work', true], 'stdio servers run in the session\'s directory and must start')
  assert.deepEqual({ ...files?.config.env as object }, { A: '1', B: '2' })
  assert.deepEqual([docs?.config.transport, docs?.config.url, { ...docs?.config.headers as object }, docs?.config.failOnStartupError],
    ['streamable-http', 'https://example.com/mcp', { Authorization: 'Bearer x' }, true])
  assert.match(odd?.name ?? '', /^[A-Za-z0-9_-]{1,32}$/u, 'a name that is not a tool namespace gets a stable one')
  assert.equal(odd?.name, config([stdio('我的 服务器!')])[0]?.name)
  assert.notEqual(odd?.name, config([stdio('我的 服务器?')])[0]?.name, 'different names stay apart')
})

test('a declaration describes the same server whatever the order of its entries', () => {
  const [one] = resolveDeclarations(McpClient, [stdio('files', { env: [{ name: 'A', value: '1' }, { name: 'B', value: '2' }] })], '/work')
  const [two] = resolveDeclarations(McpClient, [stdio('files', { env: [{ name: 'B', value: '2' }, { name: 'A', value: '1' }] })], '/work')
  const [other] = resolveDeclarations(McpClient, [stdio('files', { env: [{ name: 'A', value: '9' }] })], '/work')
  assert.equal(one?.fingerprint, two?.fingerprint)
  assert.notEqual(one?.fingerprint, other?.fingerprint)
})

test('declarations that cannot work are refused with the reason', () => {
  const refused = (servers: unknown[], pattern: RegExp) => assert.throws(() => resolveDeclarations(McpClient, servers, '/work'),
    (error: unknown) => error instanceof McpConfigError && pattern.test(error.message))
  refused([stdio('x', { command: 'node' })], /绝对路径/u)
  refused([stdio('x'), stdio('x')], /重名/u)
  refused([stdio('  ')], /名称/u)
  refused([stdio('x', { env: [{ name: 'A=B', value: '1' }] })], /环境变量/u)
  refused([stdio('x', { env: [{ name: 'A', value: '1' }, { name: 'A', value: '2' }] })], /环境变量/u)
  refused([{ type: 'sse', name: 's', url: 'https://example.com/sse', headers: [] }], /sse/u)
  refused([{ type: 'http', name: 'h', url: 'ftp://example.com/mcp', headers: [] }], /HTTP/u)
  refused([{ type: 'http', name: 'h', url: 'https://example.com/mcp', headers: [{ name: 'bad header', value: 'x' }] }], /请求头/u)
  refused([{ type: 'http', name: 'h', url: 'https://example.com/mcp', headers: [{ name: 'X-A', value: '1' }, { name: 'x-a', value: '2' }] }], /请求头/u)
  refused(['not a server'], /mcpServers\[0\]/u)
})

test('entry names that collide with Object prototype setters stay data', () => {
  const [server] = config([stdio('x', { env: [{ name: '__proto__', value: 'kept' }] })])
  assert.equal(Object.getOwnPropertyDescriptor(server?.config.env as object, '__proto__')?.value, 'kept')
})
