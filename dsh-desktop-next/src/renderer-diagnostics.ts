/**
 * Renderer-side evidence for the diagnostics export.
 *
 * A report about idle CPU, jank or a progress indicator that never settles says nothing
 * about *what* keeps the page busy: the export is assembled in the main process, which
 * cannot see animations, portalled layers or the page's frame loop. This module samples
 * them in the main window at export time, so a report names the element that is drawing
 * and how often it draws, without asking the reporter to open DevTools first.
 *
 * The probe is a self-contained page expression: it touches DOM APIs only, so it needs no
 * preload bridge or IPC channel, and it is bounded (about one second of frames, capped
 * lists, clipped strings). A window that cannot be sampled is reported as unavailable
 * instead of failing the export — a renderer that never answers is itself evidence.
 */

import { maskSecrets } from './mask-secrets.ts'

/** Frames are counted for this long; a second covers several cycles of a typical animation. */
export const RENDERER_SAMPLE_MS = 1000
/** A busy or frozen renderer must not hold the export open. */
export const RENDERER_SAMPLE_TIMEOUT_MS = 3000
const MAX_ANIMATIONS = 40
const MAX_LAYERS = 20
const MAX_TEXT = 200
const MAX_DETAIL = 300

/** One running animation, named by its target rather than by any of its content. */
export interface RendererAnimation {
  name: string
  target: string
  pseudo: string | null
  iterations: number | null
  infinite: boolean
  currentTime: number | null
}

/** A body-level layer: dropdowns, masks, hover cards and the shell's own overlays. */
export interface RendererLayer {
  tag: string
  id: string | null
  className: string | null
  position: string
  children: number
  attributes: Record<string, string>
}

export interface RendererView {
  visibility: string
  focused: boolean | null
  reducedMotion: boolean | null
  width: number | null
  height: number | null
  devicePixelRatio: number | null
}

export interface RendererFrameLoop {
  frames: number
  elapsedMs: number
  framesPerSecond: number
  /** `timer` means no frame callback ran inside the window, for example an occluded page. */
  sampledBy: 'raf' | 'timer'
}

export interface RendererDiagnosticsSnapshot {
  available: true
  sampledAt: string
  sampleMs: number
  view: RendererView
  dom: { elements: number | null }
  animations: RendererAnimation[]
  animationsTotal: number
  layers: RendererLayer[]
  frameLoop: RendererFrameLoop
  longTasks: { count: number; totalMs: number } | null
}

export interface RendererDiagnosticsUnavailable {
  available: false
  reason: 'no-window' | 'timeout' | 'error'
  detail?: string
}

export type RendererDiagnostics = RendererDiagnosticsSnapshot | RendererDiagnosticsUnavailable

/** The part of a page's `WebContents` the collection needs. */
export interface RendererDiagnosticsTarget {
  isDestroyed(): boolean
  executeJavaScript(code: string): Promise<unknown>
}

/**
 * The page expression that produces the snapshot.
 *
 * It must stay self-contained: only DOM APIs, no imports and no closures over this
 * module. Clamping happens again on this side, so a hostile or broken page cannot
 * inflate the export.
 * @param sampleMs - frame window, clamped to a readable range.
 * @returns one expression that resolves to the snapshot.
 */
export function rendererDiagnosticsProbe(sampleMs: number = RENDERER_SAMPLE_MS): string {
  const budget = Number.isFinite(sampleMs) ? Math.max(50, Math.min(10_000, Math.round(sampleMs))) : RENDERER_SAMPLE_MS
  return `(async () => {
  const budget = ${budget};
  const clip = (value, max) => typeof value === 'string' ? value.slice(0, max) : null;
  const classNameOf = (element) => {
    const value = element === null || element === undefined ? undefined : element.className;
    if (typeof value === 'string') return value;
    if (value !== null && value !== undefined && typeof value.baseVal === 'string') return value.baseVal;
    return '';
  };
  const describe = (element) => {
    if (element === null || typeof element !== 'object') return 'unknown';
    const tag = clip(element.tagName, 40);
    const id = clip(element.id, 60);
    const names = clip(classNameOf(element).trim(), 160);
    const parts = [tag === null ? 'unknown' : String(tag).toLowerCase()];
    if (id !== null && id !== '') parts.push('#' + id);
    if (names !== null && names !== '') parts.push('.' + names.split(/\\s+/u).slice(0, 4).join('.'));
    return parts.join('');
  };
  const attributesOf = (element) => {
    const record = {};
    const source = element === null || element === undefined ? undefined : element.attributes;
    if (source === undefined || source === null || typeof source.length !== 'number') return record;
    for (let index = 0; index < source.length && Object.keys(record).length < 8; index += 1) {
      const attribute = source[index];
      if (attribute === null || attribute === undefined) continue;
      const name = clip(attribute.name, 60);
      if (name === null || !/^(?:data-[a-z0-9-]+|role)$/u.test(name)) continue;
      record[name] = clip(String(attribute.value), 120);
    }
    return record;
  };
  const animationOf = (entry) => {
    const effect = entry === null || entry === undefined || entry.effect === undefined ? null : entry.effect;
    const target = effect === null ? null : effect.target;
    let name = 'waapi';
    try {
      if (typeof entry.animationName === 'string' && entry.animationName !== '') name = entry.animationName;
    } catch (error) {}
    let iterations = null;
    let infinite = false;
    let currentTime = null;
    let pseudo = null;
    try {
      const timing = effect !== null && typeof effect.getComputedTiming === 'function' ? effect.getComputedTiming() : null;
      if (timing !== null && typeof timing.iterations === 'number') {
        if (timing.iterations === Infinity) infinite = true;
        else iterations = timing.iterations;
      }
    } catch (error) {}
    try {
      if (typeof entry.currentTime === 'number') currentTime = Math.round(entry.currentTime * 10) / 10;
    } catch (error) {}
    try {
      if (effect !== null && typeof effect.pseudoElement === 'string' && effect.pseudoElement !== '') pseudo = effect.pseudoElement;
    } catch (error) {}
    return { name: name.slice(0, 120), target: describe(target), pseudo: pseudo, iterations: iterations, infinite: infinite, currentTime: currentTime };
  };
  let longTaskCount = 0;
  let longTaskMs = 0;
  let observer = null;
  if (typeof PerformanceObserver === 'function') {
    try {
      observer = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        for (let index = 0; index < entries.length; index += 1) {
          longTaskCount += 1;
          longTaskMs += typeof entries[index].duration === 'number' ? entries[index].duration : 0;
        }
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch (error) {
      observer = null;
    }
  }
  const started = performance.now();
  let frames = 0;
  let sampledBy = 'raf';
  await new Promise((resolve) => {
    let settled = false;
    let guard = 0;
    const finish = (cause) => {
      if (settled) return;
      settled = true;
      sampledBy = cause;
      clearTimeout(guard);
      resolve();
    };
    guard = setTimeout(() => finish('timer'), budget + 250);
    const tick = () => {
      if (settled) return;
      frames += 1;
      if (performance.now() - started >= budget) finish('raf');
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
  const elapsed = performance.now() - started;
  if (observer !== null) {
    try { observer.disconnect(); } catch (error) {}
  }
  const animations = [];
  let animationsTotal = 0;
  try {
    const all = typeof document.getAnimations === 'function' ? document.getAnimations() : [];
    animationsTotal = all.length;
    for (let index = 0; index < all.length && animations.length < 40; index += 1) {
      try {
        if (all[index].playState === 'running') animations.push(animationOf(all[index]));
      } catch (error) {}
    }
  } catch (error) {}
  const layers = [];
  try {
    const children = document.body === null ? [] : document.body.children;
    for (let index = 0; index < children.length && layers.length < 20; index += 1) {
      const element = children[index];
      if (element === null || element === undefined) continue;
      const tag = clip(element.tagName, 40);
      const upper = tag === null ? '' : String(tag).toUpperCase();
      if (upper === 'SCRIPT' || upper === 'STYLE' || upper === 'LINK' || upper === 'TEMPLATE') continue;
      let position = 'unknown';
      try { position = String(getComputedStyle(element).position).slice(0, 20); } catch (error) {}
      layers.push({
        tag: tag === null ? 'unknown' : String(tag).toLowerCase(),
        id: clip(element.id, 60),
        className: clip(classNameOf(element).trim(), 160),
        position: position,
        children: typeof element.childElementCount === 'number' ? element.childElementCount : 0,
        attributes: attributesOf(element),
      });
    }
  } catch (error) {}
  let focused = null;
  let reducedMotion = null;
  let elements = null;
  try { focused = typeof document.hasFocus === 'function' ? document.hasFocus() === true : null; } catch (error) {}
  try { reducedMotion = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)').matches === true : null; } catch (error) {}
  try { elements = document.getElementsByTagName('*').length; } catch (error) {}
  return {
    view: {
      visibility: clip(document.visibilityState, 20),
      focused: focused,
      reducedMotion: reducedMotion,
      width: typeof innerWidth === 'number' ? innerWidth : null,
      height: typeof innerHeight === 'number' ? innerHeight : null,
      devicePixelRatio: typeof devicePixelRatio === 'number' ? devicePixelRatio : null,
    },
    dom: { elements: elements },
    animations: animations,
    animationsTotal: animationsTotal,
    layers: layers,
    frameLoop: {
      frames: frames,
      elapsedMs: Math.round(elapsed * 10) / 10,
      framesPerSecond: elapsed > 0 ? Math.round((frames / elapsed) * 1000) : 0,
      sampledBy: sampledBy,
    },
    longTasks: observer === null ? null : { count: longTaskCount, totalMs: Math.round(longTaskMs * 10) / 10 },
  };
})()`
}

/**
 * Sample the main window for the diagnostics export.
 * @param target - the page's `WebContents`, or undefined when no window exists.
 * @param options - sampling window and timeout, both in milliseconds.
 * @returns the snapshot, or the reason the page could not be sampled.
 */
export async function collectRendererDiagnostics(
  target: RendererDiagnosticsTarget | undefined,
  options: { sampleMs?: number; timeoutMs?: number } = {},
): Promise<RendererDiagnostics> {
  if (target === undefined) return { available: false, reason: 'no-window' }
  try {
    if (target.isDestroyed()) return { available: false, reason: 'no-window' }
  } catch {
    return { available: false, reason: 'no-window' }
  }
  const sampleMs = options.sampleMs ?? RENDERER_SAMPLE_MS
  const timeoutMs = options.timeoutMs ?? RENDERER_SAMPLE_TIMEOUT_MS
  let pending: Promise<unknown>
  try {
    pending = target.executeJavaScript(rendererDiagnosticsProbe(sampleMs))
  } catch (error) {
    return { available: false, reason: 'error', detail: describe(error) }
  }
  // Never leave a rejection unobserved: the timeout can win this race and the renderer
  // answer would then land with no handler attached.
  const settled = pending.then((value) => ({ value }), (error: unknown) => ({ error }))
  let cancelTimeout = (): void => {}
  const timedOut = new Promise<undefined>((resolve) => {
    const timer = setTimeout(resolve, Math.max(1, timeoutMs))
    cancelTimeout = () => clearTimeout(timer)
  })
  try {
    const outcome = await Promise.race([settled, timedOut])
    if (outcome === undefined) return { available: false, reason: 'timeout' }
    if ('error' in outcome) return { available: false, reason: 'error', detail: describe(outcome.error) }
    return snapshotOf(outcome.value, sampleMs) ?? { available: false, reason: 'error', detail: 'unexpected renderer snapshot' }
  } finally {
    cancelTimeout()
  }
}

/**
 * Compact evidence for the readable log; the export itself keeps the full sample.
 * @param renderer - the collected sample.
 * @returns log fields, or the reason sampling was unavailable.
 */
export function rendererDiagnosticsFields(renderer: RendererDiagnostics): Record<string, string | number | boolean | null> {
  if (!renderer.available) {
    return { available: false, reason: renderer.reason, ...(renderer.detail === undefined ? {} : { detail: renderer.detail }) }
  }
  return {
    available: true,
    animations: renderer.animations.length,
    animationsTotal: renderer.animationsTotal,
    layers: renderer.layers.length,
    framesPerSecond: renderer.frameLoop.framesPerSecond,
    sampledBy: renderer.frameLoop.sampledBy,
    focused: renderer.view.focused,
    reducedMotion: renderer.view.reducedMotion,
    visibility: renderer.view.visibility,
    longTasks: renderer.longTasks === null ? null : renderer.longTasks.count,
  }
}

function describe(error: unknown): string {
  return maskSecrets(error instanceof Error ? error.message : String(error)).slice(0, MAX_DETAIL)
}

function recordOf(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function textOf(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === 'string' ? value.slice(0, max) : null
}

function numberOrNull(value: unknown, digits = 0): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function countOf(value: unknown): number | null {
  const number = numberOrNull(value)
  return number !== null && number >= 0 ? number : null
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Rebuild the snapshot from the page's answer, clipping anything the page got wrong. */
function snapshotOf(value: unknown, sampleMs: number): RendererDiagnosticsSnapshot | undefined {
  const source = recordOf(value)
  const view = source === undefined ? undefined : recordOf(source.view)
  const frameLoop = source === undefined ? undefined : recordOf(source.frameLoop)
  if (view === undefined || frameLoop === undefined) return undefined
  const dom = source === undefined ? undefined : recordOf(source.dom)
  const longTasks = source === undefined ? undefined : recordOf(source.longTasks)
  return {
    available: true,
    sampledAt: new Date().toISOString(),
    sampleMs: Math.round(Number.isFinite(sampleMs) ? Math.max(0, sampleMs) : RENDERER_SAMPLE_MS),
    view: {
      visibility: textOf(view.visibility, 20) ?? 'unknown',
      focused: booleanOrNull(view.focused),
      reducedMotion: booleanOrNull(view.reducedMotion),
      width: numberOrNull(view.width),
      height: numberOrNull(view.height),
      devicePixelRatio: numberOrNull(view.devicePixelRatio, 2),
    },
    dom: { elements: countOf(dom?.elements) },
    animations: animationsOf(source?.animations),
    animationsTotal: countOf(source?.animationsTotal) ?? 0,
    layers: layersOf(source?.layers),
    frameLoop: {
      frames: countOf(frameLoop.frames) ?? 0,
      elapsedMs: numberOrNull(frameLoop.elapsedMs, 1) ?? 0,
      framesPerSecond: countOf(frameLoop.framesPerSecond) ?? 0,
      sampledBy: frameLoop.sampledBy === 'timer' ? 'timer' : 'raf',
    },
    longTasks: longTasks === undefined ? null : { count: countOf(longTasks.count) ?? 0, totalMs: numberOrNull(longTasks.totalMs, 1) ?? 0 },
  }
}

function animationsOf(value: unknown): RendererAnimation[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_ANIMATIONS).flatMap((entry) => {
    const animation = recordOf(entry)
    if (animation === undefined) return []
    const name = textOf(animation.name, 120) ?? 'unknown'
    return [{
      name,
      target: textOf(animation.target, MAX_TEXT) ?? 'unknown',
      pseudo: textOf(animation.pseudo, 40),
      iterations: numberOrNull(animation.iterations, 2),
      infinite: animation.infinite === true,
      currentTime: numberOrNull(animation.currentTime, 1),
    }]
  })
}

function layersOf(value: unknown): RendererLayer[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, MAX_LAYERS).flatMap((entry) => {
    const layer = recordOf(entry)
    if (layer === undefined) return []
    return [{
      tag: textOf(layer.tag, 40) ?? 'unknown',
      id: textOf(layer.id, 60),
      className: textOf(layer.className, 160),
      position: textOf(layer.position, 20) ?? 'unknown',
      children: countOf(layer.children) ?? 0,
      attributes: attributesOf(layer.attributes),
    }]
  })
}

function attributesOf(value: unknown): Record<string, string> {
  const source = recordOf(value)
  if (source === undefined) return {}
  return Object.fromEntries(Object.entries(source).slice(0, 8).flatMap(([name, attribute]) => {
    const key = textOf(name, 60)
    const content = textOf(attribute, 120)
    return key === null || content === null ? [] : [[key, content]]
  }))
}
