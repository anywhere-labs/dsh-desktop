// Preload for the native OpenFilm Studio view (B 方案, 2026-10-18 用户裁决).
// The Studio UI reads `window.openfilmHost` before its modules run and reports what
// the person selects / where the playhead is through it; this preload forwards those
// reports to the main process, which hands them to the TinTin chat renderer. Studio's
// own chat is not used — the host's optional panel/agents/tabs stay absent, so the
// editor renders full width and our DSH chat lives beside the native view.
import { contextBridge, ipcRenderer } from 'electron'
// A sandboxed preload can only require('electron')/builtins — keep these
// literals in sync with ../openfilm-view-contract.ts (main-process side).
const OPENFILM_HOST_SELECTION = 'dsh-desktop:openfilm-host-selection'
const OPENFILM_HOST_REFER = 'dsh-desktop:openfilm-host-refer'

contextBridge.exposeInMainWorld('openfilmHost', {
  version: 1,
  name: 'TinTin',
  onSelection: (selection: unknown): void => {
    ipcRenderer.send(OPENFILM_HOST_SELECTION, selection)
  },
  refer: (ref: unknown): void => {
    ipcRenderer.send(OPENFILM_HOST_REFER, ref)
  },
})
