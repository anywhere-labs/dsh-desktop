/** The `fileDrag` member of `window.dshDesktop`, which the official file drag client of dsh 0.2.2 reads. */
import { ipcRenderer } from 'electron'
import type { DesktopFileDrag, FileDragHandle } from '@deepseek-ai/dsh-util-file-drag'
import { FILE_DRAG_IPC } from './file-drag-ipc.ts'

/** @returns native file preparation and dragging that expose neither IPC nor Electron objects. */
export function createDesktopFileDragBridge(): { fileDrag: DesktopFileDrag } {
  return {
    fileDrag: {
      prepare: (source, requestId) => ipcRenderer.invoke(FILE_DRAG_IPC.prepare, source, requestId) as Promise<FileDragHandle | undefined>,
      cancel: (requestId) => { void ipcRenderer.invoke(FILE_DRAG_IPC.cancel, requestId).catch((_error: unknown) => {
        // Main-process shutdown cancels any remaining preparations.
      }) },
      start: handle => ipcRenderer.invoke(FILE_DRAG_IPC.start, handle) as Promise<boolean>,
      release: (handle) => { void ipcRenderer.invoke(FILE_DRAG_IPC.release, handle).catch((_error: unknown) => {
        // Main-process shutdown also releases every prepared file.
      }) },
    },
  }
}
