#!/usr/bin/env node
/**
 * TinTin 注册表 MCP 桥(stdio MCP server)。
 *
 * 把 TinTin 服务端的能力注册表(GET /agent/registry, 39 能力)翻译成 MCP 工具:
 *   - 启动时拉取注册表(每 60s 刷新), 每个能力映射为一个工具
 *     (name=id, description=name+description, inputSchema 由 input_schema 推导);
 *   - tools/call 按注册表的 method+path 执行 HTTP(POST=JSON body, GET=query),
 *     结果以 text content 返回。
 *
 * 用法: node registry-bridge.mjs <serverBaseUrl>
 * 协议: MCP JSON-RPC 2.0 over stdio(逐行 JSON)。
 * 实现: TinTin(2026-10-25 用户裁决: 服务端能力经 MCP 接入客户端智能体编排)。
 */
import { readFileSync } from 'node:fs'

const serverBase = (process.argv[2] ?? process.env.TINTIN_SERVER_URL ?? '').replace(/\/+$/, '')
const REFRESH_MS = 60_000
const HTTP_TIMEOUT_MS = 300_000

let registry = { fetchedAt: 0, capabilities: [] }

const httpJson = async (url, options = {}) => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...options, signal: controller.signal })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

const refreshRegistry = async (force = false) => {
  if (!force && registry.capabilities.length && Date.now() - registry.fetchedAt < REFRESH_MS) return
  const { status, body } = await httpJson(`${serverBase}/agent/registry`)
  if (status !== 200 || !Array.isArray(body?.capabilities)) throw new Error(`注册表拉取失败 HTTP ${status}`)
  registry = { fetchedAt: Date.now(), capabilities: body.capabilities }
}

/** 注册表的描述性 input_schema(值为人类提示) → MCP JSON Schema(宽松: 全部 string, 带 ? 的可省). */
const inputSchemaOf = (capability) => {
  const properties = {}
  const required = []
  for (const [key, hint] of Object.entries(capability.input_schema ?? {})) {
    const optional = typeof hint === 'string' && hint.includes('?')
    const arrayLike = typeof hint === 'string' && hint.trim().startsWith('[')
    properties[key] = { type: arrayLike ? 'array' : 'string', description: String(hint) }
    if (!optional) required.push(key)
  }
  return { type: 'object', properties, required }
}

const toolsOf = () => registry.capabilities.map((capability) => ({
  name: String(capability.id),
  description: `[${String(capability.name ?? '')}] ${String(capability.description ?? '')}`.trim(),
  inputSchema: inputSchemaOf(capability),
}))

const execute = async (capability, args) => {
  const method = String(capability.method ?? 'POST').toUpperCase()
  const path = String(capability.path ?? capability.api ?? '').replace(/^\w+\s+/, '')
  const url = new URL(serverBase + (path.startsWith('/') ? path : '/' + path))
  const init = { method, headers: {} }
  if (method === 'GET') {
    for (const [key, value] of Object.entries(args ?? {})) {
      url.searchParams.set(key, Array.isArray(value) ? JSON.stringify(value) : String(value))
    }
  } else {
    init.headers['content-type'] = 'application/json'
    init.body = JSON.stringify(args ?? {})
  }
  const { status, body } = await httpJson(url, init)
  return { status, body }
}

const toolsCall = async (params) => {
  const name = String(params?.name ?? '')
  const capability = registry.capabilities.find((c) => String(c.id) === name)
  if (!capability) {
    return { content: [{ type: 'text', text: `未知能力: ${name}` }], isError: true }
  }
  try {
    const { status, body } = await execute(capability, params?.arguments)
    const text = typeof body === 'string' ? body : JSON.stringify(body, null, 2)
    return { content: [{ type: 'text', text: `HTTP ${status}\n${text}` }], isError: status >= 400 }
  } catch (error) {
    return { content: [{ type: 'text', text: `调用失败: ${error instanceof Error ? error.message : String(error)}` }], isError: true }
  }
}

const reply = (id, result) => {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`)
}

let buffer = ''
const handle = async (message) => {
  const { id, method, params } = message
  switch (method) {
    case 'initialize':
      reply(id, {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'tintin-registry-bridge', version: '1.0.0' },
      })
      return
    case 'notifications/initialized':
    case 'notifications/cancelled':
      return
    case 'ping':
      reply(id, {})
      return
    case 'tools/list':
      await refreshRegistry()
      reply(id, { tools: toolsOf() })
      return
    case 'tools/call':
      await refreshRegistry()
      reply(id, await toolsCall(params))
      return
    default:
      if (id !== undefined) reply(id, {})
  }
}

process.stdin.setEncoding('utf8')
process.stdin.on('data', (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf('\n')) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let message
    try { message = JSON.parse(line) } catch { continue }
    void handle(message).catch((error) => {
      if (message?.id !== undefined) {
        reply(message.id, { content: [{ type: 'text', text: String(error) }], isError: true })
      }
    })
  }
})

if (!serverBase) {
  process.stderr.write('用法: registry-bridge.mjs <serverBaseUrl>\n')
  process.exit(2)
}
await refreshRegistry(true).catch((error) => {
  process.stderr.write(`启动拉取注册表失败: ${error instanceof Error ? error.message : String(error)}\n`)
})
process.stderr.write(`tintin-registry-bridge: ${registry.capabilities.length} capabilities from ${serverBase}\n`)
