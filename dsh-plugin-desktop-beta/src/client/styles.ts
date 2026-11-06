/** Next-owned surfaces, plus corrections to the official frontend's macOS window drag. */
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

/* Chromium collects app-region boxes without clipping them, in document order, and the last box
   containing a point decides it. A control scrolled beneath a chrome row therefore subtracts its
   whole box from the row's drag, which the official frontend leaves unguarded. The scrollers below
   chrome rows (the transcript, the Plugins page, the workspace list and dock pane bodies) never paint
   their content over a drag row, so that content declares no region; the reset on each root also stops
   a region inherited from a pane body. Surfaces that can escape a scroller and the rows pinned inside
   one keep theirs. The control list is the official interactive no-drag list, whose html-prefixed
   specificity a scoped rule can only override with !important. */
@scope (html[data-platform='darwin'] :is([data-conversation-scroll], [data-plugin-body], [role='tree'], :is([data-dockkit-content], [data-dockkit-pane]) > :not(:first-child) > *))
  to (dialog, [popover], [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='tooltip'], [data-window-drag], [data-plugin-bar]) {
  :scope,
  :is(
    button, a, input, select, textarea, summary, [contenteditable='true'], [tabindex],
    [role='dialog'], [role='alertdialog'], [role='menu'], [role='listbox'], [role='tooltip'],
    [role='button'], [role='link'], [role='tab'], [role='menuitem'], [role='menuitemcheckbox'],
    [role='menuitemradio'], [role='option'], [role='checkbox'], [role='radio'], [role='switch'],
    [role='slider'], [role='combobox'], [role='textbox']
  ) {
    -webkit-app-region: initial !important;
  }
}

/* The collapsed Plugins head keeps its resting box but paints only its top part, and the content
   below that part is visible, so only the painted part drags. */
html[data-platform='darwin'] [data-plugin-bar][data-natural] [data-window-drag]::after {
  content: '';
  position: absolute;
  inset: var(--plugin-header-paint-height) 0 0;
  pointer-events: none;
  -webkit-app-region: no-drag;
}
`

export function installWindowStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop-beta/window-controls'
  style.textContent = STYLES
  document.head.append(style)
  return () => style.remove()
}
