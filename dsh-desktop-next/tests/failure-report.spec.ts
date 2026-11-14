import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { FAILURE_REPORTS_RETAINED, appendFailureReport, renderFailureReport, rendererFailureSection, writeFailureReport, type FailureReportInput } from '../src/failure-report.ts'

const directories: string[] = []
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))) })

const base: FailureReportInput = {
  time: new Date('2026-10-29T10:30:00.000Z'), stage: 'host-boot',
  failure: 'dsh-desktop-next: startup failed: 1 required plugin did not activate',
  facts: [['run', 'run-1'], ['version', '2.0.21-next']],
  log: '2026-10-29T10:29:59.000Z [info] [desktop] host.start.start\n',
}

it('renders the failure with the Host diagnostic or the shell error details, masking secrets', () => {
  const host = renderFailureReport({ ...base, hostDiagnostic: 'StartupError: startup failed\nConfiguration file: /profiles/desktop/cordis.yml\nAuthorization: Bearer abcdef' })
  expect(host).toContain('time: 2026-10-29T10:30:00.000Z\nstage: host-boot\nrun: run-1\nversion: 2.0.21-next\n')
  expect(host).toContain('--- failure (as shown in the recovery assistant) ---\ndsh-desktop-next: startup failed: 1 required plugin did not activate\n')
  expect(host).toContain('--- Host diagnostic (as reported by the Host process) ---\nStartupError: startup failed\nConfiguration file: /profiles/desktop/cordis.yml\nAuthorization: Bearer ****\n')
  expect(host).toContain('--- recent log (oldest first) ---\n2026-10-29T10:29:59.000Z [info] [desktop] host.start.start\n')
  expect(host).not.toContain('--- error details ---')
  const log = Array.from({ length: 6000 }, (_, index) => `log line ${String(index)}`).join('\n') + '\n'
  const shell = renderFailureReport({ ...base, log, error: new Error('Invalid Next Profile manifest', { cause: new Error('token=abcdef in package.json') }) })
  expect(shell).toContain('--- error details ---\nError: Invalid Next Profile manifest\n')
  expect(shell).toContain('[cause]: Error: token=**** in package.json')
  expect(shell).not.toContain('--- Host diagnostic')
  expect(shell).toContain('… (earlier log lines omitted)\nlog line ')
  expect(shell).not.toMatch(/^log line 0$/mu)
  expect(shell.endsWith('log line 5999\n\n')).toBe(true)
})

it('lists every plugin a timed-out start was still loading right after the failure (#1617)', () => {
  const report = renderFailureReport({ ...base, failure: 'Host startup exceeded 60 seconds\nStill loading: magpie-mcp-deepwiki (@deepseek-ai/dsh-mcp-client, starting, 47 s).',
    startup: { seconds: 60, pending: [{ id: 'magpie-mcp-deepwiki', name: '@deepseek-ai/dsh-mcp-client', phase: 'starting', waitedMs: 46_700 },
      { id: 'token=abcdef', name: '@fixture/plugin', phase: 'importing', waitedMs: 1_200 }] } })
  expect(report).toContain('starting, 47 s).\n\n--- plugins still loading at the 60-second startup limit ---\n'
    + 'magpie-mcp-deepwiki (@deepseek-ai/dsh-mcp-client): starting, 47 s since the Host created it\n'
    + 'token=**** (@fixture/plugin): importing, 1 s since the Host created it\n\n--- recent log')
  expect(renderFailureReport({ ...base, startup: { seconds: 120 } })).toContain('--- plugins still loading at the 120-second startup limit ---\n(the Host did not answer)\n')
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

const rendererSample = {
  available: true as const, sampledAt: '2026-11-13T00:00:00.000Z', sampleMs: 750,
  view: { visibility: 'visible', focused: false, reducedMotion: false, width: 1280, height: 840, devicePixelRatio: 2 },
  dom: { elements: 4321 },
  animations: [{ name: 'dsh-state-dot-spin', target: 'svg', pseudo: '::before', iterations: null, infinite: true, currentTime: 321.5 }],
  animationsTotal: 1,
  layers: [{ tag: 'div', id: 'portal', className: 'menu surface', position: 'fixed', children: 2, attributes: { 'data-slot': 'menu' } }],
  frameLoop: { frames: 44, elapsedMs: 750, framesPerSecond: 58, sampledBy: 'raf' as const },
  longTasks: { count: 1, totalMs: 64 },
}

it('renders what the renderer was drawing for a failure report', () => {
  const section = rendererFailureSection(rendererSample)
  expect(section).toContain('--- renderer at failure ---')
  expect(section).toContain('sampled: 750 ms, 44 frames (58/s, raf)')
  expect(section).toContain('window: visible, unfocused, 1280x840@2x')
  expect(section).toContain('long tasks: 1 in 64 ms')
  expect(section).toContain('animations: 1 running of 1')
  expect(section).toContain('  dsh-state-dot-spin on svg::before (infinite) at 321.5 ms')
  expect(section).toContain('body layers: 1')
  expect(section).toContain('  div#portal.menu.surface fixed, 2 children')
  expect(rendererFailureSection({ available: false, reason: 'no-window' })).toBe('')
  expect(rendererFailureSection({ available: false, reason: 'timeout' })).toContain('--- renderer at failure ---\nunavailable: timeout\n')
  expect(rendererFailureSection({ available: false, reason: 'error', detail: 'probe failed' })).toContain('unavailable: error (probe failed)')
})

it('appends late evidence to a written report without rewriting it, masked', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'next-failure-appendix-'))
  directories.push(directory)
  const file = await writeFailureReport(directory, base)
  const written = await readFile(file, 'utf8')
  await appendFailureReport(file, `${rendererFailureSection(rendererSample)}evidence token=private-value\n`)
  const combined = await readFile(file, 'utf8')
  expect(combined.startsWith(written)).toBe(true)
  expect(combined).toContain('--- renderer at failure ---')
  expect(combined).toContain('evidence token=****')
  expect(combined).not.toContain('private-value')
})

it('shows the last known sample when the page could not be sampled for the report', () => {
  const crashed = rendererFailureSection({ available: false, reason: 'no-window' }, { sample: rendererSample, ageMs: 42_000 })
  expect(crashed).toContain('--- renderer at failure ---\nunavailable: no-window\n\nlast known: 42 s before the failure\nsampled: 750 ms')
  expect(crashed).toContain('last known: 42 s before the failure')
  expect(crashed).toContain('dsh-state-dot-spin on svg::before')
  // Nothing was ever sampled and there is no window: startup reports stay unchanged.
  expect(rendererFailureSection({ available: false, reason: 'no-window' })).toBe('')
  expect(rendererFailureSection({ available: false, reason: 'timeout' }, { sample: rendererSample, ageMs: 125_000 })).toContain('last known: 2 min before the failure')
})
