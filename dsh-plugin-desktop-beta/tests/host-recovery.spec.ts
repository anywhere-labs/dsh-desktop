import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { DesktopHostRecovery } from '../src/host-recovery.ts'

let directory: string
beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'desktop-host-recovery-'))
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-11-01T00:00:00Z'))
})
afterEach(() => {
  vi.useRealTimers()
  rmSync(directory, { recursive: true, force: true })
})

function fixture(enabled = true) {
  const options = {
    enabled, file: join(directory, 'host-recovery.json'), available: vi.fn(() => true),
    relaunch: vi.fn(), fallback: vi.fn(), record: vi.fn(),
  }
  return { recovery: new DesktopHostRecovery(options), ...options }
}

it('leaves the default and startup, renderer and action failures on the manual path', () => {
  const disabled = fixture(false)
  expect(disabled.recovery.handle('host-runtime')).toBe(false)
  const f = fixture()
  for (const stage of [undefined, 'host-boot', 'renderer-runtime', 'profile-composition', 'desktop-runtime'] as const) {
    expect(f.recovery.handle(stage)).toBe(false)
  }
  f.available.mockReturnValue(false)
  expect(f.recovery.handle('host-runtime')).toBe(false)
  expect(() => readFileSync(f.file)).toThrow()
  expect(vi.getTimerCount()).toBe(0)
})

it('reserves on disk before one delayed whole-app restart, coalescing repeated failures', () => {
  const f = fixture()
  expect(f.recovery.handle('host-runtime')).toBe(true)
  expect(f.recovery.handle('host-runtime')).toBe(true)
  expect(JSON.parse(readFileSync(f.file, 'utf8'))).toEqual({ version: 1, attempts: [Date.now()] })
  vi.advanceTimersByTime(999)
  expect(f.relaunch).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(f.relaunch).toHaveBeenCalledOnce()
  expect(f.recovery.handle('host-runtime')).toBe(true)
  vi.advanceTimersByTime(10_000)
  expect(f.relaunch).toHaveBeenCalledOnce()
  expect(f.fallback).not.toHaveBeenCalled()
})

it('preserves the three-attempt rolling budget and backoff across fresh instances', () => {
  for (const delay of [1000, 2000, 4000]) {
    const f = fixture()
    expect(f.recovery.handle('host-runtime')).toBe(true)
    vi.advanceTimersByTime(delay - 1)
    expect(f.relaunch).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(f.relaunch).toHaveBeenCalledOnce()
  }
  const exhausted = fixture()
  expect(exhausted.recovery.handle('host-runtime')).toBe(false)
  expect(exhausted.record).toHaveBeenCalledWith('host.recovery.blocked', { reason: 'budget-exhausted' })
  vi.advanceTimersByTime(15 * 60_000)
  const later = fixture()
  expect(later.recovery.handle('host-runtime')).toBe(true)
  expect(later.record).toHaveBeenCalledWith('host.recovery.scheduled', { attempt: 1, delayMs: 1000 })
})

it('does not reset the budget when the system clock moves backwards', () => {
  const f = fixture()
  writeFileSync(f.file, JSON.stringify({ version: 1, attempts: [Date.now(), Date.now(), Date.now()] }))
  vi.setSystemTime(Date.now() - 60_000)
  expect(f.recovery.handle('host-runtime')).toBe(false)
  expect(vi.getTimerCount()).toBe(0)
})

it.each(['{', '{}', '{"version":2,"attempts":[]}', '{"version":1,"attempts":["0"]}', '{"version":1,"attempts":[0,0,0,0]}'])(
  'falls back without replacing invalid state: %s', text => {
    const f = fixture()
    writeFileSync(f.file, text)
    expect(f.recovery.handle('host-runtime')).toBe(false)
    expect(readFileSync(f.file, 'utf8')).toBe(text)
    expect(f.record).toHaveBeenCalledWith('host.recovery.blocked', { reason: 'state-unavailable' })
    expect(vi.getTimerCount()).toBe(0)
  },
)

it('refuses recovery when the budget cannot be written', () => {
  const f = fixture()
  // A non-directory parent fails on every platform, including privileged test runners.
  writeFileSync(join(directory, 'blocked'), '')
  const recovery = new DesktopHostRecovery({ ...f, file: join(directory, 'blocked', 'budget.json') })
  expect(recovery.handle('host-runtime')).toBe(false)
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(vi.getTimerCount()).toBe(0)
})

it('rejects non-file or oversized budget state', () => {
  const f = fixture()
  mkdirSync(f.file)
  expect(f.recovery.handle('host-runtime')).toBe(false)
  rmSync(f.file, { recursive: true })
  writeFileSync(f.file, ' '.repeat(4097))
  expect(f.recovery.handle('host-runtime')).toBe(false)
})

it('cancels on normal shutdown or manual recovery without refunding the reserved attempt', () => {
  const f = fixture()
  f.recovery.handle('host-runtime')
  f.recovery.stop()
  vi.advanceTimersByTime(60_000)
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(f.fallback).not.toHaveBeenCalled()
  expect(f.recovery.handle('host-runtime')).toBe(false)
  expect(JSON.parse(readFileSync(f.file, 'utf8')).attempts).toHaveLength(1)
})

it('checks availability again before relaunch and returns to the manual path if it changes', () => {
  const f = fixture()
  f.recovery.handle('host-runtime')
  f.available.mockReturnValue(false)
  vi.advanceTimersByTime(1000)
  expect(f.relaunch).not.toHaveBeenCalled()
  expect(f.fallback).toHaveBeenCalledOnce()
})

it('falls back if relaunch throws and tolerates a failing diagnostic observer', () => {
  const f = fixture()
  f.relaunch.mockImplementation(() => { throw new Error('Relaunch unavailable') })
  f.record.mockImplementation(() => { throw new Error('Diagnostics unavailable') })
  expect(f.recovery.handle('host-runtime')).toBe(true)
  expect(() => vi.advanceTimersByTime(1000)).not.toThrow()
  expect(f.fallback).toHaveBeenCalledOnce()
})
