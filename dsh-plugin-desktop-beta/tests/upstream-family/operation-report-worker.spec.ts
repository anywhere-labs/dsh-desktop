/** The built Worker collects history as the packaged application runs it; skipped until `lib/` is built. */
import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { expect, it, onTestFinished } from 'vitest'

const worker = fileURLToPath(new URL('../../lib/operation-report-worker.js', import.meta.url))
const limits = { bytes: 65536, recordBytes: 4096, records: 100, outputBytes: 65536 }

async function run(script: string): Promise<{ code: number; stdout: string; stderr: string }> {
  try {
    const { stdout, stderr } = await promisify(execFile)(process.execPath, [script], { timeout: 30_000 })
    return { code: 0, stdout, stderr }
  } catch (error) {
    const failed = error as { code?: unknown; stdout?: string; stderr?: string }
    return { code: typeof failed.code === 'number' ? failed.code : 1, stdout: failed.stdout ?? '', stderr: failed.stderr ?? String(error) }
  }
}

async function fixture(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'desktop-operation-worker-'))
  onTestFinished(async () => { await rm(directory, { recursive: true, force: true }) })
  return directory
}

it.skipIf(!existsSync(worker))('appends both record kinds through the built Worker', async () => {
  const directory = await fixture()
  const operation = { runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
    operation: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98c9', time: '2026-10-19T00:00:00.000Z',
      reason: 'bundle', phase: 'started', target: 'real-worker-test', stage: 'enable' } }
  const command = { runId: 'c254ab28-97c9-4382-95e6-2db9c66f98c8', transportDropped: 0,
    pluginCommand: { id: 'c254ab28-97c9-4382-95e6-2db9c66f98ca', time: '2026-10-19T00:00:01.000Z',
      action: 'add', target: 'dsh-market-plugin', version: '1.0.0', phase: 'started' } }
  await writeFile(join(directory, 'operations.jsonl'), JSON.stringify(operation) + '\n' + JSON.stringify(command) + '\n')
  const reportPath = join(directory, 'report.log')
  await writeFile(reportPath, 'basic report\n')
  const script = join(directory, 'append.mjs')
  await writeFile(script, `import { Worker } from 'node:worker_threads';
const worker = new Worker(${JSON.stringify(worker)}, { workerData: ${JSON.stringify({ reportPath, directory, journal: null, limits })} });
worker.on('message', message => { console.log(JSON.stringify(message)) });
worker.on('error', error => { throw error });
worker.on('exit', code => { if (code !== 0) process.exitCode = 1 });
`)
  const result = await run(script)
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('true')
  const report = await readFile(reportPath, 'utf8')
  expect(report.startsWith('basic report\n')).toBe(true)
  const summary = JSON.parse(report.split('\n').find(line => line.startsWith('{'))!) as { records: unknown[] }
  expect(summary.records).toEqual([command, operation])
  expect(report).toContain('operation history collection complete')
})

it.skipIf(!existsSync(worker))('cancels the built Worker after an in-flight open settles', async () => {
  const directory = await fixture()
  const reportPath = join(directory, 'report.log')
  await writeFile(reportPath, 'basic report\n')
  await writeFile(join(directory, 'operations.jsonl'), '{}\n')
  const hook = join(directory, 'hook.mjs')
  await writeFile(hook, `import fs from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { parentPort } from 'node:worker_threads';
const original = fs.open;
fs.open = async (...args) => {
  const handle = await original(...args);
  parentPort.postMessage('opened');
  await new Promise(resolve => parentPort.once('message', resolve));
  return handle;
};
syncBuiltinESMExports();
`)
  const script = join(directory, 'cancel.mjs')
  await writeFile(script, `import { Worker } from 'node:worker_threads';
const worker = new Worker(${JSON.stringify(worker)}, {
  workerData: ${JSON.stringify({ reportPath, directory, journal: null, limits })}, execArgv: ['--import', ${JSON.stringify(pathToFileURL(hook).href)}]
});
worker.on('message', message => {
  if (message === 'opened') worker.postMessage('cancel');
  else console.log(JSON.stringify(message));
});
worker.on('error', error => { throw error });
worker.on('exit', code => { process.exitCode = code });
`)
  const result = await run(script)
  expect(result.code, result.stderr).toBe(0)
  expect(result.stdout.trim()).toBe('false')
  expect(await readFile(reportPath, 'utf8')).toBe('basic report\n')
})

it.skipIf(!existsSync(worker))('rejects collection input outside its budgets', async () => {
  const directory = await fixture()
  const script = join(directory, 'invalid.mjs')
  await writeFile(script, `import { Worker } from 'node:worker_threads';
const worker = new Worker(${JSON.stringify(worker)}, { workerData: ${JSON.stringify({ reportPath: join(directory, 'report.log'), directory, journal: null, limits: { ...limits, bytes: 0 } })} });
worker.on('error', error => { console.log(error.message) });
worker.on('exit', code => { console.log('exit ' + code) });
`)
  const result = await run(script)
  expect(result.stdout).toContain('Invalid operation report budget')
  expect(result.stdout).toContain('exit 1')
})
