# Compatibility chrome isolation

This optimization from PR #868 is beta-only. Stable uses the original single-document compatibility frame. Renderer crash recovery from PR #869 remains enabled in both variants.

On macOS and Windows, compatibility mode uses two documents in one native window:

- A transparent, Desktop-owned WebContentsView loads the packaged `native-ui/compatibility-chrome.html` in an ephemeral, Desktop-only session. Its preload exposes only fixed chrome commands and locale/version state.
- A WebContentsView loads the upstream DSH page in `persist:dsh-desktop-renderer`. It retains the existing file-path preload, authentication exchange, request capability, navigation policy, boot monitoring, reload, zoom, and developer-tools behavior.
- The BrowserWindow remains an unprivileged, unloaded native carrier; its main document does not load DSH or the toolbar. Both active views are siblings, with chrome added last so HTML popups paint above DSH.
- Electron reserves the first 36 logical pixels for chrome and sizes the content view below it on resize and fullscreen transitions. The content renderer therefore reports zero Desktop safe-area and drag-region insets.
- The client plugin no longer mounts the compatibility titlebar or adjusts the upstream root. Global plugin CSS, inherited variables, body portals, and stacking order remain inside the content document.
- Chrome uses Desktop-owned colors and fonts. Only the built-in native theme preference and locale are shared, not third-party skin tokens or styles.
- Version/update and presentation-mode hover cards, the text mode pill, and restart/developer menus reuse the same React controls as extended mode. The original hover delays, icons, descriptions, pending/error states, and dismissal behavior are retained; no native Menu replaces these interactions.
- Chrome normally occupies only the toolbar band, so content input is unobstructed. While popup DOM is mounted, the transparent chrome view expands above the unchanged content view. Popup removal, outside click, Escape, window blur/hide, loading, and renderer failure release the expanded surface. No popup is portalled into the DSH document.
- IPC is registered on the chrome WebContents, validates its exact packaged top-level document, and rejects arbitrary commands and other frames. The DSH preload exposes no chrome bridge. No renderer-supplied JavaScript, URL, or filesystem path is executed by the command handler.
- Teardown removes handlers/listeners and explicitly closes both child WebContents. The chrome document does not load Cordis, DSH, or third-party client plugins.

Linux compatibility mode retains the native-titlebar fallback. Extended and advanced modes keep their existing rendering paths; this change does not introduce Shadow DOM there.

## Verification

Headless unit coverage checks native bounds, sender/frame/URL validation, command allowlisting, persistence-before-restart, HTML-popup view expansion, teardown, authentication, and renderer failure/reload behavior. Packaging builds the separate chrome page and standalone sandbox-compatible preload.

Before release, explicitly launch the app on macOS and Windows and verify:

1. A skin that overrides body/root variables and global header/button/SVG selectors changes DSH content but not chrome.
2. HTML hover cards and action menus, keyboard focus, content zoom/reload, window controls, resize, fullscreen, and material settings work at supported DPI scales.
3. Theme/locale updates reach chrome without plugin CSS; extension and advanced mode transitions still restart into their existing layouts.
4. A failed content load, crashed renderer, and repeated mount/dispose leave no orphan child WebContents.
5. Compare cold-start time and idle memory with the previous compatibility implementation; no fixed memory-overhead claim is made by this change.
