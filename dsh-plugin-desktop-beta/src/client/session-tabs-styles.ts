/** Styles for the session tab strip, injected once with the client plugin. */
const STYLES = `
/* The strip is a compact tab row in the conversation header's leading seat. It takes the width it needs and the
   title row keeps the rest, so a narrow window shrinks the title before it shrinks the tabs. */
.dshNextSessionTabs { display: flex; align-items: center; gap: 6px; min-width: 0; max-width: 100%; }
.dshNextSessionTabsStrip { display: flex; align-items: center; gap: 4px; min-width: 0; overflow-x: auto; scrollbar-width: none; }
.dshNextSessionTabsStrip::-webkit-scrollbar { display: none; }
.dshNextSessionTab { display: flex; align-items: center; flex: none; max-width: 220px; height: 28px; padding: 0 2px 0 8px; box-sizing: border-box; border: .5px solid var(--dsw-alias-border-l2); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-secondary); }
.dshNextSessionTab:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshNextSessionTab[data-active] { background: var(--dsw-alias-bg-module-platform); border-color: var(--dsw-alias-border-l3); color: var(--dsw-alias-label-primary); }
.dshNextSessionTabButton { display: flex; align-items: center; gap: 6px; min-width: 0; padding: 0; border: 0; background: transparent; color: inherit; font: inherit; font-size: 12px; line-height: 18px; cursor: pointer; }
.dshNextSessionTabButton:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; border-radius: 6px; }
.dshNextSessionTabLabel { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshNextSessionTabClose { flex: none; width: 18px; height: 18px; padding: 0; border: 0; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-tertiary); font: inherit; font-size: 13px; line-height: 1; cursor: pointer; opacity: 0; }
.dshNextSessionTab:hover .dshNextSessionTabClose, .dshNextSessionTab[data-active] .dshNextSessionTabClose { opacity: 1; }
.dshNextSessionTabClose:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshNextSessionTabClose:focus-visible { opacity: 1; outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
/* The dot reports the Session, not the tab: a request waiting for the user outranks work in progress, which
   outranks a finished run nobody has read. */
.dshNextSessionTabDot { flex: none; width: 7px; height: 7px; border-radius: 50%; box-shadow: inset 0 0 0 1px var(--dsw-alias-border-l3); }
.dshNextSessionTab[data-state='running'] .dshNextSessionTabDot { background: var(--dsw-alias-brand-primary); box-shadow: none; }
.dshNextSessionTab[data-state='awaiting'] .dshNextSessionTabDot { background: var(--dsw-alias-state-warn-primary); box-shadow: none; }
.dshNextSessionTab[data-state='unread'] .dshNextSessionTabDot { background: var(--dsw-alias-brand-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-brand-primary) 22%, transparent); }
.dshNextSessionTab[data-state='cold'] .dshNextSessionTabDot { background: var(--dsw-alias-label-tertiary); opacity: .5; box-shadow: none; }
.dshNextSessionTabsActions { display: flex; align-items: center; flex: none; gap: 2px; }
.dshNextSessionTabsAction { width: 26px; height: 26px; padding: 0; border: .5px solid transparent; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-secondary); font: inherit; font-size: 13px; line-height: 1; cursor: pointer; }
.dshNextSessionTabsAction:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.dshNextSessionTabsAction:focus-visible { outline: 2px solid var(--dsw-alias-brand-primary); outline-offset: 1px; }
/* The header's title row sheds text before the strip does. */
@media (max-width: 720px) { .dshNextSessionTab { max-width: 150px; } }
@media (max-width: 520px) { .dshNextSessionTab { max-width: 110px; } }
`

export function installSessionTabsStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-plugin-desktop-beta/session-tabs'
  style.textContent = STYLES
  document.head.append(style)
  return () => style.remove()
}
