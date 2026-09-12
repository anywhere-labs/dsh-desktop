import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { createLanHttpsCertificate, type DesktopLanHttpsCertificate } from '../src/lan-https-certificate.ts'
import { LanHttpsIngress } from '../src/lan-https-ingress.ts'
import { DesktopLanHttpsRuntime } from '../src/lan-https-runtime.ts'

let certificate: DesktopLanHttpsCertificate
const runtimes: DesktopLanHttpsRuntime[] = []
beforeAll(async () => {
  const directory = await mkdtemp(join(tmpdir(), 'dsh-lazy-lan-test-'))
  try {
    certificate = await createLanHttpsCertificate(directory, ['127.0.0.1'], {
      available: true, seal: value => Buffer.from(value).reverse(), open: value => Buffer.from(value).reverse(),
    })
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.stop()))
  vi.restoreAllMocks()
})

describe('Desktop LAN HTTPS runtime', () => {
  it('does no certificate work at loopback startup and reuses one certificate across concurrent enables and toggles', async () => {
    const prepareCertificate = vi.fn(async () => ({ certificate }))
    const runtime = new DesktopLanHttpsRuntime({ addresses: ['127.0.0.1'], prepareCertificate })
    runtimes.push(runtime)
    runtime.attach(43_120)
    await runtime.setEnabled(false)
    expect(prepareCertificate).not.toHaveBeenCalled()
    expect(runtime.caCertificate).toBeNull()
    const [first, second] = await Promise.all([runtime.setEnabled(true), runtime.setEnabled(true)])
    expect(first.state).toBe('ready')
    expect(second.actualPort).toBe(first.actualPort)
    expect(runtime.caCertificate).toBe(certificate.caCertificate)
    await runtime.setEnabled(false)
    expect((await runtime.setEnabled(true)).state).toBe('ready')
    expect(prepareCertificate).toHaveBeenCalledOnce()
  })

  it('does not open a listener if disabled while certificate preparation is pending', async () => {
    const prepared = Promise.withResolvers<{ certificate: DesktopLanHttpsCertificate }>()
    const prepareCertificate = vi.fn(() => prepared.promise)
    const transition = vi.spyOn(LanHttpsIngress.prototype, 'setEnabled')
    const runtime = new DesktopLanHttpsRuntime({ addresses: ['127.0.0.1'], prepareCertificate })
    runtimes.push(runtime)
    runtime.attach(43_120)
    const enabling = runtime.setEnabled(true)
    await Promise.resolve()
    expect(runtime.snapshot().state).toBe('starting')
    const stopping = runtime.stop()
    prepared.resolve({ certificate })
    await Promise.all([enabling, stopping])
    expect(transition).not.toHaveBeenCalledWith(true)
    expect(runtime.snapshot()).toMatchObject({ state: 'inactive', actualPort: null })
  })

  it('fails closed on certificate errors and allows a later retry', async () => {
    const prepareCertificate = vi.fn<() => Promise<{ certificate: DesktopLanHttpsCertificate } | { failureCode: string }>>()
      .mockResolvedValueOnce({ failureCode: 'certificate-state' })
      .mockRejectedValueOnce(new Error('module unavailable'))
      .mockResolvedValueOnce({ certificate })
    const runtime = new DesktopLanHttpsRuntime({ addresses: ['127.0.0.1'], prepareCertificate })
    runtimes.push(runtime)
    runtime.attach(43_120)
    await expect(runtime.setEnabled(true)).resolves.toMatchObject({ state: 'failed', errorCode: 'certificate-state' })
    await expect(runtime.setEnabled(true)).resolves.toMatchObject({ state: 'failed', errorCode: 'certificate-unavailable' })
    await expect(runtime.setEnabled(true)).resolves.toMatchObject({ state: 'ready', errorCode: null })
  })
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
