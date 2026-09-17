# Browser panel column ownership

Status: current in both editions.

2026-09-17: The Desktop browser panel draws its own layer over the right track, and the shipped right Sidebar keeps that track's seat. The panel yields when the Sidebar raises its own panel.

English | [中文](2026-09-17-browser-column-ownership.zh.md)

## Boundary

The right track has one seat, `rightbar`, registered by the shipped right Sidebar. The Desktop browser panel does not compete for it: it registers `desktop.browser.column`, a root-scoped slot that the Desktop frame renders as its own layer above the same track. Both surfaces therefore exist at once — the Sidebar's seat stays mounted while the panel is open, its session surface keeps answering `sidebarRight`, and the commands that open files or preview resources no longer fail for want of a mounted surface. An empty layer is pointer-transparent, so the Sidebar underneath keeps its own clicks.

## Column ownership

The frame's layout service records two independent presentations: what the Sidebar reports for itself through `openRightbar`/`closeRightbar`, and what the panel claims through `showBrowserColumn`/`hideBrowserColumn`. The panel's live claim outranks the Sidebar's report for as long as it lasts, because the panel is what the user sees; the frame lays the track out for whichever presentation is in force. A Sidebar panel that rises from hidden to shown while the browser holds the column is reported to the panel layer as `sidebarTakeover`; the panel closes itself for that Session and keeps its tabs, and the column returns to the Sidebar with its content already in place. The flag clears with the claim it interrupted, so a panel opened over an already-showing Sidebar stays open.

## Consequences

Releasing the panel withdraws only its own claim: a Sidebar that is showing keeps its track instead of being closed by the panel's exit. The single root-scoped layer follows the Session on screen, so several Sessions can hold open panels without registering competing occupants. A Desktop built without the shipped Sidebar reports no presentation at all, and the panel then uses the column by itself.
