import { afterEach, expect, it, vi } from 'vitest'
import { installGlobalPanelFold } from '../src/client/global-panel-fold.ts'

const disposers: Array<() => void> = []
afterEach(() => { disposers.splice(0).forEach(dispose => dispose()); vi.unstubAllGlobals() })

class FakeElement {
  children: FakeElement[] = []
  parentElement: FakeElement | null = null
  attributes = new Map<string, string>()
  listeners = new Map<string, () => void>()
  dataset: Record<string, string> = {}
  className = ''
  textContent = ''
  type = ''
  constructor(readonly tagName: string) {}
  get id(): string { return this.getAttribute('id') ?? '' }
  set id(value: string) { this.setAttribute('id', value) }
  get nextElementSibling(): FakeElement | null {
    if (!this.parentElement) return null
    return this.parentElement.children[this.parentElement.children.indexOf(this) + 1] ?? null
  }
  getAttribute(name: string): string | null { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  removeAttribute(name: string): void { this.attributes.delete(name) }
  matches(selector: string): boolean {
    return selector === '[data-slot="sidebar"]' && this.getAttribute('data-slot') === 'sidebar'
      || selector === 'nav[class*="panelList"]' && this.tagName === 'nav' && this.className.includes('panelList')
  }
  querySelector(selector: string): FakeElement | null {
    return this.children.find(child => child.matches(selector) || child.querySelector(selector)) ?? null
  }
  insertBefore(node: FakeElement, before: FakeElement): void {
    node.remove()
    const index = this.children.indexOf(before)
    if (index < 0) throw new Error('Missing sibling')
    this.children.splice(index, 0, node)
    node.parentElement = this
  }
  append(node: FakeElement): void { node.remove(); this.children.push(node); node.parentElement = this }
  remove(): void {
    if (!this.parentElement) return
    this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1)
    this.parentElement = null
  }
  addEventListener(name: string, callback: () => void): void { this.listeners.set(name, callback) }
  removeEventListener(name: string): void { this.listeners.delete(name) }
  click(): void { this.listeners.get('click')?.() }
}

function fixture(options: { collapsed?: boolean; existingId?: string; conflictingId?: boolean; storageThrows?: boolean } = {}) {
  const body = new FakeElement('body')
  const head = new FakeElement('head')
  const sidebar = new FakeElement('aside')
  sidebar.setAttribute('data-slot', 'sidebar')
  const root = new FakeElement('div')
  root.className = options.collapsed ? 'sidebar_root_collapsed' : 'sidebar_root'
  const nav = new FakeElement('nav')
  nav.className = 'panelList_list'
  nav.setAttribute('aria-label', '全局面板')
  if (options.existingId) nav.id = options.existingId
  root.append(nav)
  sidebar.append(root)
  body.append(sidebar)
  const storage = new Map<string, string>()
  const localStorage = {
    getItem: (key: string) => { if (options.storageThrows) throw new Error('blocked'); return storage.get(key) ?? null },
    setItem: (key: string, value: string) => { if (options.storageThrows) throw new Error('blocked'); storage.set(key, value) },
  }
  const observers: FakeObserver[] = []
  class FakeObserver {
    active = false
    constructor(readonly callback: (records: MutationRecord[]) => void) { observers.push(this) }
    observe(): void { this.active = true }
    disconnect(): void { this.active = false }
    fire(target: FakeElement, addedNodes: FakeElement[] = [], removedNodes: FakeElement[] = []): void {
      if (this.active) this.callback([{ target, addedNodes, removedNodes } as unknown as MutationRecord])
    }
  }
  const conflict = new FakeElement('div')
  if (options.conflictingId) { conflict.id = 'dsh-next-global-panels'; body.append(conflict) }
  const document = {
    body, head,
    createElement: (tag: string) => new FakeElement(tag),
    querySelector: vi.fn(() => sidebar.children[0] ?? null),
    getElementById: (id: string) => [conflict, ...root.children].find(child => child.id === id) ?? null,
  }
  vi.stubGlobal('HTMLElement', FakeElement)
  vi.stubGlobal('Element', FakeElement)
  vi.stubGlobal('MutationObserver', FakeObserver)
  vi.stubGlobal('document', document)
  vi.stubGlobal('window', { localStorage })
  const install = () => { const dispose = installGlobalPanelFold(); disposers.push(dispose); return dispose }
  return { body, head, sidebar, root, nav, storage, observers, document, install }
}

it('adds a labelled toggle only before the global nav and restores the DOM on disposal', () => {
  const f = fixture({ existingId: 'official-global-panels' })
  const dispose = f.install()
  const button = f.root.children[0]!
  expect(f.root.children).toEqual([button, f.nav])
  expect(button.textContent).toBe('全局面板')
  expect(button.getAttribute('aria-controls')).toBe('official-global-panels')
  expect(button.getAttribute('aria-expanded')).toBe('true')
  expect(f.head.children[0]!.textContent).toContain('display: none !important')
  expect(f.nav.id).toBe('official-global-panels')
  button.click()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  expect(f.root.getAttribute('data-dsh-next-global-panels-folded')).toBe('true')
  expect(f.storage.get('dsh-desktop-next:global-panels-folded')).toBe('1')
  button.click()
  expect(f.root.getAttribute('data-dsh-next-global-panels-folded')).toBe('false')
  dispose()
  expect(f.root.children).toEqual([f.nav])
  expect(f.root.getAttribute('data-dsh-next-global-panels-folded')).toBeNull()
  expect(f.head.children).toEqual([])
  expect(f.nav.id).toBe('official-global-panels')
  expect(f.observers[0]!.active).toBe(false)
})

it('persists a folded preference while keeping the compact rail outside the hide rule', () => {
  const f = fixture({ collapsed: true })
  f.storage.set('dsh-desktop-next:global-panels-folded', '1')
  f.install()
  expect(f.root.children[0]!.getAttribute('aria-expanded')).toBe('false')
  expect(f.head.children[0]!.textContent).toContain('[class*="collapsed"] > .dshNextGlobalPanelsToggle { display: none; }')
  expect(f.head.children[0]!.textContent).toContain(':not([class*="collapsed"])[data-dsh-next-global-panels-folded="true"] > nav[class*="panelList"]')
  expect(f.nav.id).toBe('dsh-next-global-panels')
})

it('rebinds on sidebar replacement, ignores chat mutations, and cleans up both nav IDs', () => {
  const f = fixture()
  const dispose = f.install()
  const oldRoot = f.root
  const oldNav = f.nav
  const chat = new FakeElement('article')
  f.body.append(chat)
  f.document.querySelector.mockClear()
  f.observers[0]!.fire(chat, [new FakeElement('span')])
  expect(f.document.querySelector).not.toHaveBeenCalled()
  const replacementRoot = new FakeElement('div')
  replacementRoot.className = 'sidebar_root'
  const replacementNav = new FakeElement('nav')
  replacementNav.className = 'panelList_list'
  replacementNav.setAttribute('aria-label', 'Global panels')
  replacementRoot.append(replacementNav)
  f.sidebar.insertBefore(replacementRoot, oldRoot)
  oldRoot.remove()
  f.observers[0]!.fire(f.sidebar, [replacementRoot], [oldRoot])
  expect(oldRoot.getAttribute('data-dsh-next-global-panels-folded')).toBeNull()
  expect(oldNav.id).toBe('')
  expect(replacementRoot.children[0]!.textContent).toBe('Global panels')
  expect(replacementNav.id).toBe('dsh-next-global-panels')
  dispose()
  expect(replacementRoot.children).toEqual([replacementNav])
  expect(replacementNav.id).toBe('')
})

it('uses a unique navigation ID when another element owns the default ID', () => {
  const f = fixture({ conflictingId: true })
  const dispose = f.install()
  expect(f.nav.id).toBe('dsh-next-global-panels-2')
  expect(f.root.children[0]!.getAttribute('aria-controls')).toBe('dsh-next-global-panels-2')
  dispose()
  expect(f.nav.id).toBe('')
})

it('repeated installation disposes the previous control and storage failures keep toggling live', () => {
  const f = fixture({ storageThrows: true })
  const oldDispose = f.install()
  const oldButton = f.root.children[0]!
  f.install()
  expect(f.root.children).toHaveLength(2)
  expect(oldButton.parentElement).toBeNull()
  expect(f.head.children).toHaveLength(1)
  const button = f.root.children[0]!
  button.click()
  expect(button.getAttribute('aria-expanded')).toBe('false')
  oldDispose()
  expect(button.parentElement).toBe(f.root)
})
