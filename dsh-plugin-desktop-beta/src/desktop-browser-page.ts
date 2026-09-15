/**
 * One Chromium guest page driven through allowlisted Chrome DevTools Protocol
 * commands.
 *
 * The Electron main process owns the physical view; this module owns everything
 * above it: navigation with a load barrier, the accessibility snapshot the
 * Agent reads, pointer and keyboard input, console capture, and page
 * evaluation. It never touches Electron directly, so it runs under a unit test
 * against a scripted `DesktopNativeBrowser` double.
 */

import type { DesktopNativeBrowser, DesktopNativeBrowserEvent } from './browser-view-service.ts'

/** Default action budget, matching the Playwright-compatible plugin contract. */
export const BROWSER_ACTION_TIMEOUT = 10_000

/** Default navigation budget for one top-level document. */
export const BROWSER_NAVIGATION_TIMEOUT = 30_000
/** Budget for the blank document that gives a fresh guest view its renderer. */
export const BROWSER_BLANK_DOCUMENT_TIMEOUT = 5_000
/** Budget of one CDP round trip; a stalled renderer must not hold the action queue. */
export const BROWSER_CDP_TIMEOUT = 8_000
/** Error code reported when a CDP round trip outlives its budget. */
export const DESKTOP_BROWSER_CDP_STALL = 'BROWSER_CDP_STALL'

/** Node bound on one accessibility snapshot so a deep page cannot flood the Agent. */
const AX_NODE_LIMIT = 600

/** Character bound on one accessibility snapshot. */
const AX_CHAR_LIMIT = 20_000

/** Character bound on one console or evaluation result. */
const TEXT_LIMIT = 24_000

/** Chromium modifier bits used by `Input.dispatchKeyEvent`. */
const MODIFIER_BITS = Object.freeze({ Alt: 1, Control: 2, Meta: 4, Shift: 8 })

/** Keys addressable by name rather than by character. */
const KEY_TABLE: Readonly<Record<string, { code: string; keyCode: number; text?: string }>> = Object.freeze({
  Enter: { code: 'Enter', keyCode: 13, text: '\r' },
  Tab: { code: 'Tab', keyCode: 9, text: '\t' },
  Escape: { code: 'Escape', keyCode: 27 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  Insert: { code: 'Insert', keyCode: 45 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
  PageUp: { code: 'PageUp', keyCode: 33 },
  PageDown: { code: 'PageDown', keyCode: 34 },
  Space: { code: 'Space', keyCode: 32, text: ' ' },
  Shift: { code: 'ShiftLeft', keyCode: 16 },
  Control: { code: 'ControlLeft', keyCode: 17 },
  Alt: { code: 'AltLeft', keyCode: 18 },
  Meta: { code: 'MetaLeft', keyCode: 91 },
  F5: { code: 'F5', keyCode: 116 },
})

/** Logical CSS viewport used until the panel reports its real rectangle. */
export const DEFAULT_DESKTOP_BROWSER_VIEWPORT = Object.freeze({ width: 1280, height: 800 })

/** One console message kept for the Agent and the panel. */
export interface DesktopBrowserConsoleEntry {
  readonly level: string
  readonly text: string
  /** Monotonic sequence number; the panel reads everything above its cursor. */
  readonly seq: number
}

/** One entry of a tab's own navigation history. */
export interface DesktopBrowserHistoryEntry {
  readonly url: string
  readonly title: string
  readonly at: number
}

/** A numeric rectangle in renderer CSS pixels. */
export interface DesktopBrowserRect {
  x: number
  y: number
  width: number
  height: number
}

/** Observable state of one guest page. */
export interface DesktopBrowserPageState {
  readonly tabId: string
  readonly url: string
  readonly title: string
  readonly loading: boolean
  /** URL of the main-frame document Chromium is showing. */
  readonly frameUrl: string
}

/** One accessibility node rendered for the Agent. */
export interface DesktopBrowserSnapshot {
  readonly url: string
  readonly title: string
  readonly text: string
  /** Node budget consumed by this snapshot. */
  readonly nodes: number
  /** Whether the node or character budget cut the snapshot short. */
  readonly truncated: boolean
}

/** Inputs the page needs to decide whether a command may run. */
export interface DesktopBrowserPageOptions {
  readonly service: DesktopNativeBrowser
  /** Guest view id, unique inside the desktop window. */
  readonly viewId: string
  /** Owner string used by `closeOwner`. */
  readonly owner: string
  /** Deployment-wide top-level navigation allowlist. */
  readonly allowOrigins?: readonly string[] | undefined
  /** Sink for non-fatal native failures. */
  readonly report?: (message: string) => void
  /**
   * Give the guest view a rectangle as soon as it exists. A view that is never
   * placed spawns no renderer, and every CDP command would wait forever.
   */
  readonly onViewCreated?: () => Promise<void> | void
  /** Notified whenever observable state changes; the owner decides what to dedupe. */
  readonly onChange?: () => void
}

/** CDP result of `Runtime.evaluate` with `returnByValue`. */
interface RemoteObject {
  readonly type?: string
  readonly subtype?: string
  readonly value?: unknown
  readonly unserializableValue?: string
  readonly objectId?: string
  readonly description?: string
}

interface EvaluateResult {
  readonly result?: RemoteObject
  readonly exceptionDetails?: { readonly text?: string; readonly exception?: { readonly description?: string } }
}

/** Page-level notifications a tab store reacts to. */
export type DesktopBrowserPageEvent =
  | { readonly type: 'failed'; readonly message: string }
  | { readonly type: 'closed' }
  | { readonly type: 'window-open'; readonly url: string }
  | { readonly type: 'console'; readonly message: string }

interface AxNode {
  readonly nodeId?: string
  readonly ignored?: boolean
  readonly role?: { readonly value?: string }
  readonly name?: { readonly value?: string }
  readonly value?: { readonly value?: string }
  readonly childIds?: readonly string[]
  readonly backendDOMNodeId?: number
}

/** Unserializable CDP return values that survive `returnByValue`. */
function byValue(result: RemoteObject | undefined): unknown {
  if (result === undefined || result === null) return undefined
  if (result.unserializableValue === undefined) return result.value
  switch (result.unserializableValue) {
    case 'NaN': return Number.NaN
    case 'Infinity': return Number.POSITIVE_INFINITY
    case '-Infinity': return Number.NEGATIVE_INFINITY
    case '-0': return -0
    default: return result.unserializableValue
  }
}

/** One line of console text from a `Runtime.consoleAPICalled` argument list. */
function consoleText(args: readonly RemoteObject[] = []): string {
  return args.map((argument) => {
    if (argument === undefined || argument === null) return ''
    if (argument.unserializableValue !== undefined) return String(argument.unserializableValue)
    if (argument.value !== undefined) {
      return typeof argument.value === 'string' ? argument.value : JSON.stringify(argument.value)
    }
    if (argument.description !== undefined) return String(argument.description)
    return String(argument.type ?? '')
  }).join(' ')
}

/** The first line of one `Runtime.exceptionThrown` payload. */
function exceptionMessage(details: { readonly text?: string; readonly exception?: { readonly description?: string } } | undefined): string {
  const description = details?.exception?.description
  if (typeof description === 'string' && description.trim() !== '') return description.split('\n')[0]!.trim()
  return String(details?.text ?? 'page error')
}

/** One AX name rendered inside the snapshot: single line, no padding noise. */
function axName(value: string): string {
  return value.replaceAll(/\s+/gu, ' ').trim()
}

/**
 * Render a CDP accessibility tree as one `- role "name"` line per node.
 * @param nodes - full node list of one `Accessibility.getFullAXTree` answer.
 * @returns the rendered tree together with its node count and truncation flag.
 */
export function renderAccessibilityTree(nodes: readonly AxNode[]): { text: string; nodes: number; truncated: boolean } {
  const byId = new Map<string, AxNode>()
  for (const node of nodes) if (node.nodeId !== undefined) byId.set(node.nodeId, node)
  const roots = nodes.filter(node => !nodes.some(candidate => candidate.childIds?.includes(node.nodeId ?? '')))
  const lines: string[] = []
  let count = 0
  let truncated = false
  const walk = (node: AxNode, depth: number): void => {
    if (truncated) return
    count += 1
    if (count > AX_NODE_LIMIT) {
      truncated = true
      return
    }
    const role = node.role?.value ?? ''
    const name = axName(node.name?.value ?? '')
    const value = axName(node.value?.value ?? '')
    const children = (node.childIds ?? []).map(id => byId.get(id)).filter((child): child is AxNode => child !== undefined)
    if (node.ignored !== true && (name !== '' || value !== '')) {
      const indent = '  '.repeat(Math.max(0, depth))
      const suffix = value === '' ? '' : ` value="${value}"`
      lines.push(`${indent}- ${role === '' ? 'generic' : role}${name === '' ? '' : ` "${name}"`}${suffix}`)
      depth += 1
    }
    for (const child of children) walk(child, depth)
    if (lines.join('\n').length > AX_CHAR_LIMIT) truncated = true
  }
  for (const root of roots.length > 0 ? roots : nodes) walk(root, 0)
  let text = lines.join('\n')
  if (text.length > AX_CHAR_LIMIT) {
    text = text.slice(0, AX_CHAR_LIMIT)
    truncated = true
  }
  return { text, nodes: Math.min(count, AX_NODE_LIMIT), truncated }
}

/** One element target: a CSS selector, or a role with its accessible name. */
export interface DesktopBrowserLocator {
  readonly selector?: string
  readonly role?: string
  readonly name?: string
}

/** Human-readable form of one locator, used in failure messages. */
export function describeLocator(locator: DesktopBrowserLocator): string {
  if (locator.selector !== undefined) return locator.selector
  return [locator.role, locator.name === undefined ? undefined : JSON.stringify(locator.name)]
    .filter(part => part !== undefined)
    .join(' ')
}

/**
 * Build the page expression that resolves one locator to a single element.
 *
 * Role matching follows the implicit HTML role of the common interactive
 * elements, then falls back to an explicit `role` attribute, so a snapshot line
 * such as `- button "Sign in"` is directly actionable.
 * @param locator - selector or role/name pair from the Agent.
 * @returns a JavaScript expression evaluating to one element or `null`.
 */
export function elementExpression(locator: DesktopBrowserLocator): string {
  if (locator.selector !== undefined) return `document.querySelector(${JSON.stringify(locator.selector)})`
  const role = locator.role ?? ''
  const name = locator.name ?? ''
  return `(() => {
    const role = ${JSON.stringify(role)}
    const wanted = ${JSON.stringify(name)}
    const implicit = {
      button: 'button,input[type=button],input[type=submit],input[type=reset]',
      link: 'a[href]',
      textbox: 'input:not([type]),input[type=text],input[type=search],input[type=email],input[type=url],input[type=tel],input[type=password],textarea,[contenteditable=true]',
      checkbox: 'input[type=checkbox]',
      radio: 'input[type=radio]',
      combobox: 'select',
      img: 'img',
      heading: 'h1,h2,h3,h4,h5,h6',
    }
    const explicit = role === '' ? '' : '[role=' + JSON.stringify(role) + ']'
    const selector = [implicit[role], explicit].filter(Boolean).join(',')
    const candidates = selector === '' ? [] : Array.from(document.querySelectorAll(selector))
    const accessibilityName = element => {
      const labelled = element.getAttribute('aria-label')
      if (labelled) return labelled.trim()
      const labelledBy = element.getAttribute('aria-labelledby')
      if (labelledBy) {
        const target = document.getElementById(labelledBy)
        if (target) return (target.textContent || '').trim()
      }
      const placeholder = element.getAttribute('placeholder')
      if (placeholder) return placeholder.trim()
      const alt = element.getAttribute('alt')
      if (alt) return alt.trim()
      const title = element.getAttribute('title')
      if (title) return title.trim()
      if (typeof element.value === 'string' && element.value !== '') return element.value.trim()
      return (element.textContent || '').replaceAll(/\\s+/g, ' ').trim()
    }
    const visible = element => {
      const rect = element.getBoundingClientRect()
      if (rect.width < 1 || rect.height < 1) return false
      const style = getComputedStyle(element)
      return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
    }
    const named = candidates.filter(element => wanted === '' || accessibilityName(element) === wanted)
    const exact = named.find(visible)
    if (exact) return exact
    if (wanted === '') return null
    return candidates.filter(element => accessibilityName(element).includes(wanted)).find(visible) || null
  })()`
}

/** The key descriptor of one `press` name, including a single character. */
export function keyDescriptor(input: string): { code: string; keyCode: number; text?: string; key: string } {
  const entry = KEY_TABLE[input]
  if (entry !== undefined) return { ...entry, key: input }
  const character = [...input][0] ?? ''
  if (character === '') throw new Error('BROWSER_INVALID_KEY: an empty key cannot be pressed')
  const upper = character.toUpperCase()
  return { code: `Key${upper}`, keyCode: upper.charCodeAt(0), text: character, key: character }
}

/**
 * Split `Control+A` into a key name and a CDP modifier bitmask.
 * @param input - chord such as `Control+Shift+A`.
 * @returns the remaining key and its modifier bits.
 */
export function parsePress(input: string): { modifiers: number; key: string } {
  const parts = input.split('+').map(part => part.trim()).filter(part => part !== '')
  let modifiers = 0
  let key = parts.pop() ?? ''
  for (const part of parts) {
    const normalized = part === 'Cmd' || part === 'Command' || part === 'Meta' ? 'Meta'
      : part === 'Ctrl' || part === 'Control' ? 'Control'
        : part === 'Option' || part === 'Alt' ? 'Alt'
          : part === 'Shift' ? 'Shift'
            : part
    const bit = MODIFIER_BITS[normalized as keyof typeof MODIFIER_BITS]
    if (bit === undefined) throw new Error(`BROWSER_INVALID_KEY: ${part} is not a modifier`)
    modifiers |= bit
  }
  if (key === '') throw new Error('BROWSER_INVALID_KEY: a chord needs a key')
  return { modifiers, key }
}

/** Redact one long text result the way the browser panel does. */
export function redactText(input: string, limit = TEXT_LIMIT): string {
  return input.length <= limit ? input : `${input.slice(0, limit)}\n… (${String(input.length - limit)} more characters)`
}

/** One guest page: a view id, its state, and every page-level operation. */
export class DesktopBrowserPage {
  private readonly service: DesktopNativeBrowser
  private readonly viewId: string
  private readonly owner: string
  private readonly allowOrigins: readonly string[] | undefined
  private readonly report: (message: string) => void
  private readonly onChange: () => void
  private readonly onViewCreated: () => Promise<void> | void
  private readonly consoleEntries: DesktopBrowserConsoleEntry[] = []
  private readonly history: DesktopBrowserHistoryEntry[] = []
  private readonly listeners = new Set<(event: DesktopBrowserPageEvent) => void>()
  private loadWaiter: { resolve: (outcome: 'load' | 'failed' | 'timeout' | 'closed') => void; timer: ReturnType<typeof setTimeout> } | undefined
  private sequence = 0
  private enabled = false
  private closed = false
  private currentUrl = 'about:blank'
  private currentTitle = ''
  private loading = false
  private failure: string | undefined

  constructor(options: DesktopBrowserPageOptions) {
    this.service = options.service
    this.viewId = options.viewId
    this.owner = options.owner
    this.allowOrigins = options.allowOrigins
    this.report = options.report ?? (() => {})
    this.onChange = options.onChange ?? (() => {})
    this.onViewCreated = options.onViewCreated ?? (() => {})
  }

  /** Guest view id inside the desktop window. */
  get id(): string { return this.viewId }

  /** Owner string registered with the native service. */
  get viewOwner(): string { return this.owner }

  /** Last reported failure code, cleared by the next accepted navigation. */
  get lastFailure(): string | undefined { return this.failure }

  /** Observable state for the panel and the Agent. */
  get state(): DesktopBrowserPageState {
    return { tabId: this.viewId, url: this.currentUrl, title: this.currentTitle, loading: this.loading, frameUrl: this.currentUrl }
  }

  /** Console and page-error lines captured so far, oldest first. */
  get console(): readonly DesktopBrowserConsoleEntry[] { return this.consoleEntries }

  /** Pages this view visited, newest first. */
  get visits(): readonly DesktopBrowserHistoryEntry[] { return this.history }

  /** Create the underlying view and attach the event subscription. */
  async open(url = 'about:blank'): Promise<void> {
    await this.service.createView({
      id: this.viewId,
      owner: this.owner,
      ...(this.allowOrigins === undefined ? {} : { allowOrigins: [...this.allowOrigins] }),
    })
    this.unsubscribe = this.service.subscribe(event => { this.handle(event) })
    await this.onViewCreated?.()
    // A guest view without a document has no renderer, and the protocol never
    // answers a command sent to one; commit a blank document before enabling.
    const blank = this.waitForLoad(BROWSER_BLANK_DOCUMENT_TIMEOUT)
    await this.service.navigate(this.viewId, 'about:blank')
    await blank
    await this.enable()
    if (url !== 'about:blank') await this.goto(url)
  }

  private unsubscribe: (() => void) | undefined

  /** Enable the CDP domains one page needs, exactly once per view. */
  private async enable(): Promise<void> {
    if (this.enabled) return
    await this.cdp('Page.enable')
    await this.cdp('Runtime.enable')
    this.enabled = true
  }

  /** Run one allowlisted CDP command against this view. */
  private async cdp<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed) throw new Error('BROWSER_TAB_CLOSED: this tab is no longer open')
    // A protocol command must never outlive the caller's own budget: a wedged
    // renderer would otherwise hold this Session's whole action queue.
    const answer = await withDeadline(
      this.service.command(this.viewId, method, params) as Promise<T>,
      BROWSER_CDP_TIMEOUT,
      `${DESKTOP_BROWSER_CDP_STALL}: ${method} did not answer within ${String(BROWSER_CDP_TIMEOUT)}ms`,
    )
    return answer
  }

  /** Route one native service event into page state. */
  private handle(event: DesktopNativeBrowserEvent): void {
    if (event.id !== this.viewId) return
    switch (event.type) {
      case 'navigated':
        this.currentUrl = event.url
        this.settle('load')
        this.remember()
        break
      case 'title':
        this.currentTitle = event.title
        break
      case 'loading':
        this.loading = event.loading
        if (!event.loading) this.settle('load')
        break
      case 'failed':
        this.failure = event.error
        this.consoleEntries.push({ level: 'error', text: `navigation failed: ${event.url} ${event.error}`, seq: ++this.sequence })
        this.settle('failed')
        this.emit({ type: 'failed', message: `${event.url} ${event.error}` })
        break
      case 'closed':
        this.closed = true
        this.settle('closed')
        this.emit({ type: 'closed' })
        break
      case 'window-open':
        this.emit({ type: 'window-open', url: event.url })
        break
      case 'cdp':
        this.forward(event.method, event.params)
        break
      default:
        break
    }
    this.onChange()
  }

  /** Record the current document in this view's visit log. */
  private remember(): void {
    if (!this.currentUrl.startsWith('http')) return
    const existing = this.history[0]
    if (existing?.url === this.currentUrl) return
    this.history.unshift({ url: this.currentUrl, title: this.currentTitle, at: Date.now() })
    if (this.history.length > 64) this.history.length = 64
  }

  /** Forward the CDP events the panel and the Agent consume. */
  private forward(method: string, params: unknown): void {
    const payload = (params ?? {}) as Record<string, unknown>
    if (method === 'Runtime.consoleAPICalled') {
      const entry: DesktopBrowserConsoleEntry = {
        level: String(payload.type ?? 'log'),
        text: consoleText(payload.args as RemoteObject[] | undefined),
        seq: ++this.sequence,
      }
      this.consoleEntries.push(entry)
      if (this.consoleEntries.length > 200) this.consoleEntries.splice(0, this.consoleEntries.length - 200)
      this.emit({ type: 'console', message: entry.text })
    } else if (method === 'Runtime.exceptionThrown') {
      const text = exceptionMessage(payload.exceptionDetails as { text?: string } | undefined)
      this.consoleEntries.push({ level: 'error', text, seq: ++this.sequence })
      this.emit({ type: 'console', message: text })
    } else if (method === 'Page.loadEventFired') {
      this.settle('load')
    }
  }

  /** Resolve the pending load barrier, if any. */
  private settle(outcome: 'load' | 'failed' | 'timeout' | 'closed'): void {
    const waiter = this.loadWaiter
    if (waiter === undefined) return
    this.loadWaiter = undefined
    clearTimeout(waiter.timer)
    waiter.resolve(outcome)
  }

  /** Wait for the main-frame load event, or report the deadline. */
  private waitForLoad(timeout: number): Promise<'load' | 'failed' | 'timeout' | 'closed'> {
    this.settle('timeout')
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        if (this.loadWaiter?.timer === timer) this.loadWaiter = undefined
        resolve('timeout')
      }, timeout)
      this.loadWaiter = { resolve, timer }
    })
  }

  /** Event sink for page-level observers such as the tab store. */
  onEvent(listener: (event: DesktopBrowserPageEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Page-level notifications, translated from the service's own event shapes. */
  private emit(event: DesktopBrowserPageEvent): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch (cause) {
        this.report(`browser page listener failed: ${cause instanceof Error ? cause.message : String(cause)}`)
      }
    }
  }

  /**
   * Normalize one top-level navigation target.
   * @param input - user- or Agent-supplied URL, with or without a scheme.
   * @returns the URL to load.
   */
  navigationTarget(input: string): string {
    const raw = input.trim()
    if (raw === '') throw new Error('BROWSER_INVALID_URL: an empty address cannot be opened')
    const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(raw) ? raw : `https://${raw}`
    let url: URL
    try {
      url = new URL(candidate)
    } catch {
      throw new Error(`BROWSER_INVALID_URL: ${input}`)
    }
    const blank = url.protocol === 'about:' && url.href === 'about:blank'
    if (!blank && !['http:', 'https:'].includes(url.protocol)) throw new Error('BROWSER_HTTP_URL_REQUIRED: only http and https pages can be opened')
    if (url.username !== '' || url.password !== '') throw new Error('BROWSER_HTTP_URL_REQUIRED: credentials do not belong in an address')
    if (!blank && this.allowOrigins !== undefined && this.allowOrigins.length > 0 && !this.allowOrigins.includes(url.origin)) {
      throw new Error(`BROWSER_ORIGIN_DENIED: ${url.href}`)
    }
    return url.href
  }

  /** Load one address and wait for its main-frame load event. */
  async goto(input: string, timeout = BROWSER_NAVIGATION_TIMEOUT): Promise<DesktopBrowserPageState> {
    const target = this.navigationTarget(input)
    this.failure = undefined
    const barrier = this.waitForLoad(timeout)
    await this.service.navigate(this.viewId, target)
    await barrier
    return this.state
  }

  /** Reload the current document. */
  async reload(): Promise<DesktopBrowserPageState> {
    return await this.goto(this.currentUrl === '' ? 'about:blank' : this.currentUrl)
  }

  /** This view's own navigation history with its current position. */
  async navigationHistory(): Promise<{ entries: readonly { id: number; url: string; title: string }[]; index: number }> {
    await this.enable()
    const answer = await this.cdp<{ currentIndex?: number; entries?: readonly { id?: number; url?: string; title?: string; userTypedURL?: string }[] }>('Page.getNavigationHistory')
    const entries = (answer.entries ?? []).map(entry => ({
      id: entry.id ?? 0,
      url: entry.url ?? '',
      title: entry.title ?? entry.userTypedURL ?? '',
    }))
    return { entries, index: answer.currentIndex ?? Math.max(0, entries.length - 1) }
  }

  /**
   * Walk this view's own history one step.
   * @param offset - negative for back, positive for forward.
   * @returns whether a step happened.
   */
  async historyStep(offset: number): Promise<boolean> {
    const { entries, index } = await this.navigationHistory()
    const target = entries[index + offset]
    if (target === undefined) return false
    const barrier = this.waitForLoad(BROWSER_NAVIGATION_TIMEOUT)
    await this.cdp('Page.navigateToHistoryEntry', { entryId: target.id })
    await barrier
    return true
  }

  /** Run one allowlisted CDP command for an external caller such as the panel. */
  async command<T = unknown>(method: string, params?: unknown): Promise<T> {
    await this.enable()
    return await this.cdp<T>(method, params)
  }

  /** Evaluate one expression in the page and return its by-value result. */
  async evaluate(expression: string): Promise<unknown> {
    await this.enable()
    const answer = await this.cdp<EvaluateResult>('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })
    if (answer.exceptionDetails !== undefined) throw new Error(`BROWSER_EVALUATION_FAILED: ${exceptionMessage(answer.exceptionDetails)}`)
    return byValue(answer.result)
  }

  /** The page title, read from the live document rather than the cached event. */
  async title(): Promise<string> {
    const value = await this.evaluate('document.title')
    return typeof value === 'string' ? value : this.currentTitle
  }

  /** Every visible text node of the page, bounded for the Agent. */
  async visibleText(): Promise<string> {
    const value = await this.evaluate('document.body ? document.body.innerText : ""')
    return redactText(typeof value === 'string' ? value : '')
  }

  /** The accessibility snapshot the Agent reads for role-and-name targeting. */
  async snapshot(): Promise<DesktopBrowserSnapshot> {
    await this.enable()
    const tree = await this.cdp<{ nodes?: readonly AxNode[] }>('Accessibility.getFullAXTree')
    const rendered = renderAccessibilityTree(tree.nodes ?? [])
    return { url: this.currentUrl, title: await this.titleSafe(), text: rendered.text, nodes: rendered.nodes, truncated: rendered.truncated }
  }

  private async titleSafe(): Promise<string> {
    try {
      return await this.title()
    } catch {
      return this.currentTitle
    }
  }

  /** Resolve one element to a remote object id, or report that it is missing. */
  private async resolveObject(expression: string): Promise<string> {
    const answer = await this.cdp<{ result?: RemoteObject }>('Runtime.evaluate', {
      expression,
      returnByValue: false,
      awaitPromise: false,
    })
    const objectId = answer.result?.objectId
    if (objectId === undefined) throw new Error(`BROWSER_ELEMENT_NOT_FOUND: ${expression}`)
    const detail = await this.cdp<{ result?: RemoteObject }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: 'function () { return this === null || this === undefined; }',
      returnByValue: true,
    })
    if (detail.result?.value === true) throw new Error(`BROWSER_ELEMENT_NOT_FOUND: ${expression}`)
    return objectId
  }

  /**
   * Measure one element expression in the page.
   * @param expression - JavaScript expression evaluating to one element.
   * @returns its viewport-relative box, or `undefined` when it is missing or flat.
   */
  async boxFor(expression: string): Promise<DesktopBrowserRect | undefined> {
    await this.enable()
    let objectId: string
    try {
      objectId = await this.resolveObject(expression)
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('BROWSER_ELEMENT_NOT_FOUND')) return undefined
      throw cause
    }
    const answer = await this.cdp<{ result?: RemoteObject }>('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function () {
        const rect = this.getBoundingClientRect()
        if (rect.width < 1 || rect.height < 1) return null
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      }`,
      returnByValue: true,
    })
    const value = byValue(answer.result)
    if (value === null || typeof value !== 'object') return undefined
    return value as DesktopBrowserRect
  }

  /** The viewport-relative box of one CSS selector. */
  async boundingBox(selector: string): Promise<DesktopBrowserRect | undefined> {
    return await this.boxFor(`document.querySelector(${JSON.stringify(selector)})`)
  }

  /**
   * Click one element located by CSS selector or by role and accessible name.
   * @param locator - selector or role/name pair describing the target.
   * @returns the box that was clicked.
   */
  async clickTarget(locator: { selector?: string; role?: string; name?: string }): Promise<DesktopBrowserRect> {
    const expression = elementExpression(locator)
    const box = await this.boxFor(expression)
    if (box === undefined) throw new Error(`BROWSER_ELEMENT_NOT_VISIBLE: ${describeLocator(locator)}`)
    const x = box.x + box.width / 2
    const y = box.y + box.height / 2
    await this.click(x, y)
    return { x, y, width: box.width, height: box.height }
  }

  /**
   * Focus and clear one element, then type a value into it as real input.
   * @param locator - selector or role/name pair describing the field.
   * @param value - text to enter.
   */
  async fillTarget(locator: { selector?: string; role?: string; name?: string }, value: string): Promise<void> {
    await this.fill(elementExpression(locator), value)
  }

  /** Click one element by CSS selector, using a real pointer event at its center. */
  async clickElement(selector: string): Promise<DesktopBrowserRect> {
    return await this.clickTarget({ selector })
  }

  /** Move the pointer to one viewport coordinate. */
  async move(x: number, y: number): Promise<void> {
    await this.enable()
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: Math.round(x), y: Math.round(y), button: 'none', buttons: 0 })
  }

  /** Click one viewport coordinate. */
  async click(x: number, y: number, options: { button?: 'left' | 'right' | 'middle'; clickCount?: number } = {}): Promise<void> {
    await this.enable()
    const button = options.button ?? 'left'
    const clickCount = options.clickCount ?? 1
    const buttons = button === 'right' ? 2 : button === 'middle' ? 4 : 1
    const point = { x: Math.round(x), y: Math.round(y) }
    await this.move(point.x, point.y)
    await this.cdp('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button, buttons, clickCount })
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button, buttons: 0, clickCount })
  }

  /** Type text into the focused element, character by character. */
  async insertText(text: string): Promise<void> {
    await this.enable()
    await this.cdp('Input.insertText', { text })
  }

  /** Fill one element: focus it, clear it, then type the value as real input. */
  async fill(selector: string, value: string): Promise<void> {
    await this.enable()
    const objectId = await this.resolveObject(selector)
    await this.cdp('Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: `function () {
        if (typeof this.focus === 'function') this.focus()
        if (typeof this.select === 'function') this.select()
        if (typeof this.value === 'string') {
          const prototype = this instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
          const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set
          if (setter) setter.call(this, '')
          else this.value = ''
        } else if (this.isContentEditable === true) {
          this.textContent = ''
        }
        return true
      }`,
      returnByValue: true,
    })
    if (value !== '') await this.insertText(value)
  }

  /** Press one key or chord on the focused element. */
  async press(input: string): Promise<void> {
    await this.enable()
    const { modifiers, key } = parsePress(input)
    const descriptor = keyDescriptor(key)
    const base = { modifiers, key: descriptor.key, code: descriptor.code, windowsVirtualKeyCode: descriptor.keyCode, nativeVirtualKeyCode: descriptor.keyCode }
    if (descriptor.text === undefined && [...key].length === 1) {
      // A character key carries its text, which is what inserts into a field.
      await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', text: key, unmodifiedText: key, ...base })
    } else {
      await this.cdp('Input.dispatchKeyEvent', { type: 'keyDown', ...base, ...(descriptor.text === undefined ? {} : { text: descriptor.text, unmodifiedText: descriptor.text }) })
    }
    await this.cdp('Input.dispatchKeyEvent', { type: 'keyUp', ...base })
  }

  /** Scroll the page or one element by a wheel delta. */
  async scroll(deltaY: number, deltaX = 0, at?: { x: number; y: number }): Promise<void> {
    await this.enable()
    const viewport = await this.viewportSize()
    const point = at ?? { x: Math.round(viewport.width / 2), y: Math.round(viewport.height / 2) }
    await this.cdp('Input.dispatchMouseEvent', { type: 'mouseWheel', x: point.x, y: point.y, deltaX, deltaY, button: 'none', buttons: 0 })
  }

  /** The logical CSS viewport the page currently renders into. */
  async viewportSize(): Promise<{ width: number; height: number }> {
    const metrics = await this.cdp<{ cssLayoutViewport?: { clientWidth?: number; clientHeight?: number } }>('Page.getLayoutMetrics').catch(() => undefined)
    const viewport = metrics?.cssLayoutViewport
    const width = viewport?.clientWidth
    const height = viewport?.clientHeight
    if (typeof width === 'number' && typeof height === 'number' && width > 0 && height > 0) return { width, height }
    return { ...DEFAULT_DESKTOP_BROWSER_VIEWPORT }
  }

  /** Capture one JPEG screenshot of the current viewport. */
  async screenshot(options: { fullPage?: boolean; quality?: number } = {}): Promise<{ data: string; mediaType: 'image/jpeg' }> {
    await this.enable()
    const quality = options.quality ?? 70
    const answer = options.fullPage === true
      ? await this.captureBeyondViewport(quality)
      : await this.cdp<{ data?: string }>('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true })
    if (typeof answer.data !== 'string' || answer.data === '') throw new Error('BROWSER_SCREENSHOT_FAILED: the page produced no image')
    return { data: answer.data, mediaType: 'image/jpeg' }
  }

  private async captureBeyondViewport(quality: number): Promise<{ data?: string }> {
    const metrics = await this.cdp<{ contentSize?: { width?: number; height?: number } }>('Page.getLayoutMetrics').catch(() => undefined)
    const width = metrics?.contentSize?.width
    const height = metrics?.contentSize?.height
    if (typeof width !== 'number' || typeof height !== 'number' || width <= 0 || height <= 0) {
      return await this.cdp<{ data?: string }>('Page.captureScreenshot', { format: 'jpeg', quality, fromSurface: true })
    }
    // `captureBeyondViewport` is not in the allowlist, so the clip rectangle
    // carries the full document instead. Bounded so one huge page cannot
    // produce an unbounded image.
    const clipped = { x: 0, y: 0, width: Math.min(width, 4096), height: Math.min(height, 8192), scale: 1 }
    return await this.cdp<{ data?: string }>('Page.captureScreenshot', { format: 'jpeg', quality, clip: clipped, fromSurface: true })
  }

  /** The current page HTML, bounded for the Agent. */
  async content(): Promise<string> {
    const value = await this.evaluate('document.documentElement ? document.documentElement.outerHTML : ""')
    return redactText(typeof value === 'string' ? value : '')
  }

  /** The elements of one `evaluate` shape: title, visible text, links or layout. */
  async inspect(expression: 'title' | 'visible_text' | 'links' | 'layout'): Promise<unknown> {
    switch (expression) {
      case 'title':
        return await this.title()
      case 'visible_text':
        return await this.visibleText()
      case 'links':
        return await this.evaluate(`Array.from(document.querySelectorAll('a[href]')).slice(0, 200).map(a => ({ text: (a.textContent || '').trim().slice(0, 120), href: a.href }))`)
      case 'layout':
        return await this.evaluate(`(() => {
          const box = element => {
            if (!element) return null
            const rect = element.getBoundingClientRect()
            return { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) }
          }
          return {
            viewport: { width: window.innerWidth, height: window.innerHeight, devicePixelRatio: window.devicePixelRatio },
            scroll: { x: Math.round(window.scrollX), y: Math.round(window.scrollY), width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
            body: box(document.body),
            headings: Array.from(document.querySelectorAll('h1,h2,h3')).slice(0, 40).map(element => ({ tag: element.tagName, text: (element.textContent || '').trim().slice(0, 120) })),
          }
        })()`)
      default:
        throw new Error(`BROWSER_INVALID_EXPRESSION: ${String(expression)}`)
    }
  }

  /** Place and show this page inside the desktop window. */
  async place(bounds: DesktopBrowserRect | null, zoom: number, visible: boolean): Promise<void> {
    if (closed(this)) return
    if (bounds === null) {
      await this.service.setVisible(this.viewId, false)
      return
    }
    await this.service.setBounds(this.viewId, bounds)
    if (Number.isFinite(zoom) && zoom > 0) await this.service.setZoom(this.viewId, zoom)
    await this.service.setVisible(this.viewId, visible)
  }

  /** Focus the guest page so keyboard input reaches it. */
  async focus(): Promise<void> {
    if (closed(this)) return
    await this.service.focus(this.viewId)
  }

  /** Whether the underlying view is still attached. */
  get isClosed(): boolean { return this.closed }

  /** Release the guest view and every listener. */
  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.settle('closed')
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.listeners.clear()
    await this.service.close(this.viewId).catch((cause: unknown) => {
      this.report(`browser page ${this.viewId} could not be closed: ${cause instanceof Error ? cause.message : String(cause)}`)
    })
  }
}

/** Resolve one promise or fail once its budget is spent. */
async function withDeadline<T>(work: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      work,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => { reject(new Error(message)) }, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

/** Whether one page has already released its view. */
function closed(page: DesktopBrowserPage): boolean {
  return page.isClosed
}
