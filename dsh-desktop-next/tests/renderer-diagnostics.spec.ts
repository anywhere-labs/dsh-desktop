import { afterEach, expect, it, vi } from 'vitest'
import {
  collectRendererDiagnostics,
  rendererDiagnosticsFields,
  rendererDiagnosticsProbe,
  RENDERER_SAMPLE_MS,
  type RendererDiagnostics,
  type RendererDiagnosticsTarget,
} from '../src/renderer-diagnostics.ts'

afterEach(() => { vi.useRealTimers() })

function page(execute: (code: string) => Promise<unknown>, destroyed = false) {
  const executeJavaScript = vi.fn(execute)
  const target: RendererDiagnosticsTarget = { isDestroyed: () => destroyed, executeJavaScript }
  return { target, executeJavaScript }
}

const sample = () => ({
  view: { visibility: 'visible', focused: false, reducedMotion: false, width: 1280, height: 840, devicePixelRatio: 2 },
  dom: { elements: 12_345 },
  animations: [{ name: 'dsh-row-shimmer-sweep_1rdzk_1', target: 'span.decoration', pseudo: null, iterations: null, infinite: true, currentTime: 812.5 }],
  animationsTotal: 3,
  layers: [{ tag: 'div', id: 'portal', className: 'menu-surface', position: 'fixed', children: 2, attributes: { 'data-slot': 'menu' } }],
  frameLoop: { frames: 58, elapsedMs: 1000, framesPerSecond: 58, sampledBy: 'raf' },
  longTasks: { count: 2, totalMs: 140.4 },
})

it('reports a missing or destroyed window instead of sampling', async () => {
  await expect(collectRendererDiagnostics(undefined)).resolves.toEqual({ available: false, reason: 'no-window' })
  const { target, executeJavaScript } = page(async () => sample(), true)
  await expect(collectRendererDiagnostics(target)).resolves.toEqual({ available: false, reason: 'no-window' })
  expect(executeJavaScript).not.toHaveBeenCalled()
})

it('carries the page sample into the export shape', async () => {
  const { target, executeJavaScript } = page(async () => sample())
  const snapshot = await collectRendererDiagnostics(target)
  expect(executeJavaScript).toHaveBeenCalledOnce()
  expect(snapshot).toMatchObject({
    available: true,
    sampleMs: RENDERER_SAMPLE_MS,
    view: { visibility: 'visible', focused: false, reducedMotion: false, width: 1280, height: 840, devicePixelRatio: 2 },
    dom: { elements: 12_345 },
    animationsTotal: 3,
    animations: [{ name: 'dsh-row-shimmer-sweep_1rdzk_1', target: 'span.decoration', infinite: true, currentTime: 812.5 }],
    layers: [{ tag: 'div', id: 'portal', position: 'fixed', attributes: { 'data-slot': 'menu' } }],
    frameLoop: { frames: 58, framesPerSecond: 58, sampledBy: 'raf' },
    longTasks: { count: 2, totalMs: 140.4 },
  })
  expect(Number.isNaN(Date.parse((snapshot as { sampledAt: string }).sampledAt))).toBe(false)
})

it('clips and caps what a broken page reports', async () => {
  const animations = Array.from({ length: 60 }, () => ({ name: 'x'.repeat(300), target: 't'.repeat(400), iterations: Infinity, infinite: true }))
  const layers = Array.from({ length: 30 }, () => ({ tag: 'div', className: 'c'.repeat(400), position: 'fixed', children: -4, attributes: { 'data-x': 'y'.repeat(400), onclick: 'ignored' } }))
  const { target } = page(async () => ({
    view: { visibility: 'visible', focused: 'yes', reducedMotion: 1, width: 'wide', height: null, devicePixelRatio: Number.NaN },
    dom: { elements: -1 },
    animations,
    animationsTotal: 1e9,
    layers,
    frameLoop: { frames: Number.POSITIVE_INFINITY, elapsedMs: 1000, framesPerSecond: -2, sampledBy: 'unknown' },
    longTasks: 'none',
  }))
  const snapshot = await collectRendererDiagnostics(target)
  expect(snapshot.available).toBe(true)
  const view = (snapshot as Extract<RendererDiagnostics, { available: true }>)
  expect(view.animations).toHaveLength(40)
  expect(view.animations[0]).toMatchObject({ name: 'x'.repeat(120), target: 't'.repeat(200), iterations: null, infinite: true, pseudo: null })
  expect(view.layers).toHaveLength(20)
  expect(view.layers[0]).toMatchObject({ className: 'c'.repeat(160), children: 0, attributes: { 'data-x': 'y'.repeat(120) } })
  expect(view.view).toMatchObject({ focused: null, reducedMotion: null, width: null, devicePixelRatio: null })
  expect(view.dom.elements).toBeNull()
  expect(view.frameLoop).toEqual({ frames: 0, elapsedMs: 1000, framesPerSecond: 0, sampledBy: 'raf' })
  expect(view.longTasks).toBeNull()
})

it('rejects an unreadable page answer as evidence, not as a thrown export', async () => {
  await expect(collectRendererDiagnostics(page(async () => 'nope').target)).resolves.toEqual({ available: false, reason: 'error', detail: 'unexpected renderer snapshot' })
  await expect(collectRendererDiagnostics(page(async () => ({ frameLoop: {} })).target)).resolves.toEqual({ available: false, reason: 'error', detail: 'unexpected renderer snapshot' })
})

it('reports a page failure with a masked detail', async () => {
  const { target } = page(async () => { throw new Error('probe failed token=private-value') })
  const result = await collectRendererDiagnostics(target)
  expect(result).toMatchObject({ available: false, reason: 'error' })
  expect(JSON.stringify(result)).not.toContain('private-value')
})

it('times out a page that never answers and clears the budget once it does', async () => {
  vi.useFakeTimers()
  const hanging = page(() => new Promise(() => {}))
  const task = collectRendererDiagnostics(hanging.target, { timeoutMs: 3000 })
  await vi.advanceTimersByTimeAsync(3000)
  await expect(task).resolves.toEqual({ available: false, reason: 'timeout' })
  expect(vi.getTimerCount()).toBe(0)
})

it('clears the timeout budget when the page answers first', async () => {
  vi.useFakeTimers()
  const task = collectRendererDiagnostics(page(async () => sample()).target, { timeoutMs: 3000 })
  await vi.advanceTimersByTimeAsync(0)
  await expect(task).resolves.toMatchObject({ available: true })
  expect(vi.getTimerCount()).toBe(0)
})

it('keeps the probe one bounded expression', () => {
  const source = rendererDiagnosticsProbe()
  expect(source.startsWith('(')).toBe(true)
  expect(source.endsWith(')()')).toBe(true)
  expect(source).toContain('budget = 1000')
  expect(source).toContain('split(/\\s+/u)')
  expect(rendererDiagnosticsProbe(1)).toContain('budget = 50')
  expect(rendererDiagnosticsProbe(100_000)).toContain('budget = 10000')
  expect(rendererDiagnosticsProbe(Number.NaN)).toContain('budget = 1000')
})

it('runs the probe against a minimal page and reports what it sees', async () => {
  const animation = {
    playState: 'running',
    animationName: 'spin',
    currentTime: 120,
    effect: { target: { tagName: 'svg', id: '', className: '', childElementCount: 0 }, getComputedTiming: () => ({ iterations: Number.POSITIVE_INFINITY }), pseudoElement: '::before' },
  }
  const layer = { tagName: 'div', id: 'portal', className: 'menu', childElementCount: 1, attributes: [{ name: 'data-slot', value: 'menu' }, { name: 'onclick', value: 'ignored' }] }
  const pageDocument = {
    visibilityState: 'visible',
    hasFocus: () => false,
    getAnimations: () => [animation],
    getElementsByTagName: () => [{}, {}, {}],
    body: { children: [layer] },
  }
  let clock = 0
  const schedule: (() => void)[] = []
  const run = new Function('document', 'performance', 'requestAnimationFrame', 'setTimeout', 'clearTimeout', 'getComputedStyle', 'matchMedia', 'innerWidth', 'innerHeight', 'devicePixelRatio', 'PerformanceObserver', `return ${rendererDiagnosticsProbe(50)}`)
  const pending = run(pageDocument, { now: () => (clock += 20) }, (callback: () => void) => { schedule.push(callback) },
    () => 0, () => {}, () => ({ position: 'fixed' }), () => ({ matches: false }), 800, 600, 2, undefined)
  while (schedule.length > 0) schedule.shift()!()
  const snapshot = await pending
  expect(snapshot).toMatchObject({
    view: { visibility: 'visible', focused: false, reducedMotion: false, width: 800, height: 600, devicePixelRatio: 2 },
    dom: { elements: 3 },
    animations: [{ name: 'spin', target: 'svg', pseudo: '::before', infinite: true, iterations: null, currentTime: 120 }],
    animationsTotal: 1,
    layers: [{ tag: 'div', id: 'portal', className: 'menu', position: 'fixed', children: 1, attributes: { 'data-slot': 'menu' } }],
    longTasks: null,
  })
  expect(snapshot.frameLoop.sampledBy).toBe('raf')
  expect(snapshot.frameLoop.frames).toBeGreaterThan(0)
})

it('summarizes the sample for the readable log', async () => {
  const renderer = await collectRendererDiagnostics(page(async () => sample()).target)
  expect(rendererDiagnosticsFields(renderer)).toEqual({
    available: true, animations: 1, animationsTotal: 3, layers: 1, framesPerSecond: 58,
    sampledBy: 'raf', focused: false, reducedMotion: false, visibility: 'visible', longTasks: 2,
  })
  expect(rendererDiagnosticsFields({ available: false, reason: 'timeout' })).toEqual({ available: false, reason: 'timeout' })
})
