/**
 * Desktop find-bar presentation.
 *
 * Installed in every Desktop mode rather than only the advanced one: the bar
 * rides the frame-wide `shell.overlay` seat, which upstream already renders in
 * compatibility mode, and it is the only Desktop-owned surface on screen there.
 * The sheet is scoped to `dshFindBar*` names and to the two highlight names the
 * bar registers, so it cannot reach an upstream surface.
 */

const STYLE_ID = 'dsh-desktop-find-styles'

const CSS = `
.dshFindBar {
  position: absolute;
  z-index: 30;
  top: var(--dsh-find-top, 12px);
  right: 16px;
  display: flex;
  align-items: center;
  gap: 2px;
  box-sizing: border-box;
  min-width: 320px;
  padding: 4px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: 0 8px 24px rgb(0 0 0 / 18%);
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  line-height: 1;
  pointer-events: auto;
  -webkit-app-region: no-drag;
}
.dshFindBarInput {
  flex: 1;
  min-width: 0;
  height: 26px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font: inherit;
  outline: none;
}
.dshFindBarInput::placeholder { color: var(--dsw-alias-label-tertiary); }
.dshFindBarInput:focus-visible { box-shadow: inset 0 0 0 1px var(--dsw-alias-brand-primary); }
.dshFindBarCount {
  flex: none;
  min-width: 48px;
  padding: 0 4px;
  color: var(--dsw-alias-label-secondary);
  font-variant-numeric: tabular-nums;
  text-align: right;
  white-space: nowrap;
}
.dshFindBarButton {
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dshFindBarButton:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshFindBarButton:disabled { opacity: .4; }
.dshFindBarButton[aria-pressed="true"] {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshFindBarButton svg { width: 16px; height: 16px; stroke-width: 1.8; }
::highlight(dsh-desktop-find) {
  background-color: var(--dsw-alias-state-warn-primary);
  color: #1f1f1f;
}
::highlight(dsh-desktop-find-active) {
  background-color: var(--dsw-alias-brand-primary);
  color: var(--dsw-alias-label-primary-foreground);
}
`

/** Install the find-bar sheet once; tolerate headless Client boot. */
export function installDesktopFindStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/find-bar'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
