/**
 * Anywhere account page styles. The cards take the official account page's measures (dsh-client-ui-settings-account in
 * 0.2.1-rc.5) under names of their own, since those class names are hashed per release; the usage board follows the
 * one-series chart spec: thin columns, hairline grid, text in text tokens.
 */
const SERIES = 'var(--dsw-alias-brand-primary-new-colorprimary-new-color, #4176e6)'

const CSS = `
/* The page outside Settings: a scrolling column like the main panels', also the body of its Conversation View. */
.dshAnywhereStandalone { display: flex; flex: 1; flex-direction: column; min-width: 0; min-height: 0; height: 100%; }
.dshAnywhereStandaloneScroll { flex: 1; min-height: 0; overflow: auto; scrollbar-gutter: stable; }
.dshAnywhereStandaloneScroll > .dshDesktopSettings {
  box-sizing: border-box; width: min(100%, 880px); margin: 0 auto; padding: 28px clamp(24px, 4vw, 48px) 48px;
}
.dshAnywhereStandalone[data-view] .dshAnywhereStandaloneScroll > .dshDesktopSettings { padding-top: 20px; }
[data-next-anywhere-account] .dshDesktopSettingsHeader h2 { display: flex; align-items: center; gap: 8px; }
.dshAnywhereSection { display: flex; flex-direction: column; gap: 16px; font-size: 13px; line-height: 22px; color: var(--dsw-alias-label-primary); }
.dshAnywhereSection p { margin: 0; }
.dshAnywhereCard,
.dshAnywhereBalanceCard,
.dshAnywhereUsageCard {
  border: .5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.dshAnywhereCard, .dshAnywhereBalanceCard { padding: 12px 16px; }
.dshAnywhereCard, .dshAnywhereRow { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dshAnywhereIdentity { display: flex; align-items: center; gap: 10px; min-width: 0; min-height: 44px; }
.dshAnywhereAvatar {
  display: flex; flex: none; align-items: center; justify-content: center;
  width: 32px; height: 32px; border-radius: 50%;
  color: var(--dsw-alias-label-tertiary); background: var(--dsw-alias-bg-skeleton);
}
.dshAnywhereIdentityCopy, .dshAnywhereRowCopy { display: flex; flex-direction: column; min-width: 0; }
.dshAnywhereName { font-size: 14px; font-weight: 500; }
.dshAnywhereSecondary { color: var(--dsw-alias-label-tertiary); }
.dshAnywhereAccountInfo {
  display: inline-flex; flex: none; align-items: center; gap: 2px;
  color: var(--dsw-alias-label-primary); font-size: 13px; text-decoration: none;
}
.dshAnywhereAccountInfo:hover { text-decoration: underline; }
.dshAnywhereBalanceCard { display: flex; flex-direction: column; gap: 8px; }
.dshAnywhereRow { box-sizing: border-box; min-height: 40px; padding: 6px 0; }
.dshAnywhereRowText { text-align: right; }
.dshAnywhereDivider { border-top: .5px solid var(--dsw-alias-border-l2); }
.dshAnywhereActions { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; }
.dshAnywhereLinkButton {
  box-sizing: border-box; display: inline-flex; flex: none; align-items: center; justify-content: center;
  min-width: 58px; height: 36px; padding: 0 14px;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-primary);
  font-size: 14px; line-height: 22px; white-space: nowrap; text-decoration: none;
}
.dshAnywhereLinkButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshAnywherePrimary {
  border-color: transparent; font-weight: 500;
  color: var(--dsw-alias-label-primary-foreground); background: var(--dsw-alias-button-primary-fill);
}
.dshAnywherePrimary:hover { background: var(--dsw-alias-button-primary-hover); }
.dshAnywhereSignedOut { flex-direction: column; justify-content: center; gap: 8px; padding: 28px 16px; text-align: center; }
.dshAnywhereSignedOut .dshAnywhereActions { justify-content: center; margin-top: 8px; }
.dshAnywhereSignedOutTitle { font-size: 14px; }
.dshAnywhereSignedOutDescription { color: var(--dsw-alias-label-tertiary); font-size: 12px; line-height: 18px; }
.dshAnywhereSignIn { min-width: 72px; }
.dshAnywhereAmountColumn { display: flex; flex-direction: column; align-items: flex-end; }
.dshAnywhereAmount { font-size: 18px; font-weight: 510; line-height: 28px; }

.dshAnywhereNav { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 8px; padding-bottom: 8px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dshAnywhereNavCell {
  box-sizing: border-box; display: inline-flex; align-items: center; gap: 8px;
  height: 36px; padding: 0 14px 0 12px; border: 0; border-radius: var(--dsw-radius-md);
  background: transparent; color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 14px; line-height: 22px; white-space: nowrap; cursor: pointer;
}
.dshAnywhereNavCell:hover { background: var(--dsw-specific-sidebar-nav-item-hover); }
.dshAnywhereNavCell[aria-selected="true"] { background: var(--dsw-specific-sidebar-nav-item-active); }
.dshAnywhereNavCell:focus-visible, .dshAnywhereDisclosure:focus-visible {
  outline: var(--dsw-focus-ring-width, 2px) solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.dshAnywherePanel { display: flex; flex-direction: column; gap: 12px; }
.dshAnywherePanelHead { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dshAnywhereRows { display: flex; flex-direction: column; }
.dshAnywhereRows > :last-child, .dshAnywhereRows > .dshDesktopSettingsExpandableGroup:last-child > :last-child { border-bottom: 0; }
.dshAnywhereRowsNote { padding: 16px 0; }
.dshAnywhereDisclosure { width: 100%; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.dshAnywhereDisclosure:hover .dshDesktopSettingsExpander { background: var(--dsw-alias-interactive-bg-hover); }
.dshAnywhereDisclosure[aria-expanded="true"] .dshDesktopSettingsExpander svg { transform: rotate(180deg); }
.dshAnywhereModel { padding-left: 12px; }
.dshAnywhereModelTitle { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshAnywhereModel[data-off] .dshAnywhereModelTitle { color: var(--dsw-alias-label-tertiary); }
.dshAnywhereModelEdit { display: flex; align-items: center; gap: 6px; max-width: 420px; }
.dshAnywhereModelEdit > :first-child { flex: 1; min-width: 0; }
.dshAnywhereIconButton {
  display: inline-flex; flex: none; align-items: center; justify-content: center;
  width: 22px; height: 22px; padding: 0; border: 0; border-radius: 6px;
  background: transparent; color: var(--dsw-alias-label-tertiary); opacity: 0; cursor: pointer;
}
.dshAnywhereModel:hover .dshAnywhereIconButton, .dshAnywhereIconButton:focus-visible { opacity: 1; }
.dshAnywhereIconButton:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshAnywherePanelHead .dshAnywhereActions { flex: none; }
/* The official catalog draws its own rule on top, which takes the place of the open row's. */
.dshAnywhereRouteGroup > .dshAnywhereDisclosure[aria-expanded="true"] { border-bottom: 0; }
.dshAnywhereRouteEditor { display: flex; flex-direction: column; gap: 12px; padding-bottom: 16px; border-bottom: .5px solid var(--dsw-alias-border-l2); }

.dshAnywhereFilters { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.dshAnywhereFiltersEnd { margin-left: auto; }
.dshAnywhereFilters .dshDesktopSettingsSelect { max-width: 220px; }
.dshAnywhereFilters .dshDesktopSettingsSelect > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.dshAnywhereInlineProblem { display: flex; align-items: center; justify-content: space-between; gap: 12px; color: var(--dsw-alias-label-secondary); }
.dshAnywhereBoard { display: flex; flex-direction: column; gap: 12px; transition: opacity .15s; }
.dshAnywhereBoard[data-loading] { opacity: .5; }
.dshAnywhereStats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
.dshAnywhereStat {
  display: flex; flex-direction: column; min-width: 0; padding: 12px 16px;
  border: .5px solid var(--dsw-alias-settings-card-stroke);
  border-radius: var(--dsw-radius-xl);
  background: var(--dsw-alias-settings-card-fill);
}
.dshAnywhereStatValue { overflow: hidden; font-size: 20px; font-weight: 600; line-height: 30px; text-overflow: ellipsis; white-space: nowrap; }
.dshAnywhereStatDetail { font-size: 12px; line-height: 18px; }
.dshAnywhereUsageCard { margin: 0; padding: 12px 16px; }
.dshAnywherePanelTitle { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; margin-bottom: 8px; font-weight: 500; }
.dshAnywhereEmpty { padding: 28px 0; color: var(--dsw-alias-label-tertiary); text-align: center; }
.dshAnywhereChart { position: relative; width: 100%; }
.dshAnywhereChart svg { display: block; overflow: visible; }
.dshAnywhereGrid { stroke: var(--dsw-alias-border-l2); stroke-width: 1; shape-rendering: crispEdges; }
.dshAnywhereTick { fill: var(--dsw-alias-label-tertiary); font-size: 11px; font-variant-numeric: tabular-nums; }
.dshAnywherePeak { fill: var(--dsw-alias-label-secondary); font-size: 11px; font-weight: 500; pointer-events: none; }
.dshAnywhereBoard {
  --dsh-anywhere-series-1: #2a78d6; --dsh-anywhere-series-2: #eb6834; --dsh-anywhere-series-3: #1baf7a;
  --dsh-anywhere-series-4: #eda100; --dsh-anywhere-series-5: #e87ba4; --dsh-anywhere-series-other: #a3a3a3;
}
body[data-ds-dark-theme] .dshAnywhereBoard {
  --dsh-anywhere-series-1: #3987e5; --dsh-anywhere-series-2: #d95926; --dsh-anywhere-series-3: #199e70;
  --dsh-anywhere-series-4: #c98500; --dsh-anywhere-series-5: #d55181; --dsh-anywhere-series-other: #5c5c5c;
}
.dshAnywhereBar { fill: ${SERIES}; }
.dshAnywhereStack[data-active] { opacity: .78; }
.dshAnywhereSwatch { flex: none; width: 8px; height: 8px; border-radius: 2px; }
.dshAnywhereLegend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin: 12px 0 0; padding: 0; list-style: none; font-size: 12px; line-height: 18px; }
.dshAnywhereLegend li { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.dshAnywhereLegendName { max-width: 200px; overflow: hidden; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: nowrap; }
.dshAnywhereLegendValue { color: var(--dsw-alias-label-tertiary); font-variant-numeric: tabular-nums; }
.dshAnywhereTooltipRow { display: flex; align-items: center; gap: 6px; }
.dshAnywhereTooltipValue { margin-left: auto; padding-left: 12px; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshAnywhereHit { outline: none; cursor: default; }
.dshAnywhereHit:focus-visible { stroke: var(--dsw-alias-label-tertiary); stroke-width: 1; }
.dshAnywhereTooltip {
  position: absolute; z-index: 2; display: flex; flex-direction: column;
  min-width: 96px; padding: 6px 10px; pointer-events: none;
  border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md);
  background: var(--dsw-alias-bg-layer-1); box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
  color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; white-space: nowrap;
}
.dshAnywhereTooltip[data-before] { transform: translateX(-100%); }
.dshAnywhereTooltip strong { color: var(--dsw-alias-label-primary); font-size: 13px; font-weight: 600; }
.dshAnywhereTooltipDate { color: var(--dsw-alias-label-tertiary); }
.dshAnywhereTableFrame { overflow-x: auto; }
.dshAnywhereTable { width: 100%; border-collapse: collapse; font-size: 12px; line-height: 18px; }
.dshAnywhereTable th, .dshAnywhereTable td { padding: 6px 0 6px 12px; text-align: right; white-space: nowrap; font-weight: 400; font-variant-numeric: tabular-nums; }
.dshAnywhereTable th:first-child { max-width: 220px; overflow: hidden; padding-left: 0; text-align: left; text-overflow: ellipsis; }
.dshAnywhereTable thead th { color: var(--dsw-alias-label-tertiary); }
.dshAnywhereTable tbody tr { border-top: .5px solid var(--dsw-alias-border-l2); }
.dshAnywhereTable tbody th { color: var(--dsw-alias-label-primary); font-variant-numeric: normal; }
.dshAnywhereRangeNote { font-size: 12px; line-height: 18px; text-align: right; }
@media (max-width: 640px) {
  .dshAnywhereStats { grid-template-columns: minmax(0, 1fr); }
}
`

export function installAnywhereAccountStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.owner = 'dsh-desktop-next-anywhere-account'
  style.textContent = CSS
  document.head.append(style)
  return () => { style.remove() }
}
