import { expect, it } from 'vitest'
import { isOperationEvidence, isOperationRunId, parseOperationRecord, parsePluginCommandRecord } from '../../src/upstream-family/operation-record.ts'

const runId = 'c254ab28-97c9-4382-95e6-2db9c66f98c8'
const started = { id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca', time: '2026-10-19T00:00:01.000Z', action: 'add', target: 'dsh-foo', version: '1.2.3', phase: 'started' }

it('keeps only the whitelisted fields of a plugin command record', () => {
  expect(parsePluginCommandRecord({ runId, transportDropped: 2, pluginCommand: { ...started, argv: ['add', 'secret'] }, stderr: 'secret' }))
    .toEqual({ runId, transportDropped: 2, pluginCommand: started })
  const settled = { ...started, phase: 'settled', exitCode: null, signal: 'SIGKILL' }
  expect(parsePluginCommandRecord({ runId, transportDropped: 0, pluginCommand: settled })).toEqual({ runId, transportDropped: 0, pluginCommand: settled })
  expect(parsePluginCommandRecord({ runId, transportDropped: 0, pluginCommand: { ...started, target: null, version: undefined, phase: 'unknown' } }))
    .toEqual({ runId, transportDropped: 0, pluginCommand: { id: started.id, time: started.time, action: 'add', target: null, phase: 'unknown' } })
})

it.each([
  ['a run identity that is not a UUID', { runId: 'run-1', transportDropped: 0, pluginCommand: started }],
  ['a negative omission count', { runId, transportDropped: -1, pluginCommand: started }],
  ['an unknown action', { runId, transportDropped: 0, pluginCommand: { ...started, action: 'publish' } }],
  ['an unknown phase', { runId, transportDropped: 0, pluginCommand: { ...started, phase: 'retrying' } }],
  ['a local time', { runId, transportDropped: 0, pluginCommand: { ...started, time: '2026-10-19 08:00:01' } }],
  ['an oversized target', { runId, transportDropped: 0, pluginCommand: { ...started, target: 'x'.repeat(257) } }],
  ['a settled command without an exit code', { runId, transportDropped: 0, pluginCommand: { ...started, phase: 'settled' } }],
  ['a fractional exit code', { runId, transportDropped: 0, pluginCommand: { ...started, phase: 'settled', exitCode: 0.5 } }],
  ['an arbitrary signal text', { runId, transportDropped: 0, pluginCommand: { ...started, phase: 'settled', exitCode: null, signal: 'terminated by user' } }],
])('rejects %s', (_case, value) => {
  expect(parsePluginCommandRecord(value)).toBeUndefined()
  expect(parseOperationRecord(value)).toBeUndefined()
})

it('reads plugin manager records through their own whitelist', () => {
  const operation = { id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9', time: '2026-10-19T00:00:00.000Z', reason: 'remove', phase: 'started', target: 'dsh-foo', stage: 'remove' }
  expect(parseOperationRecord({ runId, transportDropped: 0, operation: { ...operation, diagnostic: 'secret' } })).toEqual({ runId, transportDropped: 0, operation })
  expect(parseOperationRecord({ runId, transportDropped: 0, pluginCommand: started })).toEqual({ runId, transportDropped: 0, pluginCommand: started })
  expect(parseOperationRecord({ runId, transportDropped: 0 })).toBeUndefined()
})

it('recognises the run identity the Host announces', () => {
  expect(isOperationRunId(runId)).toBe(true)
  expect(isOperationRunId(runId.toUpperCase())).toBe(true)
  expect(isOperationRunId(`${runId}0`)).toBe(false)
  expect(isOperationRunId(42)).toBe(false)
})

it('recognises operation evidence among Host messages without checking record content', () => {
  expect(isOperationEvidence({ type: 'starting', runId })).toBe(true)
  expect(isOperationEvidence({ type: 'plugin-operation', record: 'malformed' })).toBe(true)
  expect(isOperationEvidence({ type: 'plugin-operation' })).toBe(true)
  expect(isOperationEvidence({ type: 'starting' })).toBe(false)
  expect(isOperationEvidence({ type: 'starting', runId: 'run-1' })).toBe(false)
  expect(isOperationEvidence({ type: 'ready', url: 'http://127.0.0.1:1/' })).toBe(false)
  expect(isOperationEvidence([{ type: 'starting', runId }])).toBe(false)
  expect(isOperationEvidence('plugin-operation')).toBe(false)
})
