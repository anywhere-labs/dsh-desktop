/** Panel routes use DSH's authenticated connection; no additional HTTP listener. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-connection'
import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { desktopLaunch } from './autostart.js'
import type { AcpBridge } from './bridge.js'
import { CONNECTIONS_PATH, MANAGEMENT_PATH, type ManagementState } from './management-contract.js'
import { launcherPath } from './paths.js'

async function exists(path: string): Promise<boolean> { try { await access(path); return true } catch { return false } }

export async function managementState(bridge: AcpBridge, home: string): Promise<ManagementState> {
  const info = bridge.info()
  const launcher = launcherPath(home)
  const checks = await Promise.all([
    ['Launcher', launcher], ['Plugin', fileURLToPath(new URL('./stdio.js', import.meta.url))], ['Runtime', process.execPath],
  ].map(async ([label, path]) => ({ label: label!, ok: await exists(path!), detail: path! })))
  const live = bridge.connectionState()
  return { live, ready: live.ready, connections: live.connections, sessions: live.sessions, bridgeVersion: info.bridgeVersion,
    ...(info.runtimeVersion ? { runtimeVersion: info.runtimeVersion } : {}), profile: basename(process.cwd()),
    host: desktopLaunch(process.execPath, process.platform, Boolean(process.versions.electron))?.name ?? 'DSH CLI', launcher, checks }
}
export function installManagement(ctx: Context, bridge: AcpBridge, home: string): void {
  let operations: Promise<unknown> = Promise.resolve()
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
            const body = await request.json() as { action?: unknown }
            const operation = operations.then(async () => {
              if (body.action !== 'repair') throw new Error('Unknown management action')
              await bridge.repairLauncher()
            })
            operations = operation.catch(() => {})
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
