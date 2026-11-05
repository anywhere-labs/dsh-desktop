import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FAILURE_REPORTS_RETAINED, failureReportFileName, renderFailureReport, writeFailureReport, type FailureReportInput } from '../src/failure-report.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

const base: FailureReportInput = {
  time: new Date('2026-10-29T10:30:00.000Z'), stage: 'host-boot',
  failure: 'dsh-desktop-next: startup failed: 1 required plugin did not activate',
  facts: [['run', 'run-1'], ['version', '2.0.21-next']],
  log: '2026-10-29T10:29:59.000Z [info] [desktop] host.start.start\n',
}

it('names a report after its time and stage, so that names sort by time', () => {
  expect(failureReportFileName(base.time, 'renderer-startup')).toBe('dsh-desktop-next-failure-2026-10-29T10-30-00-000Z-renderer-startup.log')
})

it('renders the failure with the Host diagnostic or the shell error details, masking secrets', () => {
  const host = renderFailureReport({ ...base, hostDiagnostic: 'StartupError: startup failed\nConfiguration file: /profiles/desktop/cordis.yml\nAuthorization: Bearer abcdef' })
  expect(host).toContain('time: 2026-10-29T10:30:00.000Z\nstage: host-boot\nrun: run-1\nversion: 2.0.21-next\n')
  expect(host).toContain('--- failure (as shown in the recovery assistant) ---\ndsh-desktop-next: startup failed: 1 required plugin did not activate\n')
  expect(host).toContain('--- Host diagnostic (as reported by the Host process) ---\nStartupError: startup failed\nConfiguration file: /profiles/desktop/cordis.yml\nAuthorization: Bearer ****\n')
  expect(host).toContain('--- recent log (oldest first) ---\n2026-10-29T10:29:59.000Z [info] [desktop] host.start.start\n')
  expect(host).not.toContain('--- error details ---')
  const shell = renderFailureReport({ ...base, error: new Error('Invalid Next Profile manifest', { cause: new Error('token=abcdef in package.json') }) })
  expect(shell).toContain('--- error details ---\nError: Invalid Next Profile manifest\n')
  expect(shell).toContain('[cause]: Error: token=**** in package.json')
  expect(shell).not.toContain('--- Host diagnostic')
})

it('repeats only the end of a long log, from a line boundary', () => {
  const log = Array.from({ length: 6000 }, (_, index) => `log line ${String(index)}`).join('\n') + '\n'
  const text = renderFailureReport({ ...base, log })
  expect(text).toContain('--- recent log (oldest first) ---\n… (earlier log lines omitted)\nlog line ')
  expect(text).not.toMatch(/^log line 0$/mu)
  expect(text.endsWith('log line 5999\n\n')).toBe(true)
})

it('writes private reports that are never replaced and keeps the newest ten beside unrelated log files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-failure-report-'))
  directories.push(directory)
  await writeFile(join(directory, 'desktop-next.log'), 'readable log')
  await writeFile(join(directory, 'startup-2026-09-22T16-10-41.999Z-cli.log'), 'CLI startup report')
  const at = (second: number): FailureReportInput => ({ ...base, time: new Date(Date.UTC(2026, 9, 29, 10, 30, second)) })
  const files: string[] = []
  for (let second = 0; second < FAILURE_REPORTS_RETAINED + 2; second++) files.push(await writeFailureReport(directory, at(second)))
  expect(await readFile(files.at(-1)!, 'utf8')).toBe(renderFailureReport(at(FAILURE_REPORTS_RETAINED + 1)))
  if (process.platform !== 'win32') expect((await stat(files.at(-1)!)).mode & 0o777).toBe(0o600)
  expect((await readdir(directory)).sort()).toEqual([...files.slice(2).map(file => basename(file)), 'desktop-next.log', 'startup-2026-09-22T16-10-41.999Z-cli.log'].sort())
  await expect(writeFailureReport(directory, at(FAILURE_REPORTS_RETAINED + 1))).rejects.toThrow('EEXIST')
})
