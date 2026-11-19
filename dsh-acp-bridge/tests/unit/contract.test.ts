/**
 * The local RPC contract, version 1. These values are what every client of
 * this version relies on: changing one is a breaking change, which takes the
 * next contract version (see src/contract.ts), not an edit here.
 */

import assert from 'node:assert/strict'
import test from 'node:test'
import { CONTRACT_VERSION, parseInfo, PROTOCOL, RPC_SERVICE, TOKEN_METADATA } from '../../src/contract.js'
import { endpointProof, parseRecord } from '../../src/endpoint.js'

test('contract version 1 identifiers and the endpoint proof stay fixed', () => {
  assert.deepEqual({ CONTRACT_VERSION, PROTOCOL, RPC_SERVICE, TOKEN_METADATA },
    { CONTRACT_VERSION: 1, PROTOCOL: 'agents-anywhere-dsh-acp', RPC_SERVICE: 'aa.dsh.acp.v1.Acp', TOKEN_METADATA: 'aa-acp-token' })
  // HMAC-SHA256 of `agents-anywhere-dsh-acp/1 endpoint <nonce>` keyed with the token, in base64url.
  assert.equal(endpointProof('t'.repeat(43), 'n'.repeat(16)), 'xNOF_3M69-41pPOzTyQEWCQQuVgOZ1x-VrmnQZOPSw4')
})

test('version 1 records and info accept later additions and refuse other versions', () => {
  const record = { version: 1, protocol: 'meshcall', service: RPC_SERVICE, instanceId: 'abc', pid: 42, startedAt: '2026-11-18T00:00:00.000Z',
    endpoint: { unixPath: '/h/s.sock' }, token: 't'.repeat(43), bridgeVersion: '1.0.0' }
  assert.equal(parseRecord(JSON.stringify({ ...record, addedLater: { any: 'value' } }))?.instanceId, 'abc', 'unknown record fields are ignored')
  assert.equal(parseRecord(JSON.stringify({ ...record, version: 2, service: 'aa.dsh.acp.v2.Acp' })), undefined, 'a record of the next version is skipped')
  assert.equal(parseRecord(JSON.stringify({ ...record, version: 2 })), undefined)

  const info = { protocol: PROTOCOL, version: 1, acpProtocolVersion: 1, bridgeVersion: '1.0.0', runtimeVersion: '0.2.2-rc.4',
    pid: 42, connections: 0, followed: 0, interactions: { approvals: true, questions: false } }
  assert.deepEqual(parseInfo(info), info)
  assert.equal((parseInfo({ ...info, addedLater: 1 }) as Record<string, unknown> | undefined)?.addedLater, 1, 'fields added later pass through')
  const { runtimeVersion: _runtimeVersion, ...withoutRuntime } = info
  assert.deepEqual(parseInfo(withoutRuntime), withoutRuntime, 'the runtime version is optional')
  assert.equal(parseInfo({ ...info, version: 2 }), undefined)
  assert.equal(parseInfo({ ...info, protocol: 'other' }), undefined)
  assert.equal(parseInfo({ ...info, connections: -1 }), undefined)
  assert.equal(parseInfo({ ...info, interactions: {} }), undefined)
  assert.equal(parseInfo(null), undefined)
})
