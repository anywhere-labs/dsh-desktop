import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { DEFAULT_PREFERENCES } from '../src/desktop-contract.ts'
import { NextDesktopRuntime } from '../src/desktop-runtime.ts'
import { DesktopHostProcess } from '../src/host-process.ts'
import { DesktopLanHttpsCertificateError } from '../src/lan-https-certificate.ts'

vi.mock('../src/web-document.ts', async importOriginal => ({
  ...await importOriginal<typeof import('../src/web-document.ts')>(),
  authenticateWebHost: vi.fn(async () => 'dsh-session=fixture'),
}))

const runtimes: NextDesktopRuntime[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(runtimes.splice(0).map(runtime => runtime.close()))
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })))
  vi.restoreAllMocks()
})

it('keeps the loopback Host ready when optional LAN certificate setup fails at startup', async () => {
  const home = await mkdtemp(join(tmpdir(), 'next-lan-startup-'))
  directories.push(home)
  const stop = vi.spyOn(DesktopHostProcess.prototype, 'stop').mockResolvedValue()
  vi.spyOn(DesktopHostProcess.prototype, 'start').mockResolvedValue({
    url: 'http://127.0.0.1:43120/?token=fixture', injections: [],
  })
  const onFailure = vi.fn()
  const runtime = new NextDesktopRuntime({
    home, root: home, executable: process.execPath, addresses: () => ['127.0.0.1'],
    certificate: async () => { throw new DesktopLanHttpsCertificateError('certificate-unavailable', 'private-key protection unavailable') },
    onFailure, onChange() {}, onRestart() {}, onTerminal() {}, onNotification() {},
  })
  runtimes.push(runtime)
  runtime.preferences = { ...DEFAULT_PREFERENCES, browserAccess: true, networkExposure: 'lan' }

  await runtime.start()
  expect(runtime.backend.state.phase).toBe('ready')
  expect(runtime.state().lan).toMatchObject({ state: 'failed', actualPort: null, errorCode: 'certificate-unavailable' })
  expect(runtime.browserLinks()).toMatchObject({ lanUrls: [] })
  expect(runtime.diagnostics.snapshot()).toContain('[warn] LAN HTTPS: certificate-unavailable')
  expect(runtime.diagnostics.snapshot()).toContain('Host ready: desktop')
  expect(onFailure).not.toHaveBeenCalled()
  expect(stop).not.toHaveBeenCalled()
})
