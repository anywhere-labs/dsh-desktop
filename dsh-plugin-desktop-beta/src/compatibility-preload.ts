import { contextBridge, ipcRenderer } from 'electron'
import {
  COMPATIBILITY_CHROME_CHANNEL,
  COMPATIBILITY_CHROME_STATE,
  type CompatibilityChromeBridge,
  type CompatibilityChromeState,
} from './compatibility-chrome-contract.ts'

const bridge: CompatibilityChromeBridge = {
  invoke: command => ipcRenderer.invoke(COMPATIBILITY_CHROME_CHANNEL, command),
  onDismiss(listener) {
    const receive = (): void => { listener() }
    ipcRenderer.on('dsh-desktop:chrome-dismiss', receive)
    return () => { ipcRenderer.removeListener('dsh-desktop:chrome-dismiss', receive) }
  },
  subscribe(listener) {
    const receive = (_event: Electron.IpcRendererEvent, state: CompatibilityChromeState): void => { listener(state) }
    ipcRenderer.on(COMPATIBILITY_CHROME_STATE, receive)
    return () => { ipcRenderer.removeListener(COMPATIBILITY_CHROME_STATE, receive) }
  },
}
contextBridge.exposeInMainWorld('desktopChrome', bridge)
