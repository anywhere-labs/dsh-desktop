import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { NextRendererRecovery } from '../src/renderer-recovery.ts'

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

function fixture() {
  const options = {
    available: vi.fn(() => true), reload: vi.fn(async () => {}), exhausted: vi.fn(), healthy: vi.fn(), record: vi.fn(),
  }
  const recovery = new NextRendererRecovery(options)
  return { recovery, ...options }
}

it('records an ordinary mount as ready, never as a recovery', () => {
  const f = fixture()
  f.recovery.navigating('open')
  f.recovery.loaded()
  f.recovery.booted()
  f.recovery.report('healthy')
  expect(f.record.mock.calls).toEqual([['renderer.ready', { cause: 'open' }]])
  expect(f.healthy).toHaveBeenCalledOnce()
  f.recovery.stop()
})

it('coalesces crash, preload and navigation errors into one reload', async () => {
  const f = fixture()
  f.recovery.fail('Renderer: crashed')
  f.recovery.fail('preload failed')
  f.recovery.fail('navigation failed')
  await vi.advanceTimersByTimeAsync(0)
  expect(f.reload).toHaveBeenCalledOnce()
  expect(f.exhausted).not.toHaveBeenCalled()
  f.recovery.stop()
})

it('requires both a loaded document and a mounted client', async () => {
  const f = fixture()
  f.recovery.fail('crashed')
  await vi.advanceTimersByTimeAsync(0)
  f.recovery.navigating('recovery')
  f.recovery.booted()
  f.recovery.report('healthy')
  expect(f.record).not.toHaveBeenCalledWith('renderer.recovery.healthy', expect.anything())
  expect(f.healthy).not.toHaveBeenCalled()
  f.recovery.loaded()
  expect(f.record).toHaveBeenCalledWith('renderer.recovery.healthy', { attempt: 1 })
  expect(f.record).not.toHaveBeenCalledWith('renderer.ready', expect.anything())
  expect(f.healthy).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(30_000)
  expect(f.reload).toHaveBeenCalledOnce()
  f.recovery.stop()
})

it('records a page navigation after a recovery as ready, while the crash budget waits for stable health', async () => {
  const f = fixture()
  f.recovery.fail('crashed')
  await vi.advanceTimersByTimeAsync(0)
  f.recovery.navigating('recovery')
  f.recovery.loaded(); f.recovery.report('healthy')
  f.recovery.navigating('page')
  f.recovery.loaded(); f.recovery.report('healthy')
  expect(f.record).toHaveBeenLastCalledWith('renderer.ready', { cause: 'page' })
  expect(f.healthy).toHaveBeenCalledTimes(2)
  f.recovery.fail('crashed again')
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.record).toHaveBeenLastCalledWith('renderer.recovery.reload', { attempt: 2 })
  f.recovery.stop()
})

it('does not time out a slow Host before it has supplied boot data', async () => {
  const f = fixture()
  f.recovery.navigating('open')
  f.recovery.loaded()
  await vi.advanceTimersByTimeAsync(120_000)
  expect(f.reload).not.toHaveBeenCalled()
  f.recovery.booted()
  await vi.advanceTimersByTimeAsync(30_001)
  expect(f.reload).toHaveBeenCalledOnce()
  f.recovery.stop()
})

it('keeps a mounted page healthy without connection or session updates', async () => {
  const f = fixture()
  f.recovery.loaded()
  f.recovery.booted()
  f.recovery.report('healthy')
  await vi.advanceTimersByTimeAsync(120_000)
  expect(f.reload).not.toHaveBeenCalled()
  f.recovery.stop()
})

it('requires a fresh mount report after navigation', async () => {
  const f = fixture()
  f.recovery.loaded()
  f.recovery.report('healthy')
  f.recovery.navigating('page')
  f.recovery.loaded()
  f.recovery.booted()
  await vi.advanceTimersByTimeAsync(30_001)
  expect(f.reload).toHaveBeenCalledOnce()
  f.recovery.stop()
})

it('falls back only after three failed reloads with bounded backoff', async () => {
  const f = fixture()
  f.recovery.fail('crashed')
  await vi.advanceTimersByTimeAsync(0)
  f.recovery.fail('boot failed')
  await vi.advanceTimersByTimeAsync(999)
  expect(f.reload).toHaveBeenCalledTimes(1)
  await vi.advanceTimersByTimeAsync(1)
  f.recovery.fail('boot failed again')
  await vi.advanceTimersByTimeAsync(3_000)
  expect(f.reload).toHaveBeenCalledTimes(3)
  f.recovery.fail('still broken')
  expect(f.exhausted).toHaveBeenCalledExactlyOnceWith('still broken')
  f.recovery.report('healthy')
  f.recovery.fail('late failure')
  await vi.advanceTimersByTimeAsync(120_000)
  expect(f.reload).toHaveBeenCalledTimes(3)
})

it('does not reset its crash budget until health has remained stable for a minute', async () => {
  const f = fixture()
  for (let i = 0; i < 3; i++) {
    f.recovery.fail('crashed')
    await vi.advanceTimersByTimeAsync(i === 0 ? 0 : i === 1 ? 1000 : 3000)
    f.recovery.loaded(); f.recovery.report('healthy')
    await vi.advanceTimersByTimeAsync(59_000)
  }
  f.recovery.fail('crashed before stable')
  expect(f.exhausted).toHaveBeenCalledOnce()
})

it('resets the budget after a stable recovery', async () => {
  const f = fixture()
  f.recovery.fail('crashed')
  await vi.advanceTimersByTimeAsync(0)
  f.recovery.loaded(); f.recovery.report('healthy')
  await vi.advanceTimersByTimeAsync(60_000)
  f.recovery.fail('later independent crash')
  await vi.advanceTimersByTimeAsync(0)
  expect(f.reload).toHaveBeenCalledTimes(2)
  expect(f.record).toHaveBeenLastCalledWith('renderer.recovery.reload', { attempt: 1 })
  f.recovery.stop()
})

it.each(['stop', 'unavailable'] as const)('withdraws pending work when %s', async reason => {
  const f = fixture()
  f.recovery.fail('crashed')
  if (reason === 'stop') f.recovery.stop()
  else f.available.mockReturnValue(false)
  await vi.advanceTimersByTimeAsync(120_000)
  expect(f.reload).not.toHaveBeenCalled()
  expect(f.exhausted).not.toHaveBeenCalled()
})

it('ignores a rejected navigation after a newer document or shutdown supersedes it', async () => {
  const f = fixture()
  let reject!: (error: Error) => void
  f.reload.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  f.recovery.fail('crashed')
  await vi.advanceTimersByTimeAsync(0)
  f.recovery.navigating('page')
  f.recovery.loaded(); f.recovery.report('healthy')
  reject(new Error('old load failed'))
  await vi.advanceTimersByTimeAsync(30_000)
  expect(f.reload).toHaveBeenCalledOnce()
  f.recovery.stop()
})
