import { describe, expect, it } from 'vitest'
import { DesktopLanHttpsRuntime } from '../src/lan-https-runtime.ts'

describe('Desktop LAN HTTPS runtime', () => {
  it('fails closed only when an unavailable edge is requested', async () => {
    const runtime = new DesktopLanHttpsRuntime({
      addresses: ['192.168.1.20'],
      failureCode: 'certificate-unavailable',
    })
    runtime.attach(43_120)

    expect(runtime.snapshot()).toEqual({
      state: 'inactive',
      actualPort: null,
      addresses: ['192.168.1.20'],
      caFingerprint: null,
      errorCode: null,
    })
    await expect(runtime.setEnabled(true)).resolves.toMatchObject({
      state: 'failed',
      errorCode: 'certificate-unavailable',
    })
    await expect(runtime.setEnabled(false)).resolves.toMatchObject({
      state: 'inactive',
      errorCode: null,
    })
  })

  it('keeps same-port attachment idempotent and rejects another target', () => {
    const runtime = new DesktopLanHttpsRuntime({ addresses: [] })
    runtime.attach(43_120)
    expect(() => runtime.attach(43_120)).not.toThrow()
    expect(() => runtime.attach(43_121)).toThrow('another port')
  })

  it('rejects non-boolean transitions', async () => {
    const runtime = new DesktopLanHttpsRuntime({ addresses: [] })
    runtime.attach(43_120)
    await expect(runtime.setEnabled('yes' as never)).rejects.toThrow('must be a boolean')
  })
})
