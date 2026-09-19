/** Utility-process entrypoint. No BrowserWindow or Electron main APIs are imported here. */
import { createLaunchEnvironmentSnapshot, type LaunchEnvironmentLayerInput } from '@deepseek-ai/dsh-launch-environment'
import { HostRpc } from './host-rpc.ts'
import { createHostRuntime, type RuntimeSnapshot } from './host-runtime-bridge.ts'
import { bootDesktopHost, type DesktopHostOptions } from './host-bootstrap.ts'
import { createDesktopBrowserAccess } from './desktop-browser-access.ts'
import { DesktopLanHttpsRuntime } from './lan-https-runtime.ts'
import type { DesktopStartupGenerationHost } from './startup-generation.ts'

const parentPort = process.parentPort
if (!parentPort) throw new Error('DSH Host must be started by the Desktop supervisor')
const rpc = new HostRpc({
  send: message => parentPort.postMessage(message),
  listen: receive => {
    const listener = (event: { data: unknown }) => receive(event.data)
    parentPort.on('message', listener)
    return () => { parentPort.removeListener('message', listener) }
  },
}, 120_000)
let host: DesktopStartupGenerationHost | undefined
let inspectServices = () => ({ aaRuntime: false, aaOnboarding: false })
rpc.handle('status', () => ({ pid: process.pid, services: inspectServices() }))
let starting = false
let stopping = false
let lan: DesktopLanHttpsRuntime | undefined
rpc.handle('stop', async () => {
  stopping = true
  await host?.fiber.dispose()
  await lan?.stop()
})
rpc.handle('boot', async args => {
  const [wire, snapshot, token] = args as [Omit<DesktopHostOptions, 'desktopLaunchEnvironment'> & { launchEnvironmentLayers: LaunchEnvironmentLayerInput[] }, RuntimeSnapshot, string]
  const options: DesktopHostOptions = { ...wire, desktopLaunchEnvironment: createLaunchEnvironmentSnapshot(wire.launchEnvironmentLayers) }
  if (starting || stopping) throw new Error('DSH Host generation already started or stopped')
  starting = true
  const runtime = createHostRuntime(rpc, snapshot)
  const browser = createDesktopBrowserAccess(options.prepared.mode === 'compatibility' && options.prepared.openBrowser, token)
  lan = new DesktopLanHttpsRuntime({
    addresses: options.prepared.lanAddresses, requestedPort: 0,
    prepareCertificate: () => rpc.call('certificate'),
  })
  inspectServices = await bootDesktopHost(options, runtime, browser, lan,
    value => { host = value }, code => { void rpc.call('quit', [code]).catch(() => {}) })
  if (stopping) { await host?.fiber.dispose(); throw new Error('DSH Host stopped during startup') }
  await runtime.mountScheduled()
  return { pid: process.pid }
})
