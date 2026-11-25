/** Panel routes use DSH's authenticated connection; no additional HTTP listener. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AcpBridge } from './bridge.js'
import { applications, defaultApplication } from './applications.js'
import { desktopLaunch } from './autostart.js'
import { bundledCli, exists, listProfiles, checkProfile } from './cli-launch.js'
import { CONNECTIONS_PATH, DEFAULT_STARTUP, MANAGEMENT_PATH, type ManagementState } from './management-contract.js'
import { launcherPath } from './paths.js'
import { parseStartup, readStartup, writeStartup } from './startup-settings.js'

export async function managementState(bridge: AcpBridge, home: string): Promise<ManagementState> {
  const info = bridge.info()
  const desktop = desktopLaunch(process.execPath, process.platform, Boolean(process.versions.electron))
  const cli = bundledCli(process.execPath, process.platform)
  const launcher = launcherPath(home)
  const checks = await Promise.all([
    ['Launcher', launcher], ['Plugin', fileURLToPath(new URL('./stdio.js', import.meta.url))], ['Runtime', process.execPath],
  ].map(async ([label, path]) => ({ label: label!, ok: await exists(path!), detail: path! })))
  let settings
  try { settings = await readStartup(home) }
  catch (error) {
    settings = { ...DEFAULT_STARTUP, enabled: false }
    checks.push({ label: 'Startup settings', ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
  let lastStart: ManagementState['lastStart']
  try {
    const value = JSON.parse(await readFile(join(home, 'last-start.json'), 'utf8')) as Record<string, unknown>
    if (typeof value.at === 'string' && typeof value.ok === 'boolean' && typeof value.message === 'string') lastStart = { at: value.at, ok: value.ok, message: value.message }
  } catch { /* A new installation has no attempt yet. */ }
  const apps = await applications(home)
  const selectedApp = defaultApplication(apps, settings.defaultApp)
  const live = bridge.connectionState()
  return { applications: apps, ...(selectedApp ? { defaultApp: selectedApp.id } : {}), live, ready: live.ready, connections: live.connections, sessions: live.sessions, bridgeVersion: info.bridgeVersion,
    ...(info.runtimeVersion ? { runtimeVersion: info.runtimeVersion } : {}), profile: basename(process.cwd()), host: desktop?.name ?? 'DSH CLI', platform: process.platform, launcher,
    settings, desktopAvailable: Boolean(desktop),
    cliAvailable: Boolean(process.versions.electron && cli && await exists(cli)), profiles: await listProfiles(resolveDshHome()), checks,
    ...(lastStart ? { lastStart } : {}) }
}
export function installManagement(ctx: Context, bridge: AcpBridge, home: string): void {
  let saves: Promise<unknown> = Promise.resolve()
  ctx.inject(['connection'], inner => {
    const streams = new Set<() => void>()
    inner.effect(() => () => { for (const close of streams) close() }, 'ACP status streams')
    inner.connection.fetch.register({ path: CONNECTIONS_PATH, methods: ['GET'], requestBody: 'buffered',
      fetch: async request => {
        const headers = { 'cache-control': 'no-store' }
        if (new URL(request.url).searchParams.get('watch') !== '1') return Response.json(bridge.connectionState(), { headers })
        const encoder = new TextEncoder()
        let stop: (closeBody?: boolean) => void = () => {}
        let flush = () => {}
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            let closed = false
            let dirty = true
            const send = () => {
              if (closed || (controller.desiredSize ?? 0) <= 0) return
              controller.enqueue(encoder.encode(dirty ? `${JSON.stringify(bridge.connectionState())}\n` : '\n'))
              dirty = false
            }
            flush = () => { if (dirty) send() }
            const off = bridge.onConnectionsChanged(() => { dirty = true; send() })
            // Keep the transport alive without polling the connection registry or buffering stale snapshots.
            const heartbeat = setInterval(send, 20_000)
            heartbeat.unref()
            const abort = () => { stop() }
            stop = (closeBody = true) => {
              if (closed) return
              closed = true
              clearInterval(heartbeat); off()
              request.signal.removeEventListener('abort', abort)
              streams.delete(stop)
              if (closeBody) controller.close()
            }
            streams.add(stop)
            request.signal.addEventListener('abort', abort, { once: true })
            if (request.signal.aborted) stop(); else send()
          },
          pull() { flush() },
          cancel() { stop(false) },
        })
        return new Response(body, { headers: { ...headers, 'content-type': 'application/x-ndjson' } })
      },
    })
    inner.connection.fetch.register({ path: MANAGEMENT_PATH, methods: ['GET', 'POST'], requestBody: 'buffered',
      fetch: async (request: Request) => {
        const headers = { 'cache-control': 'no-store' }
        try {
          if (request.method === 'POST') {
            const body = await request.json() as { action?: unknown; settings?: unknown }
            const operation = saves.then(async () => {
              if (body.action === 'repair') await bridge.repairLauncher()
              else if (body.action === 'save') {
                const settings = parseStartup(body.settings)
                const state = await managementState(bridge, home)
                if (settings.defaultApp && !state.applications?.some(app => app.id === settings.defaultApp)) {
                  if (settings.enabled) throw new Error('Selected application is no longer available; refresh the panel')
                  delete settings.defaultApp
                }
                if (settings.enabled && settings.mode === 'desktop' && !settings.defaultApp && !state.desktopAvailable) throw new Error('No Desktop executable is available')
                if (settings.mode === 'cli') {
                  const app = state.applications?.find(app => app.id === (settings.defaultApp ?? state.defaultApp))
                  if (!app) throw new Error('Select the application for the saved CLI settings')
                  settings.applications = { ...settings.applications,
                    [app.id]: settings.applications?.[app.id] ?? { mode: 'cli', profile: settings.profile, dshHome: app.dshHome } }
                  settings.mode = 'desktop'; settings.profile = ''
                }
                if (settings.applications) {
                  for (const [id, config] of Object.entries(settings.applications)) {
                    const app = state.applications?.find(app => app.id === id)
                    if (!app) { delete settings.applications[id]; continue }
                    if (config.dshHome !== app.dshHome) throw new Error('Application data directory does not match its registration')
                    if (config.mode === 'cli') {
                      const check = await checkProfile(app.dshHome, config.profile)
                      if (!check.valid) throw new Error(check.reason)
                    }
                  }
                }
                await writeStartup(home, settings)
              } else throw new Error('Unknown management action')
            })
            saves = operation.catch(() => {})
            await operation
          }
          return Response.json(await managementState(bridge, home), { headers })
        } catch (error) {
          return Response.json({ error: error instanceof Error ? error.message : 'ACP management failed' }, { status: 400, headers })
        }
      },
    })
  })
}
