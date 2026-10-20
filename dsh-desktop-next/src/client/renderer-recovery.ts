/** Report a mounted shell and preserve its panel selection across reloads. */
import type { Context } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { DesktopRendererBridge } from '../desktop-contract.ts'

export function installRendererRecovery(ctx: Context, bridge: DesktopRendererBridge): () => void {
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

  // This effect is installed only after the shell has mounted. Connection and
  // session recovery stay with their official owners and never gate page health.
  void bridge.report('healthy').catch(error => console.error('[next-recovery] readiness report failed', error))
  return releasePanel
}
