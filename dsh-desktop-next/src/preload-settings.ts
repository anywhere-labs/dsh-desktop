/** Consume a pending menu request after the official client has mounted. */
import { ipcRenderer } from 'electron'
import type { DesktopSettingsPage } from './desktop-contract.ts'
import { IPC } from './ipc.ts'

export function onOpenSettings(listener: (page: DesktopSettingsPage) => void): () => void {
  let disposed = false
  const receive = (): void => {
    void ipcRenderer.invoke(IPC.settingsTake).then((page: unknown) => {
      if (!disposed && (page === 'general' || page === 'permissions')) listener(page)
    }).catch(error => { if (!disposed) console.error('Could not open Desktop settings', error) })
  }
  ipcRenderer.on(IPC.settingsOpen, receive)
  receive()
  return () => { disposed = true; ipcRenderer.removeListener(IPC.settingsOpen, receive) }
}
