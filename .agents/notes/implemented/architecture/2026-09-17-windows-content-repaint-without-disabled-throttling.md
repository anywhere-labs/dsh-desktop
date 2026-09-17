# Windows content repaint without disabled throttling

## Context

The compatibility content view disabled `backgroundThrottling` on Windows to keep its separate compositor painting while the window was minimized. Electron applies that flag to the whole window: with one webContents opting out, frames are drawn and swapped for every view the window hosts. The renderer was therefore never backgrounded, and a renderer that is never backgrounded never reaches the state in which Chromium evicts tiles, purges decoded images, or delivers memory-pressure notifications. Timers and animation frames also kept running at full rate while minimized. Renderer memory growth behind #813 predates this flag, but the flag removed every reclaim path that would otherwise have bounded it, and stable inherited it only when the isolated Host and chrome architecture landed for 2.0.9.

## Decision

The content view no longer disables background throttling. Restoring or showing the window now runs a reveal handler that lays out and then explicitly repaints both embedded views. A repaint is needed because layout alone cannot supply one: `resize` deliberately skips minimized windows and the degenerate client area Windows reports mid-restore, and its bounds comparison makes it a no-op whenever the window returns at the size it already had, which is the ordinary case. The handler is inert while the window is still minimized, and it only requests paints, so it cannot itself leave a surface blank.

## Validation

Both editions assert that the content view carries no `backgroundThrottling` preference, that a restore at unchanged bounds repaints without laying out, and that a minimized window is neither laid out nor repainted. The existing surface-preservation expectations across minimize, blur, restore, and show are unchanged, as is the compatibility chrome, which never disabled throttling.

This replaces a mechanism that was only ever verified by hand on Windows. Windows GUI verification is required before release: minimize and restore at an unchanged window size, restore from a long-minimized session, and confirm renderer working set falls while the window stays minimized. Whether reclaiming this memory measurably reduces the #813 out-of-memory rate is a separate field question; this change restores the reclaim path rather than fixing the growth.
