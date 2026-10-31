/** Plugin-owned stylesheet for the Desktop terminal panel: xterm base rules plus drawer chrome. */
import xtermCss from '@xterm/xterm/css/xterm.css?raw'

const STYLE_ID = 'dsh-desktop-terminal-panel-styles'

/* Cursor colors depend on its cell, so they must not update xterm's shared ANSI theme. */
const CURSOR_CSS = `
.dshDesktopTerminalScreen .xterm-cursor { opacity: 1; }
.dshDesktopTerminalScreen .xterm .xterm-rows .xterm-cursor.xterm-cursor-block { background-color: var(--terminal-cursor); color: var(--terminal-cursor-accent); }
.dshDesktopTerminalScreen .xterm .xterm-rows .xterm-cursor.xterm-cursor-block:not(.xterm-cursor-blink) { background-color: var(--terminal-cursor) !important; color: var(--terminal-cursor-accent) !important; }
.dshDesktopTerminalScreen .xterm .xterm-rows .xterm-cursor.xterm-cursor-outline { outline-color: var(--terminal-cursor); }
.dshDesktopTerminalScreen .xterm .xterm-rows .xterm-cursor.xterm-cursor-bar { box-shadow: 1px 0 0 var(--terminal-cursor) inset; }
.dshDesktopTerminalScreen .xterm .xterm-rows .xterm-cursor.xterm-cursor-underline { border-bottom-color: var(--terminal-cursor); }
.dshDesktopTerminalScreen .xterm .xterm-rows.xterm-focus .xterm-cursor.xterm-cursor-block.xterm-cursor-blink { animation: dsh-terminal-cursor-blink 1s step-end infinite; }
@keyframes dsh-terminal-cursor-blink { 0% { background-color: var(--terminal-cursor); color: var(--terminal-cursor-accent); } 50% { background-color: var(--terminal-cursor-cell-background); color: var(--terminal-cursor-cell-foreground); } }
`

const CSS = `
.dshDesktopTerminalLauncher { width: max-content; max-width: 100%; min-width: 0; align-self: flex-start; justify-content: flex-start; margin-inline-start: 0; padding-inline: 0; }
.dshDesktopTerminalPanel {
  position: absolute;
  z-index: 2147483000;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  box-sizing: border-box;
  height: min(var(--dsh-desktop-terminal-height), 88vh, calc(100% - 8px));
  max-height: calc(100% - 8px);
  min-height: 200px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .24);
  font: 12px/1.45 var(--dsw-font-family, system-ui, sans-serif);
  pointer-events: auto;
}
.dshDesktopTerminalResizeHandle {
  position: absolute;
  z-index: 1;
  top: -3px;
  right: 0;
  left: 0;
  height: 8px;
  cursor: ns-resize;
  touch-action: none;
}
.dshDesktopTerminalResizeHandle::after {
  position: absolute;
  top: 3px;
  left: calc(50% - 18px);
  width: 36px;
  height: 3px;
  border-radius: 4px;
  background: var(--dsw-alias-border-l1);
  content: "";
}
.dshDesktopTerminalResizeHandle:hover::after,
.dshDesktopTerminalResizeHandle:focus-visible::after { background: var(--dsw-alias-brand-primary); }
.dshDesktopTerminalResizeHandle:focus-visible { outline: none; }
.dshDesktopTerminalTabStrip {
  display: flex;
  min-height: 38px;
  flex: 0 0 auto;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-2);
  user-select: none;
}
.dshDesktopTerminalTabs { display: flex; min-width: 0; flex: 1 1 auto; align-items: center; gap: 2px; overflow-x: auto; scrollbar-width: thin; }
.dshDesktopTerminalTab {
  display: inline-flex;
  min-width: 0;
  max-width: 260px;
  align-items: center;
  gap: 6px;
  padding: 4px 6px 4px 10px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.dshDesktopTerminalTab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalTab[data-active="true"] {
  border-color: var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-primary);
}
.dshDesktopTerminalTabLabel { overflow: hidden; text-overflow: ellipsis; font-family: var(--dsw-mono-font-family, ui-monospace, SFMono-Regular, Consolas, monospace); }
.dshDesktopTerminalTabClose {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font: inherit;
  visibility: hidden;
}
.dshDesktopTerminalTab:hover .dshDesktopTerminalTabClose,
.dshDesktopTerminalTab[data-active="true"] .dshDesktopTerminalTabClose { visibility: visible; }
.dshDesktopTerminalTabClose:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopTerminalTabPin {
  display: inline-flex;
  width: 18px;
  height: 18px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font: inherit;
  visibility: hidden;
}
.dshDesktopTerminalTab:hover .dshDesktopTerminalTabPin,
.dshDesktopTerminalTab[data-active="true"] .dshDesktopTerminalTabPin,
.dshDesktopTerminalTab[data-pinned="true"] .dshDesktopTerminalTabPin { visibility: visible; }
.dshDesktopTerminalTab[data-pinned="true"] .dshDesktopTerminalTabPin { color: var(--dsw-alias-brand-primary); }
.dshDesktopTerminalTab[data-pinned="true"] { border-style: dashed; border-color: var(--dsw-alias-border-l2); }
.dshDesktopTerminalTabPin:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshDesktopTerminalTabPin:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshDesktopTerminalFontSize { display: inline-flex; align-items: center; gap: 4px; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.dshDesktopTerminalFontSize select {
  height: 26px;
  padding: 1px 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: inherit;
  font: inherit;
}
.dshDesktopTerminalStripActions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.dshDesktopTerminalIconButton {
  display: inline-flex;
  min-width: 28px;
  min-height: 28px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 4px 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.dshDesktopTerminalIconButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalIconButton:disabled { cursor: not-allowed; opacity: .5; }
.dshDesktopTerminalIconButton:focus-visible,
.dshDesktopTerminalTab:focus-visible,
.dshDesktopTerminalTabClose:focus-visible,
.dshDesktopTerminalShellMenu summary:focus-visible,
.dshDesktopTerminalHistoryFilter input:focus-visible,
.dshDesktopTerminalHistoryButton:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
.dshDesktopTerminalShellMenu { position: relative; flex: 0 0 auto; }
.dshDesktopTerminalShellMenu summary { display: inline-flex; min-height: 28px; box-sizing: border-box; align-items: center; gap: 4px; padding: 4px 8px; border-radius: 6px; cursor: pointer; list-style: none; white-space: nowrap; }
.dshDesktopTerminalShellMenu summary::-webkit-details-marker { display: none; }
.dshDesktopTerminalShellMenu summary:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalShellMenuList {
  position: absolute;
  z-index: 6;
  right: 0;
  top: calc(100% + 4px);
  display: flex;
  min-width: 200px;
  max-height: 260px;
  flex-direction: column;
  gap: 2px;
  overflow: auto;
  padding: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, .5);
}
.dshDesktopTerminalShellItem { display: flex; min-height: 28px; align-items: center; gap: 8px; padding: 3px 8px; border: 0; border-radius: 5px; background: transparent; color: inherit; cursor: pointer; font: inherit; text-align: left; }
.dshDesktopTerminalShellItem:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalShellItem code { overflow: hidden; color: var(--dsw-alias-label-tertiary); text-overflow: ellipsis; white-space: nowrap; }
.dshDesktopTerminalShellHint { margin: 0; padding: 6px 8px; color: var(--dsw-alias-label-secondary); }
.dshDesktopTerminalBody { display: flex; min-height: 0; flex: 1 1 auto; }
.dshDesktopTerminalScreenWrap { position: relative; display: flex; min-width: 0; flex: 1 1 auto; flex-direction: column; }
.dshDesktopTerminalScreens { position: relative; flex: 1 1 auto; min-height: 0; }
/* Every visible tab keeps a mounted pane so switching Sessions or tabs never reconnects. */
.dshDesktopTerminalScreenPane {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: var(--dsw-alias-bg-base);
}
.dshDesktopTerminalScreenPane[data-visible="false"] { visibility: hidden; }
.dshDesktopTerminalScreen {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  box-sizing: border-box;
  overflow: hidden;
  padding: 6px 8px;
  color: var(--dsw-alias-label-primary);
  background: var(--dsw-alias-bg-base);
}
.dshDesktopTerminalScreen .xterm { height: 100%; }
.dshDesktopTerminalScreen .xterm-viewport { background: var(--dsw-alias-bg-base); }
.dshDesktopTerminalStatus {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 4px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-l2);
  color: var(--dsw-alias-label-secondary);
}
.dshDesktopTerminalError { margin: 0; padding: 6px 12px; overflow-wrap: anywhere; color: var(--dsw-alias-state-error-primary); background: var(--dsw-alias-bg-l2); }
.dshDesktopTerminalEmpty {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  min-height: 0;
  padding: 24px;
  color: var(--dsw-alias-label-secondary);
  text-align: center;
}
.dshDesktopTerminalPrimaryButton {
  display: inline-flex;
  min-height: 30px;
  align-items: center;
  gap: 6px;
  padding: 4px 14px;
  border: 1px solid transparent;
  border-radius: 7px;
  background: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
  cursor: pointer;
  font: inherit;
}
.dshDesktopTerminalHistory {
  display: flex;
  width: 280px;
  flex: 0 0 auto;
  flex-direction: column;
  border-left: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-layer-1);
  min-height: 0;
}
.dshDesktopTerminalHistoryHeader {
  display: flex;
  min-height: 34px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  padding: 2px 6px 2px 12px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}
.dshDesktopTerminalHistoryFilter { flex: 0 0 auto; padding: 6px 8px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDesktopTerminalHistoryFilter input {
  width: 100%;
  height: 28px;
  box-sizing: border-box;
  padding: 3px 9px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsw-alias-bg-base);
  color: inherit;
  font: inherit;
}
.dshDesktopTerminalHistoryList { min-height: 0; flex: 1 1 auto; overflow-y: auto; padding: 4px; scrollbar-gutter: stable; overscroll-behavior: contain; }
.dshDesktopTerminalHistoryRow {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: 5px;
  padding: 2px 2px 2px 6px;
}
.dshDesktopTerminalHistoryRow:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalHistoryCommand {
  min-width: 0;
  flex: 1 1 auto;
  overflow: hidden;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  font-family: var(--dsw-mono-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dshDesktopTerminalHistoryButton {
  display: inline-flex;
  width: 22px;
  height: 22px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  padding: 0;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--dsw-alias-label-tertiary);
  cursor: pointer;
  font: inherit;
  font-size: 13px;
}
.dshDesktopTerminalHistoryButton:hover { background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); }
.dshDesktopTerminalHistoryEmpty { margin: 0; padding: 14px 10px; color: var(--dsw-alias-label-tertiary); }
.dshDesktopTerminalHistoryNotice { padding: 0 10px 4px; color: var(--dsw-alias-state-success-primary); }
.dshDesktopTerminalSuggest {
  position: absolute;
  z-index: 7;
  display: flex;
  min-width: 240px;
  max-width: min(560px, 90%);
  max-height: 220px;
  flex-direction: column;
  overflow: hidden auto;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 -6px 28px rgba(0, 0, 0, .45);
  font-family: var(--dsw-mono-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
  font-size: 12px;
}
.dshDesktopTerminalSuggestItem {
  display: flex;
  min-height: 26px;
  align-items: center;
  gap: 8px;
  padding: 2px 8px;
  border: 0;
  border-radius: 5px;
  background: transparent;
  color: var(--dsw-alias-label-primary);
  cursor: pointer;
  font: inherit;
  text-align: left;
  white-space: pre;
}
.dshDesktopTerminalSuggestItem[data-first="true"] { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalSuggestItem:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshDesktopTerminalSuggestHint { padding: 3px 8px; color: var(--dsw-alias-label-tertiary); font-size: .9em; white-space: nowrap; }
.dshDesktopTerminalGhost {
  position: absolute;
  z-index: 5;
  overflow: hidden;
  color: var(--dsw-alias-label-tertiary);
  font-family: var(--dsw-mono-font-family, ui-monospace, SFMono-Regular, Menlo, Consolas, monospace);
  font-size: 13px;
  line-height: 1.2;
  opacity: .75;
  pointer-events: none;
  white-space: pre;
}
@media (max-width: 860px) {
  .dshDesktopTerminalHistory { width: 220px; }
}
@media (prefers-reduced-motion: no-preference) {
  .dshDesktopTerminalPanel { transition: height 120ms ease; }
}
`

/** Install the terminal panel stylesheet (xterm base + drawer chrome) and return its lifecycle disposer. */
export function installDesktopTerminalPanelStyles(owner: string): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = owner
  style.dataset.pluginCss = `${owner}/desktop-terminal-panel`
  style.textContent = `${xtermCss}\n${CURSOR_CSS}\n${CSS}`
  document.head.appendChild(style)
  return () => { style.remove() }
}
