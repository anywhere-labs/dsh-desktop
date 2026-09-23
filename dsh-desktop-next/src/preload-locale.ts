/** Keep native menus and independent controls in the language selected in Settings. */
import { ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'

export function syncNativeLocale(): void {
  const install = (): void => {
    const root = document.documentElement
    const send = (): void => { if (root.lang) ipcRenderer.send(IPC.locale, root.lang) }
    const observer = new MutationObserver(send)
    observer.observe(root, { attributes: true, attributeFilter: ['lang'] })
    window.addEventListener('pagehide', () => observer.disconnect(), { once: true })
    send()
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', install, { once: true })
  else install()
}
