/**
 * Sidebar footer stacking, owned by Desktop in every presentation mode.
 *
 * Upstream renders `sidebar.footer.action` as a `display: contents` anchor
 * inside a row flex container, so several registered launchers become flex
 * siblings on one line and crush each other. Desktop stacks them instead.
 *
 * The rule deliberately carries no `data-dsh-desktop-mode` prefix: compatibility
 * mode serves its titlebar from a separate chrome view and never marks the body,
 * and the stylesheet only ever installs from the Desktop client bundle, which
 * exits before this point for an ordinary browser URL.
 */

const STYLE_ID = 'dsh-desktop-sidebar-footer-styles'

/**
 * The `body` prefix is load-order insurance, not decoration. Plugin stylesheets
 * are appended to head at apply time, so source order cannot settle a tie, and
 * `body [data-slot=…]` (0,1,1) beats any single-class rule a launcher may aim
 * at the slot. The children rule claims only flex participation, so every
 * launcher keeps its own seat — including `.dshMarketLauncher[data-wide='false']`
 * and its circular rail geometry.
 *
 * Geometry defers to upstream's own footer row (`SettingsRoot.module.css`
 * `.triggerRow`): a footer seat spans `100% + 4px` at `margin: -2px`, bleeding
 * 2px per side, and both registered launchers already follow that house rule.
 * So the slot is not resized — it is re-centered. The anchor grows 4px per side
 * and pays 4px of it back as padding, leaving a content box exactly as wide as
 * the slot: the launchers keep their native bleed and land pixel-flush with the
 * Settings row, while the extra border-box width becomes clip clearance. That
 * matters because the seat stays height-bounded (extra third-party launchers
 * must not swallow the workspace list) and `overflow-y` therefore makes it a
 * scroll container clipping at the padding box, which is what used to shave the
 * rounded corners. No width is forced on the children: React renders Tooltip
 * bubbles inside this same anchor, and a `width: 100%` there stretches them to
 * the viewport. A reserved scrollbar gutter is exactly what made the right
 * inset disagree with the left, so there is none.
 */
const CSS = `
body [data-slot="sidebar.footer.action"] {
  display: flex !important;
  box-sizing: border-box;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  min-width: 0;
  width: calc(100% + 8px);
  margin-inline: -4px;
  max-height: min(40vh, 240px);
  padding: 0 4px;
  overflow-y: auto;
  overscroll-behavior: contain;
}
body [data-slot="sidebar.footer.action"] > * {
  flex: none;
  min-width: 0;
}
`

/** Install the footer stacking sheet once; tolerate headless Client boot. */
export function installSidebarFooterStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  if (document.getElementById(STYLE_ID) !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = 'dsh-plugin-desktop'
  style.dataset.pluginCss = 'dsh-plugin-desktop/sidebar-footer'
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}
