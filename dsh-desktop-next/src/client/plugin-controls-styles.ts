/** Shared by the official Plugins page and the in-app permission dialog. */
const STYLES = `
/* The slot anchor uses display:contents, so the page's direct-child width does not reach this flex item. */
.dshNextPluginControls { box-sizing: border-box; width: 100%; max-width: 960px; min-width: 0; display: grid; gap: 32px; color: var(--dsw-alias-label-primary); }
.dshNextPluginControls .dshDesktopSettingsGroup { padding-top: 0; border-top: 0; gap: 12px; }
.dshNextPluginControls h3 { font-size: 14px; line-height: 22px; font-weight: 500; }
.dshNextPluginControls .dshDesktopSettingsHint,
.dshNextPluginControls .dshDesktopSettingsGroupIntro { font-size: 13px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshNextPluginControls .dshDesktopSettingsGroupIntro { margin-top: 4px; }
.dshNextMarketHeader { display: flex; align-items: center; justify-content: space-between; gap: 20px; }
.dshNextMarketHeader > div { min-width: 0; }
.dshNextMarketHeader > [role="switch"], .dshNextMarketHeader > .dshNextPluginActions { flex: none; flex-wrap: nowrap; }
.dshNextMarketChoices { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 16px; }
.dshNextPluginSections { display: grid; gap: 2px; }
.dshNextPluginCard { position: relative; display: flex; align-items: center; min-width: 0; gap: 14px; margin: 0 -8px; padding: 8px; border-radius: 12px; }
.dshNextPluginCard:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshNextPluginIcon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 48px; height: 48px; border: .5px solid var(--dsw-alias-border-l3); border-radius: 10px; color: var(--dsw-alias-label-secondary); }
.dshNextPluginCardMain { display: grid; flex: 1; min-width: 0; gap: 4px; }
.dshNextPluginCardOpen { width: max-content; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; font: inherit; font-size: 14px; line-height: 20px; font-weight: 500; cursor: pointer; }
.dshNextPluginCardOpen::after { content: ''; position: absolute; inset: 0; border-radius: 12px; }
.dshNextPluginCardOpen:focus-visible { outline: none; }
.dshNextPluginCardOpen:focus-visible::after { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 2px; }
.dshNextPluginCardDescription { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 18px; }
.dshNextPluginCardActions { position: relative; z-index: 1; flex: none; }
.dshNextPluginCardActions .dshNextPluginDetail, .dshNextPluginCardActions .dshNextComputerUse { display: block; }
.dshNextPluginCardActions .dshNextPluginActions { flex-wrap: nowrap; }
.dshNextPluginDetail, .dshNextComputerUse { display: grid; gap: 12px; }
.dshNextPluginActions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.dshNextPluginCardActions [role="status"], .dshNextPluginCardActions [role="alert"] { display: block; max-width: 220px; white-space: normal; }
button.dshNextSettingsGear { width: 28px; padding: 0; }
.dshNextPluginSettingsNotice { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 16px; border: 1px solid var(--dsw-alias-border-l1); }
.dshNextPluginSettingsNotice > span { flex: 1 1 220px; }
.dshNextPluginSettingsNotice > button { flex-shrink: 0; }
.dshNextPluginControls p { margin: 0; }
.dshNextPermissionsDialog[role="dialog"] { width: min(620px, calc(100vw - 48px)); max-height: calc(100dvh - 48px); overflow: hidden; --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l2); }
.dshNextPermissionsDialog[role="dialog"] > div:first-child { min-height: 0; flex: 1; overflow: hidden; }
.dshNextPermissionsDialog[role="dialog"] > div:first-child > div:last-child { min-height: 0; flex: 1; overflow-y: auto; overscroll-behavior: contain; }
.dshNextPermissionList { display: grid; gap: 0; }
.dshNextPermissionRow { display: flex; justify-content: space-between; align-items: center; gap: 24px; padding: 18px 0; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshNextPermissionRow:last-child { border-bottom: 0; }
.dshNextPermissionCopy { flex: 1; min-width: 0; font-size: 14px; }
.dshNextPermissionRow .dshNextPluginActions { flex-shrink: 0; justify-content: flex-end; max-width: 210px; }
.dshNextPermissionStatus { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.dshNextComponentSection { display: flex; flex-direction: column; gap: 12px; margin-top: 12px; }
.dshNextComponentSectionHead { display: flex; align-items: baseline; gap: 10px; }
.dshNextComponentSectionTitle { margin: 0; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshNextComponentSectionCount { font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshNextComponentRows { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.dshNextComponentRow { padding: 12px 2px; border-bottom: .5px solid var(--dsw-alias-border-l2); }
.dshNextComponentRow:last-child { border-bottom: 0; }
.dshNextComponentRowLine { display: flex; align-items: center; gap: 16px; min-width: 0; }
.dshNextComponentRowIcon { display: inline-flex; flex: none; align-items: center; justify-content: center; width: 40px; height: 40px; border: .5px solid var(--dsw-alias-border-l3); border-radius: var(--dsw-radius-md, 8px); color: var(--dsw-alias-label-secondary); }
.dshNextComponentRowMain { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
.dshNextComponentRowId { font-size: 13.5px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); overflow-wrap: anywhere; }
.dshNextComponentRow[data-state="off"] .dshNextComponentRowId { color: var(--dsw-alias-label-secondary); }
.dshNextComponentRowModule { font-family: var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace); font-size: 11.5px; line-height: 16px; color: var(--dsw-alias-label-tertiary); overflow-wrap: anywhere; }
.dshNextComponentRowState { display: inline-flex; flex: none; align-items: center; gap: 6px; font-size: 12.5px; line-height: 18px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
[data-plugin-item-detail="desktop-next-computer-use"] > [data-window-drag] > div > span:first-child > svg { display: none; }
[data-plugin-item-detail="desktop-next-computer-use"] > [data-window-drag] > div > span:first-child::before { content: ''; width: 36px; height: 36px; background: no-repeat center / 36px 36px url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36' fill='none'%3E%3Cg stroke='url(%23g)' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M14.9 7.93L15.73 11.01'/%3E%3Cpath d='M24.29 10.4L22.02 12.66'/%3E%3Cpath d='M8.03 14.77L11.14 15.6'/%3E%3Cpath d='M10.53 24.15L12.79 21.89'/%3E%3Cpath d='M17.38 17.23L28.01 20.53L22.74 22.7L20.61 27.86Z' fill='url(%23g)' fill-opacity='0.2'/%3E%3C/g%3E%3Cdefs%3E%3ClinearGradient id='g' x1='8' y1='8' x2='28' y2='28' gradientUnits='userSpaceOnUse'%3E%3Cstop stop-color='%2354ECE7'/%3E%3Cstop offset='1' stop-color='%23658EFF'/%3E%3C/linearGradient%3E%3C/defs%3E%3C/svg%3E"); }
.dshNextMarketSourceSectionHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 16px 0 6px; font-size: 14px; }
.dshNextMarketSourceSectionHeader + .dshNextPermissionRow { padding-top: 12px; }
.dshNextMarketSourceHeader { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
.dshNextMarketSourceHeaderMain { display: grid; gap: 4px; flex: 1; min-width: 0; }
.dshNextMarketSourceTitle { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; }
.dshNextMarketSourceEndpoints { display: grid; gap: 8px; margin-top: 10px; }
.dshNextMarketSourceItem { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 8px 10px; border-radius: 8px; border: .5px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform); }
.dshNextMarketSourceItemMain { display: grid; gap: 4px; flex: 1; min-width: 0; }
.dshNextMarketSourceUrl { font-family: var(--ds-font-family-code); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); overflow-wrap: anywhere; }
button.dshNextMarketRemoveBtn { border-color: color-mix(in srgb, var(--dsw-alias-state-error-primary) 35%, transparent); background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 10%, transparent); color: var(--dsw-alias-state-error-primary); }
button.dshNextMarketRemoveBtn:hover:not(:disabled) { background: color-mix(in srgb, var(--dsw-alias-state-error-primary) 16%, transparent); }
.dshNextMarketSourceNotice { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 8px; padding: 10px 12px; border-radius: var(--dsw-radius-md, 8px); background: var(--dsw-alias-state-warn-tertiary); font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
.dshNextMarketSourceNoticeCopy { display: flex; align-items: flex-start; gap: 8px; flex: 1; min-width: 0; }
.dshNextMarketSourceNoticeCopy > svg { flex: none; margin-top: 2px; color: var(--dsw-alias-state-warn-primary); }
.dshNextMarketSourceNotice > button { flex: none; }
@media(max-width: 560px) { .dshNextMarketChoices { grid-template-columns: 1fr; } .dshNextPluginCard { align-items: flex-start; flex-wrap: wrap; } .dshNextPluginCardMain { flex-basis: calc(100% - 68px); } .dshNextPluginCardActions { margin-left: 62px; } .dshNextPermissionRow, .dshNextMarketSourceSectionHeader, .dshNextMarketSourceHeader, .dshNextMarketSourceItem, .dshNextMarketSourceNotice { align-items: flex-start; flex-direction: column; gap: 12px; } .dshNextPermissionRow .dshNextPluginActions { max-width: none; } }
`

export function installPluginControlsStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-desktop-next/plugin-controls'
  style.textContent = STYLES
  document.head.append(style)
  return () => style.remove()
}
