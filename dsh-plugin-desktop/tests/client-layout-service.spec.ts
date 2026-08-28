import { afterEach, describe, expect, it, vi } from 'vitest'
import { claimDesktopLayout } from '../src/client/layout-service.ts'
import { applyAdvancedShell } from '../src/client/advanced-shell.ts'
import { applyExtendedShell } from '../src/client/extended-shell.ts'

interface FakeStyleElement {
  id: string
  name: string
  textContent: string
  dataset: Record<string, string>
  isConnected: boolean
  content: string
  remove(): void
}

function stubDocument() {
  const byId = new Map<string, FakeStyleElement>()
  const dataset: Record<string, string | undefined> = {}
  const rootViewport = { id: 'root', dataset: {} as Record<string, string | undefined> }
  const fakeDocument = {
    getElementById: (id: string) => {
      if (id === 'root') return rootViewport
      return byId.get(id) ?? null
    },
    head: {
      appendChild(child: FakeStyleElement): void {
        byId.set(child.id, child)
      },
    },
    createElement: (_tag: string): FakeStyleElement => ({
      id: '',
      name: '',
      textContent: '',
      dataset: {},
      isConnected: true,
      content: '',
      remove() { byId.delete(this.id) },
    }),
    body: {
      dataset,
      style: { setProperty() {}, removeProperty() {} },
      setAttribute() {},
      removeAttribute() {},
    },
    documentElement: { style: { colorScheme: '', removeProperty() {}, setProperty() {} } },
  }
  vi.stubGlobal('document', fakeDocument)
  vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(0, 0, 0)' }))
  return { byId, dataset }
}

function makeCtx() {
  return {
    reflect: { provide: vi.fn(), get: vi.fn() },
    // Cordis runs effect factories eagerly during the apply walk — mirror
    // that here so registration assertions observe real calls.
    effect: vi.fn((factory: () => unknown) => factory()),
    slots: {
      register: vi.fn(() => ({})),
      inject: vi.fn(),
    },
    theme: { getTheme: vi.fn(() => ({ active: { colorScheme: 'light', tokens: {} } })) },
    on: vi.fn(() => () => {}),
  }
}

afterEach(() => { vi.unstubAllGlobals() })

describe('claimDesktopLayout', () => {
  it('wins ownership when nothing else registered the service', () => {
    const ctx = makeCtx()
    const dispose = vi.fn()
    ctx.reflect.provide.mockReturnValue(dispose)
    const layout = { mark: 'state' }

    expect(claimDesktopLayout(ctx as never, layout as never)).toBe(true)
    expect(ctx.reflect.provide).toHaveBeenCalledWith('layout', layout)

    // The disposal effect must be owned by the fiber so a later unload frees
    // the registration for whoever applies next; the factory result is what
    // cordis registers for uninstall.
    expect(ctx.effect).toHaveBeenCalledWith(expect.any(Function), 'desktop: layout service')
    const disposer = ctx.effect.mock.results[0]?.value
    expect(typeof disposer).toBe('function')
    ;(disposer as () => void)()
    expect(dispose).toHaveBeenCalled()
  })

  it('defers safely when another entry already owns the service', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const ctx = makeCtx()
      ctx.reflect.provide.mockImplementation(() => {
        throw new Error('service "layout" has been registered at <z5>')
      })
      expect(claimDesktopLayout(ctx as never, {} as never)).toBe(false)
      // Cordis starts the effect synchronously, but the failed factory never
      // produces a disposer that could be retained by the fiber.
      expect(ctx.effect).toHaveBeenCalledOnce()
      expect(ctx.effect.mock.results[0]?.type).toBe('throw')
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('rethrows unrelated registration failures', () => {
    const ctx = makeCtx()
    ctx.reflect.provide.mockImplementation(() => {
      throw new TypeError('cannot read properties of undefined')
    })
    expect(() => claimDesktopLayout(ctx as never, {} as never)).toThrow(TypeError)
  })
})

function environmentFor(mode: 'advanced' | 'extended') {
  return { mode, platform: 'win32', material: 'off', micaSupported: false, version: '2.0.2' }
}

describe('applyAdvancedShell presentation ownership', () => {
  it('owns presentation when the layout race is won', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      stubDocument()
      const ctx = makeCtx()
      ctx.reflect.provide.mockReturnValue(vi.fn())

      applyAdvancedShell(ctx as never, environmentFor('advanced') as never)

      // layout service + owned styles/markers + theme presenter + root slot
      expect(ctx.effect).toHaveBeenCalledTimes(4)
      expect(ctx.slots.register).toHaveBeenCalledTimes(1)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('defers presentation to upstream when the race is lost, keeping only markers', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { dataset } = stubDocument()
      const ctx = makeCtx()
      ctx.reflect.provide.mockImplementation(() => {
        throw new Error('service "layout" has been registered at <z5>')
      })

      applyAdvancedShell(ctx as never, environmentFor('advanced') as never)

      // Upstream keeps presenting: no root slot takeover, no presenter, and
      // none of the desktop-owned chrome styles — just the mode markers,
      // whose cleanup still runs through their own fiber effect.
      expect(ctx.slots.register).not.toHaveBeenCalled()
      // Failed ownership attempt plus the surviving marker effect.
      expect(ctx.effect).toHaveBeenCalledTimes(2)
      expect(ctx.effect.mock.results[0]?.type).toBe('throw')
      const cleanup = ctx.effect.mock.results[1]?.value
      expect(typeof cleanup).toBe('function')
      ;(cleanup as () => void)()
      expect(dataset.dshDesktopMode).toBeUndefined()
      expect(dataset.dshDesktopPlatform).toBeUndefined()
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})

describe('applyExtendedShell presentation ownership', () => {
  it('owns the extended presentation and frames it when the race is won', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      stubDocument()
      const ctx = makeCtx()
      ctx.reflect.provide.mockReturnValue(vi.fn())

      applyExtendedShell(ctx as never, environmentFor('extended') as never)

      // layout + owned styles + presenter + root slot + framed chrome styles
      expect(ctx.effect).toHaveBeenCalledTimes(5)
      expect(ctx.slots.register).toHaveBeenCalledTimes(1)
      expect(warn).not.toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })

  it('keeps the framed chrome but drops the owned presentation when the race is lost', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      stubDocument()
      const ctx = makeCtx()
      ctx.reflect.provide.mockImplementation(() => {
        throw new Error('service "layout" has been registered at <z5>')
      })

      applyExtendedShell(ctx as never, environmentFor('extended') as never)

      // The failed ownership attempt is followed only by the framed-chrome
      // style effect; no second root frame is stacked over the existing one.
      expect(ctx.effect).toHaveBeenCalledTimes(2)
      expect(ctx.effect.mock.results[0]?.type).toBe('throw')
      expect(ctx.slots.register).not.toHaveBeenCalled()
      expect(ctx.slots.inject).toHaveBeenCalledTimes(1)
      expect(warn).toHaveBeenCalled()
    } finally {
      warn.mockRestore()
    }
  })
})
