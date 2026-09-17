/** Styles for the Desktop browser right column, expressed with the product's own design tokens. */

/** Panel stylesheet, kept as a string so the client bundle stays self-contained. */
export const DESKTOP_BROWSER_STYLES = `
.dshDesktopBrowserPanel { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; min-width: 0; min-height: 0; overflow: hidden; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font-size: 13px; }
.dshDesktopBrowserPanelToolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; row-gap: 4px; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); -webkit-app-region: no-drag; }
.dshDesktopBrowserPanelButton { display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dshDesktopBrowserPanelButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopBrowserPanelButton:disabled { opacity: 0.38; cursor: default; }
.dshDesktopBrowserPanelButton[data-active="true"] { background: var(--dsw-alias-interactive-bg-active); color: var(--dsw-alias-label-primary); }
/* An expanded panel is positioned by its own edges, so its width must not stay 100%. */
.dshDesktopBrowserPanel[data-fullscreen="true"] { width: auto; box-shadow: 0 -1px 0 var(--dsw-alias-border-l1); }
.dshDesktopBrowserPanelDivider { width: 1px; height: 16px; margin: 0 2px; background: var(--dsw-alias-border-l1); }
.dshDesktopBrowserPanelAddress { flex: 1 1 130px; min-width: 84px; height: 26px; padding: 0 10px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font: inherit; }
.dshDesktopBrowserPanelAddress:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.dshDesktopBrowserPanelTabs { display: flex; align-items: stretch; gap: 2px; padding: 4px 6px 0; overflow-x: auto; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); scrollbar-width: thin; }
.dshDesktopBrowserPanelTab { display: inline-flex; flex: 0 1 auto; align-items: center; gap: 6px; min-width: 56px; max-width: 200px; padding: 5px 8px; border: 1px solid transparent; border-bottom: 0; border-radius: 8px 8px 0 0; color: var(--dsw-alias-label-secondary); cursor: pointer; white-space: nowrap; }
.dshDesktopBrowserPanelTab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopBrowserPanelTab[data-active="true"] { border-color: var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); }
.dshDesktopBrowserPanelTabTitle { overflow: hidden; text-overflow: ellipsis; }
.dshDesktopBrowserPanelTabClose { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; border: 0; border-radius: 4px; background: transparent; color: inherit; cursor: pointer; }
.dshDesktopBrowserPanelTabClose:hover { background: var(--dsw-alias-interactive-bg-hover); }
/* The column can be narrow while the Session has many tabs, so the new-tab
 * control stays pinned at the strip's right edge instead of scrolling away. */
.dshDesktopBrowserPanelNewTab { position: sticky; right: 0; margin-left: 2px; background: var(--dsw-alias-bg-layer-2); }
.dshDesktopBrowserPanelStage { position: relative; flex: 1; min-height: 120px; background: var(--dsw-alias-bg-base); }
.dshDesktopBrowserPanelEmpty { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; padding: 24px; text-align: center; color: var(--dsw-alias-label-tertiary); }
.dshDesktopBrowserPanelEmptyTitle { color: var(--dsw-alias-label-secondary); font-size: 14px; }
.dshDesktopBrowserPanelFailure { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 24px; background: var(--dsw-alias-bg-layer-1); text-align: center; }
.dshDesktopBrowserPanelFailureTitle { color: var(--dsw-alias-label-primary); font-size: 14px; }
.dshDesktopBrowserPanelFailureAddress { max-width: 100%; overflow-wrap: anywhere; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshDesktopBrowserPanelFailureReason { max-width: 100%; overflow-wrap: anywhere; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dshDesktopBrowserPanelFailureActions { display: flex; gap: 8px; }
.dshDesktopBrowserPanelStatus { display: flex; align-items: center; gap: 10px; padding: 5px 10px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dshDesktopBrowserPanelStatusSpacer { flex: 1; }
.dshDesktopBrowserPanelDot { width: 7px; height: 7px; border-radius: 50%; background: var(--dsw-alias-label-dimmed); }
.dshDesktopBrowserPanelDot[data-connected="true"] { background: var(--dsw-alias-brand-primary); }
.dshDesktopBrowserPanelError { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-top: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-mask-2); color: var(--dsw-alias-label-primary); font-size: 12px; }
.dshDesktopBrowserPanelMenu { position: absolute; z-index: 20; top: 38px; right: 8px; min-width: 190px; padding: 6px; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsw-alias-bg-overlay); box-shadow: 0 14px 32px rgb(0 0 0 / 24%); }
.dshDesktopBrowserPanelMenuItem { display: flex; align-items: center; justify-content: space-between; gap: 12px; width: 100%; padding: 6px 8px; border: 0; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary); font: inherit; text-align: left; cursor: pointer; }
.dshDesktopBrowserPanelMenuItem:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopBrowserPanelMenuItem[data-selected="true"] { color: var(--dsw-alias-brand-primary); }
.dshDesktopBrowserPanelMenuGroup { padding: 6px 8px 2px; color: var(--dsw-alias-label-tertiary); font-size: 11px; }
.dshDesktopBrowserPanelHistory { max-height: 220px; overflow-y: auto; }
.dshDesktopBrowserToggle { display: inline-flex; align-items: center; height: 28px; padding: 0 6px; border: 1px solid transparent; border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; cursor: pointer; }
.dshDesktopBrowserToggle:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopBrowserToggle[aria-pressed="true"] { border-color: var(--dsw-alias-button-ghost-active-border); background: var(--dsw-alias-button-ghost-active-fill); color: var(--dsw-alias-label-primary); }
`

/** Install the panel stylesheet once per renderer generation. */
export function installDesktopBrowserStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/browser-panel'
  style.textContent = DESKTOP_BROWSER_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
