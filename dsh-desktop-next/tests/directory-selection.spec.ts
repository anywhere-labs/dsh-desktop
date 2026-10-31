import { describe, expect, it, vi } from 'vitest'
import { DesktopDirectorySelection } from '../src/directory-selection.ts'

const owner = () => ({ key: 'window:document:profile', current: () => true })

describe('document-owned multi-folder selection', () => {
  it('coalesces concurrent requests and admits each distinct selected root before returning', async () => {
    const selection = new DesktopDirectorySelection()
    const pick = vi.fn(async () => ['/primary', '/other', '/primary'])
    const admit = vi.fn(async () => true)
    const first = selection.select(owner(), true, { pick, admit })
    const second = selection.select(owner(), true, { pick, admit })
    expect(first).toBe(second)
    await expect(first).resolves.toEqual(['/primary', '/other'])
    expect(pick).toHaveBeenCalledExactlyOnceWith(true)
    expect(admit.mock.calls).toEqual([['/primary'], ['/other']])
  })

  it('rejects the whole selection when any root is denied instead of changing the primary', async () => {
    const admit = vi.fn(async (path: string) => path !== '/denied')
    await expect(new DesktopDirectorySelection().select(owner(), true, {
      pick: async () => ['/primary', '/denied', '/third'], admit,
    })).resolves.toEqual([])
    expect(admit.mock.calls).toEqual([['/primary'], ['/denied']])
  })

  it('does not leak accepted roots after a failed admission', async () => {
    const admit = vi.fn(async (path: string) => { if (path === '/bad') throw new Error('disconnected'); return true })
    await expect(new DesktopDirectorySelection().select(owner(), true, {
      pick: async () => ['/primary', '/bad'], admit,
    })).rejects.toThrow('disconnected')
  })

  it('returns no folders on cancel and keeps old single-selection callers single', async () => {
    const selection = new DesktopDirectorySelection()
    const admit = vi.fn(async () => true)
    await expect(selection.select(owner(), true, { pick: async () => null, admit })).resolves.toEqual([])
    expect(admit).not.toHaveBeenCalled()
    await expect(selection.select(owner(), false, { pick: async () => ['/one', '/two'], admit })).resolves.toEqual(['/one'])
  })

  it('discards a dialog settled for a replaced document, Profile or Host', async () => {
    let current = true
    let settle!: (paths: string[]) => void
    const admit = vi.fn(async () => true)
    const pending = new DesktopDirectorySelection().select({ key: 'old', current: () => current }, true, {
      pick: () => new Promise(resolve => { settle = resolve }), admit,
    })
    current = false
    settle(['/private'])
    await expect(pending).resolves.toEqual([])
    expect(admit).not.toHaveBeenCalled()
  })

  it('checks ownership again after an asynchronous admission prompt', async () => {
    let current = true
    let settle!: (accepted: boolean) => void
    const pending = new DesktopDirectorySelection().select({ key: 'old', current: () => current }, true, {
      pick: async () => ['/one', '/two'], admit: () => new Promise(resolve => { settle = resolve }),
    })
    await Promise.resolve()
    current = false
    settle(true)
    await expect(pending).resolves.toEqual([])
  })
})

it('coalesces mixed legacy and multi-root requests without opening two native dialogs', async () => {
  const selection = new DesktopDirectorySelection()
  const pick = vi.fn(async () => ['/primary', '/other'])
  const admit = vi.fn(async () => true)
  const multiple = selection.select(owner(), true, { pick, admit })
  const single = selection.select(owner(), false, { pick, admit })
  await expect(multiple).resolves.toEqual(['/primary', '/other'])
  await expect(single).resolves.toEqual(['/primary'])
  expect(pick).toHaveBeenCalledOnce()
  expect(admit).toHaveBeenCalledTimes(2)
})
