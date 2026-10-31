/** Next-owned surfaces; window dragging belongs to the official frontend. */
const STYLES = `
.dshNextSafeModeNotice{position:absolute;right:16px;bottom:16px;max-width:300px;padding:12px;border:1px solid var(--dsw-alias-border-l3);border-radius:10px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:12px/1.5 system-ui,sans-serif;pointer-events:auto;-webkit-app-region:no-drag}
.dshNextSafeModeNotice p{margin:5px 0 8px}.dshNextSafeModeNotice button{font:inherit;border:1px solid currentColor;border-radius:5px;padding:4px 8px;background:transparent;color:inherit;cursor:pointer}

.dshNextSafeModeNotice .dshNextSafeModeDismiss{float:right;border:0;margin:-4px -4px 0 8px;padding:0 6px;font-size:20px;line-height:24px}

/* Respect the native-material preference without replacing official layout. */
html[data-next-material='off'][data-platform='darwin'] :has(> [data-shell-overlay]) {
  background: var(--dsw-alias-bg-base);
}

/* Keep Settings nav items at their 40x164 geometry and scroll with the official l2 gutter. */
body [data-shortcut-modal='settings'] > nav {
  min-height: 0;
}
body [data-shortcut-modal='settings'] > nav > :first-child,
body [data-shortcut-modal='settings'] > nav > :last-child > * {
  flex: none;
}
body [data-shortcut-modal='settings'] > nav > :last-child {
  flex: 1;
  min-height: 0;
  margin-right: -10px;
  padding-right: calc(10px - var(--dsh-scrollbar-width, 5px));
  padding-bottom: 12px;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
}
`

export function installWindowStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop-beta/window-controls'
  style.textContent = STYLES
  document.head.append(style)
  return () => style.remove()
}
