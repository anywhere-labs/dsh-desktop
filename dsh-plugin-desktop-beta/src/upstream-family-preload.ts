/**
 * Preload parts that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is a
 * declared difference between the variants (scripts/verify-desktop-variants.mjs); it stays apart from that file because
 * the sandboxed preload bundle may load nothing but Electron.
 */

// The official context menus of dsh 0.2.2 read their native file actions from `window.dshDesktop`, and its official images
// read their native file drag from there. The modules live below src/upstream-family/.
export { createDesktopFileActionsBridge } from './upstream-family/file-actions-bridge.ts'
export { createDesktopFileDragBridge } from './upstream-family/file-drag-bridge.ts'
