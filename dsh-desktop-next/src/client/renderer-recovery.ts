/** Observe the official Connection and Session owners after the shell has mounted. */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type { DesktopRendererBridge } from '../desktop-contract.ts'
import type { DesktopRendererStatus } from '../renderer-recovery.ts'

export const rendererRecoveryInject = ['connection', 'sessions', 'remote']

export function installRendererRecovery(ctx: Context, bridge: DesktopRendererBridge): () => void {
  // Next typechecks Host and browser entry points together. Bind these two
  // services to their canonical browser faces instead of the Host Context merge.
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  const sessions = ctx.get('sessions') as unknown as ISessions
  let disposed = false
  let generation: number | undefined
  let synchronized: number | undefined
  let lastStatus: DesktopRendererStatus | undefined
  let releaseSession: (() => void) | undefined
  let selectedSession: ReturnType<typeof sessions.binding>
  const panelKey = `dsh-next.panel.${bridge.profile()}`

  // The official Workspace and Conversation stores already persist selection,
  // semantic drafts and views. Only global panel selection needs a Next carrier.
  try {
    const panel = sessionStorage.getItem(panelKey)
    if (panel) ctx.layout.selectPanel(panel as MainPanelId)
  } catch { /* A removed panel or unavailable browser storage must not prevent boot. */ }
  const releasePanel = ctx.layout.panelInfo.subscribe(() => {
    try {
      const panel = ctx.layout.panelInfo.getSnapshot().activePanelId
      if (panel === null) sessionStorage.removeItem(panelKey)
      else sessionStorage.setItem(panelKey, panel)
    } catch { /* Storage can be disabled or full. */ }
  })

  const report = (status: DesktopRendererStatus): void => {
    if (disposed || status === lastStatus) return
    lastStatus = status
    void bridge.report(status).catch(error => { if (!disposed) console.warn('[next-recovery] readiness report failed', error) })
  }
  const check = (): void => {
    if (disposed || generation === undefined || connection.generation.getSnapshot()?.id !== generation) return
    const list = sessions.list.getSnapshot()
    const current = Object.values(list.byId).find(row => (row.retainedBy.mainView ?? 0) > 0)
    const binding = current ? sessions.binding(current.id) : undefined
    if (binding !== selectedSession) {
      releaseSession?.()
      selectedSession = binding
      releaseSession = binding?.session.subscribe(check)
    }
    if (synchronized !== generation || list.phase !== 'ready') return
    // A selected history must actually reopen; loading the HTML or retaining an
    // id alone is not recovery. Empty/new installations have no selected history.
    if (current && binding?.session.getSnapshot().openState !== 'open') return
    report('healthy')
  }
  const changed = (): void => {
    if (disposed) return
    const next = connection.generation.getSnapshot()?.id
    if (next === generation) return
    generation = next
    synchronized = undefined
    releaseSession?.(); releaseSession = undefined; selectedSession = undefined
    if (next === undefined) { report(connection.state.getSnapshot() === 'disconnected' ? 'disconnected' : 'connecting'); return }
    report('syncing')
    // Join the official reconnect baseline pull. Streams resume under their own
    // owner; recovery never repeats prompts, tool calls or other writes.
    void (async () => {
      // refresh() intentionally folds Remote failures into the controller's state.
      // A cached `phase: ready` therefore cannot prove this generation is usable;
      // require a successful read on the same Remote before accepting health.
      const probe = await ctx.remote.session.list({})
      if (!probe.ok) throw new Error('Session readiness probe failed')
      if (disposed || generation !== next || connection.generation.getSnapshot()?.id !== next) return
      await sessions.refresh()
      if (disposed || generation !== next || connection.generation.getSnapshot()?.id !== next) return
      synchronized = next
      check()
    })().catch(error => { if (!disposed && generation === next) console.warn('[next-recovery] session synchronization failed', error) })
  }
  const releaseGeneration = connection.generation.subscribe(changed)
  const releaseState = connection.state.subscribe(() => {
    if (connection.generation.getSnapshot() === undefined) report(connection.state.getSnapshot() === 'disconnected' ? 'disconnected' : 'connecting')
  })
  const releaseList = sessions.list.subscribe(check)
  // undefined is also the initial generation: publish its waiting state explicitly.
  report('connecting')
  changed()
  return () => {
    disposed = true
    releaseGeneration(); releaseState(); releaseList(); releaseSession?.(); releasePanel()
  }
}
