/** Pin how a packaging phase journal becomes the job summary table. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { finishedStages, stageTable } from './summarize-packaging-run.mjs'

test('keeps finished stages in the order they ended and marks failures', () => {
  const journal = [
    { type: 'stage-start', stage: 'payload:total' },
    { type: 'stage-start', stage: 'payload:copy-dependencies' },
    { type: 'stage-end', stage: 'payload:copy-dependencies', elapsedMs: 8250, success: true },
    { type: 'stage-end', stage: 'payload:total', elapsedMs: 12_400, success: true },
    { type: 'stage-start', stage: 'builder:asar' },
    { type: 'stage-end', stage: 'builder:asar', elapsedMs: 900, success: false },
  ].map(event => JSON.stringify(event)).join('\n') + '\n'
  const stages = finishedStages(journal)
  assert.deepEqual(stages, [
    { stage: 'payload:copy-dependencies', seconds: 8.25, success: true },
    { stage: 'payload:total', seconds: 12.4, success: true },
    { stage: 'builder:asar', seconds: 0.9, success: false },
  ])
  assert.equal(stageTable(stages, 'macOS'), [
    '### macOS', '',
    '| Stage | Seconds | |', '| --- | ---: | --- |',
    '| payload:copy-dependencies | 8.3 |  |',
    '| payload:total | 12.4 |  |',
    '| builder:asar | 0.9 | failed |',
    '',
  ].join('\n'))
})
