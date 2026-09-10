import assert from 'node:assert/strict'
import test from 'node:test'
import { verifyOperationReliability } from './operation-reliability.mjs'

test('accepts the checked-in operation reliability matrix', async () => {
  const result = await verifyOperationReliability()
  assert.deepEqual(result.failures, [])
  assert.equal(result.operationCount, 7)
  assert.equal(result.scenarioCount, 18)
})
