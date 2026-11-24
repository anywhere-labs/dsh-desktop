/**
 * Badge the browser tab's icon with the most urgent state across the session strip, so a page in the background still
 * says it needs attention. Only ordinary browser pages carry a tab icon; the desktop window has none.
 *
 * The badge is static on purpose: browsers do not animate icons reliably, and background timers are throttled.
 */
import type { TabSignal } from './session-tabs.ts'

/** The states that badge the icon, with the colours read from the strip's theme. */
export interface IconSignal {
  readonly state: TabSignal
  readonly accent: string
  readonly warn: string
}

/** A source of the strip's current signal. */
export interface IconSignalSource {
  get(): IconSignal | undefined
  subscribe(listener: () => void): () => void
}

const MARK = 'data-desktop-next-session-tabs-icon'
const BADGED: ReadonlySet<TabSignal> = new Set(['awaiting', 'running', 'unread', 'connecting'])

/**
 * Whether a signal changes the icon.
 * @param signal - the strip's current signal.
 */
export const badges = (signal: IconSignal | undefined): signal is IconSignal => signal !== undefined && BADGED.has(signal.state)

/**
 * The icon link a badge is drawn from: one whose `media` matches, else one without `media`, else the first.
 * @param links - the page's icon links, in document order.
 * @param matches - whether a media query applies now.
 * @returns the link to read, or undefined for no links.
 */
export function chooseIconLink<L extends { getAttribute(name: string): string | null }>(
  links: readonly L[], matches: (media: string) => boolean,
): L | undefined {
  const fits = (link: L): boolean => {
    const media = link.getAttribute('media')
    return media === null || media === '' || matches(media)
  }
  return links.find(link => (link.getAttribute('media') ?? '') !== '' && fits(link)) ?? links.find(fits) ?? links[0]
}

/**
 * Draw the badge over the app icon, or alone when the icon cannot be read.
 * @returns a PNG data URL, or undefined without a 2D canvas.
 */
function draw(signal: IconSignal, base: HTMLImageElement | undefined): string | undefined {
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const g = canvas.getContext('2d')
  if (g === null) return undefined
  let cx = 32
  let cy = 32
  let r = 26
  if (base !== undefined) {
    try {
      g.drawImage(base, 0, 0, size, size)
      cx = 45; cy = 45; r = 18
      // Knock a clean gap into the app icon so the badge reads at 16px.
      g.globalCompositeOperation = 'destination-out'
      g.beginPath(); g.arc(cx, cy, r + 4, 0, Math.PI * 2); g.fill()
      g.globalCompositeOperation = 'source-over'
    } catch {
      g.clearRect(0, 0, size, size)
      cx = 32; cy = 32; r = 26
    }
  }
  const fill = (color: string, fallback: string): void => { g.fillStyle = fallback; if (color !== '') g.fillStyle = color }
  const dot = (x: number, y: number, radius: number): void => { g.beginPath(); g.arc(x, y, radius, 0, Math.PI * 2); g.fill() }
  const bar = (x: number, y: number, w: number, h: number): void => {
    g.beginPath()
    if (typeof g.roundRect === 'function') g.roundRect(x, y, w, h, w / 2)
    else g.rect(x, y, w, h)
    g.fill()
  }
  if (signal.state === 'awaiting') {
    fill(signal.warn, '#e5a00d'); dot(cx, cy, r)
    g.fillStyle = '#fff'
    bar(cx - r * 0.14, cy - r * 0.6, r * 0.28, r * 0.72)
    dot(cx, cy + r * 0.45, r * 0.15)
  } else if (signal.state === 'unread') {
    fill(signal.accent, '#3a6df0'); dot(cx, cy, r)
  } else if (signal.state === 'running') {
    fill(signal.accent, '#3a6df0')
    const w = r * 0.42
    const gap = r * 0.2
    const bottom = cy + r * 0.85
    ;[0.95, 1.7, 1.25].forEach((k, i) => { bar(cx - w * 1.5 - gap + i * (w + gap), bottom - r * k, w, r * k) })
  } else {
    g.fillStyle = '#8a8f99'
    for (const k of [-0.62, 0, 0.62]) dot(cx + r * k, cy, r * 0.24)
  }
  try { return canvas.toDataURL('image/png') } catch { return undefined }
}

/**
 * Keep the page's icon badged while the strip reports something, and restore it otherwise.
 * @param source - the strip's signal.
 * @param applies - whether this page has a browser tab icon at all.
 * @returns the teardown, which restores the original icons.
 */
export function installIconBadge(source: IconSignalSource, applies: () => boolean): () => void {
  const head = document.head
  if (typeof MutationObserver !== 'function') return () => {}
  const originals = new Map<HTMLLinkElement, string | null>()
  const images = new Map<string, { readonly image: HTMLImageElement; ready: boolean }>()
  const cache = new Map<string, string | undefined>()
  let own: HTMLLinkElement | undefined
  let observer: MutationObserver | undefined
  let render = (): void => {}
  const hostLinks = (): HTMLLinkElement[] => [...head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]')].filter(link => !link.hasAttribute(MARK))
  const absolute = (href: string | null): string => {
    try { return new URL(href ?? '/favicon.ico', document.baseURI).href } catch { return href ?? '' }
  }
  const settle = (): void => { observer?.takeRecords() }
  const restore = (): void => {
    for (const [link, href] of originals) {
      if (!link.isConnected) continue
      if (href === null) link.removeAttribute('href')
      else link.setAttribute('href', href)
    }
    originals.clear()
    own?.remove()
    own = undefined
    settle()
  }
  const imageFor = (src: string): { readonly image: HTMLImageElement; ready: boolean } => {
    const known = images.get(src)
    if (known !== undefined) return known
    const image = new Image()
    const entry = { image, ready: false }
    images.set(src, entry)
    image.onload = () => { entry.ready = true; render() }
    image.onerror = () => { entry.ready = false }
    image.src = src
    return entry
  }
  const badged = (signal: IconSignal, src: string): string | undefined => {
    const base = imageFor(src)
    const key = `${signal.state}|${signal.accent}|${signal.warn}|${src}|${String(base.ready)}`
    if (!cache.has(key)) {
      if (cache.size > 48) cache.clear()
      cache.set(key, draw(signal, base.ready ? base.image : undefined))
    }
    return cache.get(key)
  }
  render = () => {
    const signal = source.get()
    if (!badges(signal) || !applies()) {
      if (originals.size > 0 || own !== undefined) restore()
      return
    }
    const links = hostLinks()
    if (links.length > 0) {
      own?.remove()
      own = undefined
      for (const link of links) if (!originals.has(link)) originals.set(link, link.getAttribute('href'))
      // Pick the variant for the current colour scheme here and give every link that one result, so it is right
      // whether or not the browser honours media on icon links.
      const chosen = chooseIconLink(links, media => { try { return window.matchMedia(media).matches } catch { return false } })
      const url = chosen === undefined ? undefined : badged(signal, absolute(originals.get(chosen) ?? null))
      if (url !== undefined) for (const link of links) if (link.getAttribute('href') !== url) link.setAttribute('href', url)
    } else {
      const url = badged(signal, absolute('/favicon.ico'))
      if (url !== undefined) {
        if (own === undefined) {
          own = document.createElement('link')
          own.rel = 'icon'
          own.setAttribute(MARK, '')
          head.append(own)
        }
        if (own.getAttribute('href') !== url) own.setAttribute('href', url)
      }
    }
    settle()
  }
  // The page may swap its own icon (theme, route): adopt the new one as the base and badge it again.
  observer = new MutationObserver(records => {
    let touched = false
    for (const record of records) {
      const target = record.target
      if (record.type === 'attributes' && target instanceof HTMLLinkElement && originals.has(target)) {
        originals.set(target, target.getAttribute('href'))
        touched = true
      } else if (record.type === 'childList') touched = true
    }
    if (touched) render()
  })
  observer.observe(head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] })
  const unsubscribe = source.subscribe(render)
  const scheme = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined
  const onScheme = (): void => { render() }
  scheme?.addEventListener('change', onScheme)
  render()
  return () => {
    unsubscribe()
    scheme?.removeEventListener('change', onScheme)
    observer?.disconnect()
    observer = undefined
    restore()
  }
}
