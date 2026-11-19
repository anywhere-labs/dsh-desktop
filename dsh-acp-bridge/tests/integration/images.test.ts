/**
 * Image input follows the model, as in the official dsh-acp: clients are told
 * they may send images only when the model new sessions start with declares
 * image input, and an image for a model that declares none is refused before
 * DSH creates, uploads or sends anything. A model that declares nothing is
 * left to DSH, which accepts its images in DSH Desktop too.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { methods, type ContentBlock } from '@agentclientprotocol/sdk'
import { startHost, type Host } from '../fixtures/host.js'
import { connect } from '../fixtures/client.js'

const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
const picture: ContentBlock[] = [{ type: 'text', text: '看看这张图' }, { type: 'image', data: png, mimeType: 'image/png' }]
const report: ContentBlock = { type: 'resource', resource: { uri: 'file:///tmp/report.pdf', mimeType: 'application/pdf',
  blob: Buffer.from('%PDF-1.4 测试文件').toString('base64') } }

/** The request fails as invalid input (JSON-RPC -32602) with a message matching `pattern`. */
async function refused(request: Promise<unknown>, pattern: RegExp): Promise<void> {
  await assert.rejects(request, (error: { code?: unknown, message?: string }) => {
    assert.equal(error.code, -32602, `expected invalid params, got ${String(error.code)}: ${error.message}`)
    assert.match(error.message ?? '', pattern)
    return true
  })
}

function receivedImage(host: Host): boolean {
  const sent = host.adapter.requests.at(-1)?.messages.findLast(message => message.role === 'user'
    && (message as { source?: { kind?: string } }).source?.kind === 'user')
  return (sent?.content as readonly { type: string }[] | undefined)?.some(block => block.type === 'image') ?? false
}

test('clients may send images only when the model new sessions start with takes them', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const advertised = async () => {
    const client = await connect(host.acpHome)
    try { return client.initialized.agentCapabilities?.promptCapabilities?.image } finally { await client.close() }
  }
  try {
    assert.equal(await advertised(), true, 'the default model takes images')
    host.adapter.modalities.set('text', ['text'])
    host.adapter.modalities.set('thinking', ['text', 'image'])
    assert.equal(await advertised(), false, 'the default model takes text only, whatever other models take')
    host.adapter.modalities.delete('text')
    assert.equal(await advertised(), false, 'a model that declares nothing is not promised images')
  } finally {
    await host.close()
  }
})

test('an image for a model without image input is refused before DSH creates the session or uploads a file', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: 'test/thinking' })
    await refused(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [...picture, report] }),
      /thinking.*不支持图片/u)
    assert.equal(host.ctx.agents.get(sessionId as never), undefined, 'DSH created no session')
    assert.equal((await host.ctx.sessionController.list({}, new AbortController().signal)).items.length, 0)

    // With a model that takes images, the same message goes through.
    await client.connection.agent.request(methods.agent.session.setConfigOption, { sessionId, configId: 'model', value: 'test/text' })
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [...picture, report] })
    assert.equal(response.stopReason, 'end_turn')
    assert.ok(receivedImage(host), 'the model received the image')
  } finally {
    await client.close()
    await host.close()
  }
})

test('a session switched to a model without image input refuses images; one that declares nothing is left to DSH', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [{ type: 'text', text: '打个招呼' }] })

    // DSH Desktop switches the session to a model that takes text only.
    await host.ctx.sessionController.selectModel({ sessionId: sessionId as never, provider: 'test', model: 'thinking' })
    const requests = host.adapter.requests.length
    await refused(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: picture }), /thinking.*不支持图片/u)
    assert.equal(host.adapter.requests.length, requests, 'nothing reached the model')

    host.adapter.modalities.delete('thinking')
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: picture })
    assert.equal(response.stopReason, 'end_turn')
    assert.ok(receivedImage(host), 'DSH accepted the image, as it does in DSH Desktop')
  } finally {
    await client.close()
    await host.close()
  }
})

test('an image DSH itself refuses is reported as invalid input', { timeout: 60_000 }, async () => {
  const host = await startHost()
  const client = await connect(host.acpHome)
  try {
    const { sessionId } = await client.connection.agent.request(methods.agent.session.new, { cwd: host.workspace, mcpServers: [] })
    const broken = Buffer.from('这不是一张图片').toString('base64')
    await refused(client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: [
      { type: 'text', text: '看看这张图' }, { type: 'image', data: broken, mimeType: 'image/png' }] }), /./u)
    const response = await client.connection.agent.request(methods.agent.session.prompt, { sessionId, prompt: picture })
    assert.equal(response.stopReason, 'end_turn', 'the session keeps working')
  } finally {
    await client.close()
    await host.close()
  }
})
