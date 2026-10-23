/** Keep native menus and independent controls in the language selected in Settings. */
import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'

export function syncNativeLocale(): void {
  // The HTML template starts in English, even before Host boot completes.
  // Only the official locale service can publish an initialized UI language.
  contextBridge.exposeInMainWorld('__DSH_LOCALE__', {
    read: () => ipcRenderer.invoke(IPC.localeRead),
    onChange: (language: string) => ipcRenderer.send(IPC.locale, language),
  })
}
