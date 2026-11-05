/** Narrow permission bridge; active user gestures are required for OS prompts. */
import { ipcRenderer } from 'electron'
import { IPC } from './ipc.ts'
import type { DesktopPermissions } from './permissions.ts'

function userGesture(): void {
  if (!navigator.userActivation.isActive) throw new Error('Desktop permission requests require a user gesture')
}

export function permissionBridge(): DesktopPermissions {
  return {
    query: permission => ipcRenderer.invoke(IPC.permissionQuery, permission),
    request: async permission => { userGesture(); return ipcRenderer.invoke(IPC.permissionRequest, permission) },
    openSettings: async permission => { userGesture(); await ipcRenderer.invoke(IPC.permissionSettings, permission) },
  }
}
