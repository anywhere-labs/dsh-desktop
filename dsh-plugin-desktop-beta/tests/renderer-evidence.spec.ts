import { afterEach, expect, it, vi } from 'vitest'
import { RENDERER_ROLLING_INTERVAL_MS, RollingRendererEvidence } from '../src/renderer-evidence.ts'

afterEach(() => { vi.useRealTimers() })

const sample = () => ({
  view: { visibility: 'visible', focused: true, reducedMotion: false, width: 1280, height: 840, devicePixelRatio: 2 },
  dom: { elements: 100 },
  animations: [],
  animationsTotal: 1,
  layers: [],
  frameLoop: { frames: 30, elapsedMs: 500, framesPerSecond: 60, sampledBy: 'raf' },
  longTasks: null,
})

function page(execute: () => Promise<unknown>) {
  return { isDestroyed: () => false, executeJavaScript: vi.fn(execute) }
}

it('keeps the last sample that answered and reports its age', async () => {
  vi.useFakeTimers()
  let clock = 0
  const contents = page(async () => sample())
  const evidence = new RollingRendererEvidence(() => contents, () => clock)
  expect(evidence.last()).toBeUndefined()
  evidence.start()
  await vi.advanceTimersByTimeAsync(RENDERER_ROLLING_INTERVAL_MS)
  expect(contents.executeJavaScript).toHaveBeenCalledOnce()
  clock += 5_000
  expect(evidence.last()).toMatchObject({ sample: { animationsTotal: 1 }, ageMs: 5_000 })
  evidence.stop()
})

it('keeps the previous sample when the page stops answering', async () => {
  vi.useFakeTimers()
  let calls = 0
  const contents = page(async () => { calls += 1; return calls === 1 ? sample() : new Promise(() => {}) })
  const evidence = new RollingRendererEvidence(() => contents)
  await evidence.refresh()
  const first = evidence.last()
  expect(first).toBeDefined()
  const pending = evidence.refresh()
  await vi.advanceTimersByTimeAsync(2_000)
  await pending
  // The age is read when the report asks, so compare the sample itself.
  expect(evidence.last()?.sample).toBe(first?.sample)
})

it('skips a refresh while one is already in flight', async () => {
  vi.useFakeTimers()
  const contents = page(() => new Promise(() => {}))
  const evidence = new RollingRendererEvidence(() => contents)
  const first = evidence.refresh()
  await evidence.refresh()
  expect(contents.executeJavaScript).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(2_000)
  await first
})

it('refreshes periodically and stops when asked', async () => {
  vi.useFakeTimers()
  const contents = page(async () => sample())
  const evidence = new RollingRendererEvidence(() => contents)
  evidence.start()
  await vi.advanceTimersByTimeAsync(RENDERER_ROLLING_INTERVAL_MS)
  expect(contents.executeJavaScript).toHaveBeenCalledOnce()
  await vi.advanceTimersByTimeAsync(RENDERER_ROLLING_INTERVAL_MS)
  expect(contents.executeJavaScript).toHaveBeenCalledTimes(2)
  evidence.stop()
  await vi.advanceTimersByTimeAsync(RENDERER_ROLLING_INTERVAL_MS * 2)
  expect(contents.executeJavaScript).toHaveBeenCalledTimes(2)
})

it('keeps nothing when there is no window to sample', async () => {
  const evidence = new RollingRendererEvidence(() => undefined)
  await evidence.refresh()
  expect(evidence.last()).toBeUndefined()
})
