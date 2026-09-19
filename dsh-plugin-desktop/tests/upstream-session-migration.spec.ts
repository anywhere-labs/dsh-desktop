/** Exercise the shipped JSONL worker and native lock after retiring Desktop's preset alias. */
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'

it('migrates a released code session through the installed V3 worker and preserves its V2 log', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-v3-migration-'))
  const id = SessionId('desktop-code-session')
  const directory = join(root, '_no-cwd', id)
  const ctx = new Context()
  const call = { type: 'tool-call', id: 'root-call', name: 'run_code', arguments: '{"code":"return 1"}' }
  const dispatch = { rootCallId: call.id, parentCallId: call.id, subCallId: 'child-call', name: 'read_file', arguments: { path: 'code.txt' } }
  const text = [{ type: 'text', text: 'Keep code and tool/code-dispatch as literal text.' }]
  const rows = [
    { type: 'agent-preset/selected', data: { agentPreset: 'code' }, ignorable: true },
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'user/message', surfaceOp: 'append', data: { id: 'user', role: 'user', source: { kind: 'user' }, content: text } },
    { type: 'assistant/message', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
      id: 'assistant', role: 'assistant', content: [call], source: { kind: 'model', provider: 'historical', model: 'historical' },
    }, stream: [] } },
    { type: 'tool/call', data: { turn: 1, step: 1, callId: call.id, name: call.name, arguments: call.arguments } },
    { type: 'tool/code-dispatch-start', data: dispatch },
    { type: 'tool/code-dispatch', data: { ...dispatch, isError: false, content: text } },
    { type: 'tool/result', surfaceOp: 'append', data: { turn: 1, step: 1, message: {
      id: 'result', role: 'user', source: { kind: 'tool', callId: call.id },
      content: [{ type: 'tool-result', toolCallId: call.id, isError: false, content: text }],
    } } },
    { type: 'step/end', data: { turn: 1, step: 1 } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } },
  ].map((row, seq) => ({ ...row, seq, time: 1000 + seq }))
  const source = [
    { type: 'session', version: 2, id, createdAt: 1, isSeeded: false, delegationDepth: 0, agentPreset: 'code' },
    ...rows,
  ].map(row => JSON.stringify(row)).join('\n') + '\n'
  try {
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'session.v2.jsonl'), source)
    await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
    const handle = await ctx.sessionPersistence.open(id, 'write')
    try {
      expect(handle.header).toMatchObject({ version: 3, agentPreset: 'ptc' })
      const restored = await handle.read()
      expect(restored.events.map(event => event.type)).toEqual(expect.arrayContaining([
        'tool/ptc-dispatch-start', 'tool/ptc-dispatch', 'system/message',
      ]))
      expect(restored.events).toContainEqual(expect.objectContaining({ type: 'agent-preset/selected', data: { agentPreset: 'ptc' } }))
      expect(restored.events.find(event => event.type === 'user/message')?.data).toMatchObject({ content: text })
    } finally {
      await handle.close()
    }
    await ctx.sessionPersistence.flush()
    expect(await readFile(join(directory, 'session.v2.jsonl'), 'utf8')).toBe(source)
    const published = await readFile(join(directory, 'session.v3.jsonl'), 'utf8')
    expect(JSON.parse(published.split('\n')[0]!)).toMatchObject({ version: 3, agentPreset: 'ptc' })
    const reloaded = await ctx.sessionPersistence.open(id, 'read')
    try { expect(reloaded.header.agentPreset).toBe('ptc') } finally { await reloaded.close() }
  } finally {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  }
}, 30_000)
