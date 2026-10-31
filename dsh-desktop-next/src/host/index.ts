/** Alpha.2 shared Web profile runner, hosted by an Electron Node-mode child. */
import { auditHostPlugins, configureHostLogging, hostLog, hostOperation } from './logging.ts'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadLayeredEnv } from '@deepseek-ai/dsh-app-boot'
import { runProfile } from '@deepseek-ai/dsh/profile-boot'
import type {} from '@deepseek-ai/dsh-client-connection'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { hostOperationDiagnostics, installOfficialCuaResolution, webIndexInjections } from '../upstream-family.ts'
import { loadNextProfile, NEXT_PACKAGE, readNextProfilePatches } from '../profiles.ts'
import { bundledPnpmInvocation } from '../bundled-pnpm.ts'
import { configureNextBrowserAccess } from '../desktop-browser-access.ts'
import { parsePreferences } from '../desktop-preferences.ts'
import { atomicJson } from '../private-files.ts'
import type NextWebServer from '../webserver.ts'
import { disableAsarArchiveView } from '../asar-archive-policy.ts'
import { maskSecrets } from '../mask-secrets.ts'
import { MEMORY_SAMPLE_INTERVAL_MS, hostMemoryUsage } from '../memory-monitor.ts'
import { parseSystemProxyProbe, SYSTEM_PROXY_ENV, withSystemProxy } from '../system-proxy.ts'
import { watchPlatformLogin, type PlatformLoginAccount } from './platform-login.ts'
import { installAgentPresetResolution } from './agent-preset.ts'
import { installCuaDriverResolution } from './cua-driver.ts'
import { installOfficeEngineResolution } from './office-engine.ts'
import { installSharpWasmResolution } from './sharp-wasm.ts'
import { installSkillBadgeResolution } from './skill-badge.ts'
import { formatFatalDiagnostic } from './fatal-diagnostic.ts'
import * as desktopOffice from './office.ts'
import { resolveOfficeConfig } from './office.ts'

export async function main(): Promise<void> {
  // The Host lists and reads user workspaces; see asar-archive-policy.ts.
  disableAsarArchiveView(import.meta.url)
  const runtimeDir = process.argv[2]
  const projectDir = process.argv[3]
  const primaryRuntime = process.argv[4]
  const home = process.env.DSH_HOME
  if (!runtimeDir || !projectDir || !home || !process.send) throw new Error('Next Host requires runtime, profile, home and IPC')
  // The Office engine runs as a native child process, so an archived payload resolves it to its unpacked copy.
  installOfficeEngineResolution(runtimeDir)
  // The Creator preset reads its skills through the Host's filesystem service, which cannot stat inside the archive.
  installAgentPresetResolution(runtimeDir)
  // The computer-use driver hands its library path to the system loader, which reads no archive.
  installCuaDriverResolution(runtimeDir)
  // The badge skill tells the model to take its PNG from the directory it announces, which shells and the Host's filesystem service cannot read inside the archive.
  installSkillBadgeResolution(runtimeDir)
  // The official Computer Use provider starts the helper beside its own module as a child process, which reads no archive.
  installOfficialCuaResolution?.(runtimeDir)
  // Linux sharp must not load its native backends beside the GLib Electron links; it runs its WebAssembly build instead.
  installSharpWasmResolution(runtimeDir)
  const preferences = parsePreferences(JSON.parse(process.env.DSH_NEXT_PREFERENCES ?? '{}'))
  configureHostLogging(preferences)
  hostLog({ source: 'host', event: 'process.start', fields: { profile: basename(projectDir), node: process.version } })
  const trustedHosts = JSON.parse(process.env.DSH_NEXT_TRUSTED_HOSTS ?? '[]') as unknown
  if (!Array.isArray(trustedHosts) || trustedHosts.some(host => typeof host !== 'string')) throw new Error('Invalid Next trusted hosts')
  const systemProxy = parseSystemProxyProbe(process.env[SYSTEM_PROXY_ENV])
  configureNextBrowserAccess(process.env.DSH_NEXT_NATIVE_TOKEN, preferences.browserAccess)
  delete process.env.DSH_NEXT_NATIVE_TOKEN
  delete process.env.DSH_NEXT_PREFERENCES
  delete process.env.DSH_NEXT_TRUSTED_HOSTS
  delete process.env[SYSTEM_PROXY_ENV]
  const profile = loadNextProfile(projectDir, home)
  const runtimePatch = join(projectDir, 'desktop-next.runtime.patch.json')
  atomicJson(runtimePatch, [
    { id: 'desktop-next-webserver', config: { host: '127.0.0.1', port: preferences.port } },
    { id: 'connection', config: { trustedHosts } },
  ])
  // runProfile installs the outbound proxy policy from this environment before any plugin mounts.
  const { environment, resolution: proxy } = withSystemProxy(loadLayeredEnv('dsh-desktop-next'), systemProxy, trustedHosts as string[])
  // One line on every start, direct included: a connectivity report cannot be answered without it.
  for (const line of [proxy.summary, ...proxy.diagnostics]) process.stderr.write(`dsh-desktop-next: ${maskSecrets(line)}\n`)
  const send = (value: object): Promise<void> => new Promise((resolveSend, reject) => {
    if (!process.connected || !process.send) return resolveSend()
    process.send(value, error => error ? reject(error) : resolveSend())
  })
  // Announced before the profile starts, so a startup failure and this run's plugin operations share one run identity.
  const operations = hostOperationDiagnostics?.(send)
  const application = runProfile({
    environment, profile: basename(projectDir),
    resolvedProfile: { profile, installAnchor: NEXT_PACKAGE,
      readPatches: profilePatches => readNextProfilePatches(projectDir, home,
        [join(runtimeDir, 'host.cordis.patch.yml'), join(projectDir, 'desktop-next.cordis.patch.json'), runtimePatch], profilePatches) },
    patchFiles: [join(runtimeDir, 'host.cordis.patch.yml'), join(projectDir, 'desktop-next.cordis.patch.json'), runtimePatch], args: ['--no-open', '--port', String(preferences.port)],
    packageManager: bundledPnpmInvocation(runtimeDir),
  })
  // Memory evidence for the Desktop's incident snapshots. Pushed rather than requested, so a Host too
  // busy or too short of memory to answer still leaves its last reading behind (#1511).
  const memory = setInterval(() => {
    try { void send({ type: 'memory', ...hostMemoryUsage(process.memoryUsage()) }).catch(() => {}) }
    catch { /* A failed reading drops only this sample. */ }
  }, MEMORY_SAMPLE_INTERVAL_MS)
  memory.unref()
  let stopping: Promise<void> | undefined
  const accountWatch = new AbortController()
  const stop = (): Promise<void> => stopping ??= (async () => {
    const end = hostOperation('host', 'shutdown')
    clearInterval(memory)
    accountWatch.abort()
    const running = await application.catch(() => undefined)
    try { await running?.shutdown.shutdown(0); end() } catch (error) { end(error); throw error }
    await send({ type: 'shutdown-complete' })
    if (process.connected) process.disconnect()
    process.exit(0)
  })()
  process.on('message', (value: unknown) => {
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'logging-config') {
      const request = value as { requestId?: unknown; developerLogging?: unknown; logLevel?: unknown }
      if (!Number.isSafeInteger(request.requestId) || typeof request.developerLogging !== 'boolean' || !['debug', 'info', 'warn', 'error'].includes(String(request.logLevel))) return
      configureHostLogging({ developerLogging: request.developerLogging, logLevel: request.logLevel as typeof preferences.logLevel })
      void send({ type: 'logging-config', requestId: request.requestId }).catch(fatal)
      return
    }
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'shutdown') void stop().catch(fatal)
    if (typeof value === 'object' && value !== null && 'type' in value && value.type === 'injections') {
      // dsh 0.1.7 serves the boot graph as revision-addressed combo bundles, and registering a
      // plugin rebuilds that table. A document reloading against the table captured at startup
      // would request bundles the Web server no longer publishes, so the answer is collected now.
      const query = value as { requestId?: unknown }
      if (!Number.isSafeInteger(query.requestId)) return
      void application.then(async ({ ctx }) => {
        if (stopping) throw new Error('Next Host is stopping')
        await send({ type: 'injections', requestId: query.requestId, injections: webIndexInjections(ctx) })
      }).catch(async () => { await send({ type: 'injections', requestId: query.requestId, error: 'Could not collect Web boot injections' }) }).catch(fatal)
      return
    }
    if (typeof value !== 'object' || value === null || !('type' in value) || value.type !== 'browser-access') return
    const request = value as { requestId?: unknown; enabled?: unknown }
    if (!Number.isSafeInteger(request.requestId) || typeof request.enabled !== 'boolean') return
    const enabled = request.enabled
    void application.then(async ({ ctx }) => {
      if (stopping) throw new Error('Next Host is stopping')
      ;(ctx.webServer as NextWebServer).setBrowserAccess(enabled)
      await send({ type: 'browser-access', requestId: request.requestId })
    }).catch(async () => { await send({ type: 'browser-access', requestId: request.requestId, error: 'Could not update browser access' }) }).catch(fatal)
  })
  process.once('disconnect', () => { void stop().catch(fatal) })
  const { ctx } = await application
  operations?.observe(ctx)
  // Office skills and the workspace dependency tool need the bundled payload; a packaged Host without it fails here.
  const office = resolveOfficeConfig(runtimeDir, primaryRuntime, home)
  if (office === undefined) hostLog({ source: 'host', event: 'office.unavailable', level: 'warn', fields: { source: primaryRuntime } })
  else {
    const mounted = hostOperation('host', 'office.mount', { source: office.source })
    try { await ctx.plugin(desktopOffice, office); mounted() } catch (error) { mounted(error); throw error }
  }
  hostLog({ source: 'host', event: 'process.ready' })
  await send({ type: 'ready', url: ctx.connection.authenticatedUrl(`http://127.0.0.1:${ctx.webServer.port}`),
    injections: webIndexInjections(ctx) })
  auditHostPlugins(ctx)
  const account = ctx.get('deepseekAccount') as PlatformLoginAccount | undefined
  if (account !== undefined && !stopping) {
    // A broken watcher only loses the automatic browser hand-off; the dialog still offers the link.
    void watchPlatformLogin(account, (request) => { void send({ type: 'platform-login', ...request }).catch(() => {}) }, accountWatch.signal)
      .catch((error: unknown) => { if (!accountWatch.signal.aborted) console.error('[dsh-desktop-next] platform login watcher stopped', error) })
  }
}

function fatal(error: unknown): void {
  const message = error instanceof Error ? error.message : String(error)
  // The shell receives the complete inspected error here, not through stderr:
  // stderr bytes and this IPC message race, and the shell reports the first
  // failure it sees.
  const diagnostic = formatFatalDiagnostic(error)
  if (process.connected) process.send?.({ type: 'fatal', message, diagnostic }, () => { if (process.connected) process.disconnect() })
  console.error(error)
  process.exitCode = 1
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) void main().catch(fatal)
