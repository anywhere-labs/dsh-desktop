import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { packagingStep, packagingStepSync } from '../scripts/packaging-step.ts'

const directories: string[] = []
afterEach(() => {
  vi.unstubAllEnvs()
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true })
})

it('pairs nested synchronous and asynchronous phases across successful and failed actions without recording secrets', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'next-packaging-timing-'))
  directories.push(directory)
  vi.stubEnv('DSH_DESKTOP_PACKAGING_RUN_DIR', directory)
  const failure = new Error('private-token-must-not-be-recorded')
  await expect(packagingStep('outer', async () => {
    expect(packagingStepSync('copy', () => 42)).toBe(42)
    await packagingStep('failed', async () => { throw failure })
  })).rejects.toBe(failure)
  expect(() => packagingStepSync('sync-failed', () => { throw failure })).toThrow(failure)
  const text = readFileSync(join(directory, 'events.jsonl'), 'utf8')
  expect(text).not.toContain(failure.message)
  const events = text.trim().split('\n').map(line => JSON.parse(line))
  const starts = events.filter(event => event.type === 'stage-start')
  const ends = events.filter(event => event.type === 'stage-end')
  expect(starts).toHaveLength(4)
  expect(new Set(starts.map(event => event.stageId)).size).toBe(4)
  for (const start of starts) {
    const end = ends.find(event => event.stageId === start.stageId)
    expect(end).toMatchObject({ stage: start.stage, success: start.stage === 'copy', pid: process.pid })
    expect(end.elapsedMs).toBeGreaterThanOrEqual(0)
  }
})

it('preserves return values and thrown failures when measurement is disabled', async () => {
  vi.stubEnv('DSH_DESKTOP_PACKAGING_RUN_DIR', undefined)
  const failure = new Error('original failure')
  expect(packagingStepSync('sync', () => 7)).toBe(7)
  await expect(packagingStep('async', async () => 9)).resolves.toBe(9)
  await expect(packagingStep('failed', async () => { throw failure })).rejects.toBe(failure)
})
