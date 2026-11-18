// A minimal MCP server over stdio for tests, without the MCP SDK: one `echo` tool that answers
// `<ECHO_PREFIX>: <text>`. With MCP_EVENTS set, it appends `ready <prefix> <pid>` once a client
// completes the `initialize` handshake and `exit <prefix> <pid>` when that connection's input ends
// or the process is terminated, so a test can count connections. A client that first tries a newer
// protocol (`server/discover`) gets "method not found" and starts the server again for the
// classic handshake; such a process records nothing.
import { appendFileSync } from 'node:fs'
import { createInterface } from 'node:readline'

const prefix = process.env.ECHO_PREFIX ?? 'echo'
const note = event => { if (process.env.MCP_EVENTS) appendFileSync(process.env.MCP_EVENTS, `${event} ${prefix} ${process.pid}\n`) }
const send = message => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`)
let ready = false
let ended = false
const end = () => {
  if (ended) return
  ended = true
  if (ready) note('exit')
  process.exit(0)
}

createInterface({ input: process.stdin }).on('line', line => {
  const message = JSON.parse(line)
  if (message.id === undefined) return
  if (message.method === 'initialize') {
    ready = true
    note('ready')
    send({ id: message.id, result: { protocolVersion: message.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'echo', version: '1.0.0' } } })
  } else if (message.method === 'tools/list') {
    send({ id: message.id, result: { tools: [{ name: 'echo', description: 'Echo the text back.',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } }] } })
  } else if (message.method === 'tools/call') {
    send({ id: message.id, result: { content: [{ type: 'text', text: `${prefix}: ${message.params.arguments?.text ?? ''}` }] } })
  } else if (message.method === 'ping') {
    send({ id: message.id, result: {} })
  } else {
    send({ id: message.id, error: { code: -32601, message: `Method not found: ${message.method}` } })
  }
}).on('close', end)
process.on('SIGTERM', end)
