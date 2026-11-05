import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { writeFailureReport } from '../../src/failure-report.ts'
import { OPERATION_HISTORY_NOTE } from '../../src/upstream-family/desktop-operation-history.ts'
import { appendOperationReport } from '../../src/upstream-family/operation-report.ts'

const limits = { bytes: 65536, recordBytes: 4096, records: 100, outputBytes: 65536 }
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-operation-report-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  const report = await writeFailureReport(directory, { time: new Date('2026-10-19T00:00:00Z'), stage: 'host-runtime',
    failure: 'dsh desktop host exited with code 1', facts: [['host run', 'c254ab28-97c9-4382-95e6-2db9c66f98c8']],
    log: '', auxiliary: OPERATION_HISTORY_NOTE })
  return { directory, report, basic: await readFile(report, 'utf8') }
}

function summaryOf(section: string): { journal: unknown; outputRecordsOmitted: number; records: Record<string, { target: string }>[] } {
  return JSON.parse(section.split('\n').find(line => line.startsWith('{'))!) as ReturnType<typeof summaryOf>
}

it('preserves the independently saved basic report and appends whitelisted recent history', async () => {
  const { directory, report, basic } = await fixture()
  const operation = { runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
    operation: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9', time: '2026-10-19T00:00:00.000Z',
      reason: 'bundle', phase: 'started', target: 'test-bundle', stage: 'enable', diagnostic: 'secret' } }
  const command = { runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
    pluginCommand: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca', time: '2026-10-19T00:00:01.000Z',
      action: 'remove', target: 'dsh-market-plugin', phase: 'settled', exitCode: 0, argv: ['remove', 'secret-spec'] } }
  await writeFile(join(directory, 'operations.jsonl'), JSON.stringify(operation) + '\n' + JSON.stringify(command) + '\n')
  const journal = { dropped: 0, failed: 0, queuedBytes: 0, disabled: false, repairedSegments: 0 }
  expect(await appendOperationReport(report, directory, limits, new AbortController().signal, journal)).toBe(true)
  const combined = await readFile(report, 'utf8')
  expect(combined.startsWith(basic)).toBe(true)
  expect(basic).toContain('host run: c254ab28-97c9-4382-95e6-2db9c66f98c8')
  expect(basic.endsWith(['--- auxiliary diagnostics ---', ...OPERATION_HISTORY_NOTE, ''].join('\n'))).toBe(true)
  const section = combined.slice(basic.length)
  expect(section.startsWith('\n--- recent plugin operations (context, not proof of cause) ---\n')).toBe(true)
  expect(section.endsWith('\n--- operation history collection complete; consult omission counters above ---\n')).toBe(true)
  expect(section).not.toContain('secret')
  const summary = summaryOf(section)
  expect(summary).toMatchObject({ journal, outputRecordsOmitted: 0 })
  expect(summary.records.map(record => record.pluginCommand?.target ?? record.operation?.target)).toEqual(['dsh-market-plugin', 'test-bundle'])
})

it('leaves basic bytes unchanged when collection is cancelled or fails before append', async () => {
  const { directory, report, basic } = await fixture()
  expect(await appendOperationReport(report, directory, limits, AbortSignal.abort(), null)).toBe(false)
  expect(await appendOperationReport(report, directory, { ...limits, bytes: 0 }, new AbortController().signal, null)).toBe(false)
  expect(await readFile(report, 'utf8')).toBe(basic)
  expect(basic).toContain('unavailable or incomplete')
})

it('bounds the entire appended section and refuses a budget smaller than its metadata', async () => {
  const { directory, report, basic } = await fixture()
  expect(await appendOperationReport(report, directory, { ...limits, outputBytes: 1 }, new AbortController().signal, null)).toBe(false)
  expect(await readFile(report, 'utf8')).toBe(basic)
  expect(await appendOperationReport(report, directory, { ...limits, outputBytes: 512 }, new AbortController().signal, null)).toBe(true)
  const summary = (await readFile(report, 'utf8')).slice(basic.length)
  expect(Buffer.byteLength(summary)).toBeLessThanOrEqual(512)
  expect(summary).toContain('"outputRecordsOmitted":0')
})

it('omits oldest records to fit the output budget, counting UTF-8 bytes and all metadata', async () => {
  const { directory, report, basic } = await fixture()
  const records = Array.from({ length: 20 }, (_, index) => ({
    runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
    operation: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9', time: '2026-10-19T00:00:00.000Z',
      reason: 'bundle', phase: 'started', target: `测试插件-${index}`, stage: 'enable' },
  }))
  await writeFile(join(directory, 'operations.jsonl'), records.map(record => JSON.stringify(record)).join('\n') + '\n')
  expect(await appendOperationReport(report, directory, { ...limits, outputBytes: 1024 }, new AbortController().signal, null)).toBe(true)
  const section = (await readFile(report, 'utf8')).slice(basic.length)
  expect(Buffer.byteLength(section)).toBeLessThanOrEqual(1024)
  const summary = summaryOf(section)
  expect(summary.outputRecordsOmitted).toBeGreaterThan(0)
  expect(summary.records.length + summary.outputRecordsOmitted).toBe(20)
  expect(summary.records[0]?.operation?.target).toBe('测试插件-19')
})
