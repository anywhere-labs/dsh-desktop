/** Utility-process entrypoint. No BrowserWindow or Electron main APIs are imported here. */
import { installFailLoud } from '@deepseek-ai/dsh-app-boot'
import { installProxyFromEnvironment } from '@deepseek-ai/dsh-http-proxy'
import { createLaunchEnvironmentSnapshot, type LaunchEnvironmentLayerInput } from '@deepseek-ai/dsh-launch-environment'
import { desktopProxyEnvLookup } from './system-proxy.ts'
import { HostRpc } from './host-rpc.ts'
import { createHostRuntime, type RuntimeSnapshot } from './host-runtime-bridge.ts'
import { bootDesktopHost, type DesktopHostOptions } from './host-bootstrap.ts'
import { createDesktopBrowserAccess } from './desktop-browser-access.ts'
import { DesktopLanHttpsRuntime } from './lan-https-runtime.ts'
import type { DesktopStartupGenerationHost } from './startup-generation.ts'
import { disableAsarArchiveView } from './asar-archive-policy.ts'
import { DESKTOP_PACKAGE_NAME } from './product-identity.ts'

// The Host lists and reads user workspaces; see asar-archive-policy.ts.
disableAsarArchiveView(import.meta.url)

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
let releaseProxy: (() => Promise<void>) | undefined
let releaseTask: Promise<void> | undefined
/** Tear this generation down once, whether the supervisor asked or a fatal error forces it. */
const release = (): Promise<void> => releaseTask ??= (async () => {
  stopping = true
  await host?.fiber.dispose()
  await lan?.stop()
  await releaseProxy?.()
  releaseProxy = undefined
})()
rpc.handle('stop', release)
// A utility process only warns on an unhandled rejection and keeps serving from whatever state
// the failure left, so adopt the same fail-loud contract as the Desktop main process and the
// upstream CLI: report, release what this generation holds, exit 1. The supervisor then sees an
// unexpected exit and keeps this stderr diagnostic in the Desktop log.
installFailLoud(DESKTOP_PACKAGE_NAME, process, release)
rpc.handle('boot', async args => {
  const [wire, snapshot, token] = args as [Omit<DesktopHostOptions, 'desktopLaunchEnvironment'> & { launchEnvironmentLayers: LaunchEnvironmentLayerInput[] }, RuntimeSnapshot, string]
  const options: DesktopHostOptions = { ...wire, desktopLaunchEnvironment: createLaunchEnvironmentSnapshot(wire.launchEnvironmentLayers) }
  if (starting || stopping) throw new Error('DSH Host generation already started or stopped')
  starting = true
  // The supervisor's installation does not reach here: the global dispatcher, `proxyRouteFor`'s
  // backing state, and the child-process environment are all module-private per process. This must
  // land before `bootDesktopHost`, because plugins mount during boot and may request immediately.
  // The supervisor already logged which route this is and why; repeating the URL here would only
  // add a second place for it to appear in a log a user pastes into an issue.
  releaseProxy = await installProxyFromEnvironment(
    desktopProxyEnvLookup(options.desktopLaunchEnvironment, options.desktopProxyOverlay),
    message => process.stderr.write(`dsh-plugin-desktop: ${message}\n`),
  )
  process.stderr.write('dsh-plugin-desktop: host outbound proxy policy installed\n')
  try {
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
  } catch (cause) {
    // A generation that never booted gets no `stop`, so release here or the policy outlives it.
    await releaseProxy?.()
    releaseProxy = undefined
    throw cause
  }
})
