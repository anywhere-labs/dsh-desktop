/** The `fileActions` member of `window.dshDesktop`, which the official file-action client of dsh 0.2.2 reads. */
import { ipcRenderer } from 'electron'
import type { DesktopFileActions, FileSaveResult } from '@deepseek-ai/dsh-client-ui-file-actions/types'
import { FILE_ACTIONS_IPC } from './file-actions-ipc.ts'

/** @returns file operations that expose neither IPC nor Electron objects. */
export function createDesktopFileActionsBridge(): { fileActions: DesktopFileActions } {
  return {
    fileActions: {
      save: request => ipcRenderer.invoke(FILE_ACTIONS_IPC.save, request) as Promise<FileSaveResult>,
      readClipboardImage: url => ipcRenderer.invoke(FILE_ACTIONS_IPC.clipboardImageRead, url) as
        Promise<{ bytes: Uint8Array; mediaType: string }>,
    },
  }
}
