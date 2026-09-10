import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from '../src/client/boot-health.ts'

afterEach(() => { vi.useRealTimers() })

describe('desktop renderer boot health', () => {
  it('reports the plugin whose Loader fiber failed', async () => {
    const awaitLoader = vi.fn(async () => {})
    const loader = {
      await: awaitLoader,
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop-beta' }, fiber: { state: 2 } }
        yield { options: { name: 'dsh-vision-router' }, fiber: { state: 3 } }
      },
    }

    await expect(rendererBootReport(loader)).resolves.toEqual({
      status: 'failed',
      plugins: ['dsh-vision-router'],
    })
    expect(awaitLoader).toHaveBeenCalledOnce()
  })

  it('preserves the Loader apply error that caused renderer boot to reject', async () => {
    const error = new Error(
      'failed to apply loader entry d455f565 (dsh-vision-router): '
      + 'keyed slot "tool.call.toolview" already has an entry for key "vision_crop" at priority 0',
    )
    const loader = {
      await: vi.fn(async () => { throw error }),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop-beta' }, fiber: { state: 2 } }
        yield { options: { name: 'dsh-vision-router' }, fiber: { state: 3 } }
      },
    }

    await expect(rendererBootReport(loader)).resolves.toEqual({
      status: 'failed',
      plugins: ['dsh-vision-router'],
      error: error.message,
    })
  })

  it('posts the terminal boot report to the same-origin desktop Host', async () => {
    const loader = {
      await: vi.fn(async () => {}),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop-beta' }, fiber: { state: 2 } }
      },
    }
    const request = vi.fn(async () => new Response(null, { status: 204 }))

    await expect(sendRendererBootReport(loader, request)).resolves.toEqual({ status: 'healthy' })
    expect(request).toHaveBeenCalledWith(RENDERER_BOOT_REPORT_PATH, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'healthy' }),
    })
  })

  it('defers Loader settlement until the desktop client apply has returned', async () => {
    vi.useFakeTimers()
    const loader = {
      await: vi.fn(async () => {}),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop-beta' }, fiber: { state: 2 } }
      },
    }
    const request = vi.fn(async () => new Response(null, { status: 204 }))

    const dispose = startRendererBootReporter(loader, request)
    expect(loader.await).not.toHaveBeenCalled()

    await vi.runAllTimersAsync()
    expect(loader.await).toHaveBeenCalledOnce()
    expect(request).toHaveBeenCalledOnce()
    dispose()
  })

  it('does not send a late report after the renderer generation is disposed', async () => {
    vi.useFakeTimers()
    let settle!: () => void
    const loader = {
      await: vi.fn(() => new Promise<void>((resolve) => { settle = resolve })),
      * entries() {
        yield { options: { name: 'dsh-plugin-desktop-beta' }, fiber: { state: 2 } }
      },
    }
    const request = vi.fn(async () => new Response(null, { status: 204 }))

    const dispose = startRendererBootReporter(loader, request)
    await vi.advanceTimersByTimeAsync(0)
    expect(loader.await).toHaveBeenCalledOnce()
    dispose()
    settle()
    await Promise.resolve()
    await Promise.resolve()

    expect(request).not.toHaveBeenCalled()
  })
})
