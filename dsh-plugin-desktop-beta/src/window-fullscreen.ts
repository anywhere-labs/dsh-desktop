/** Fullscreen state of the main window for the official layout's `html[data-fullscreen]` rules. */
import type { BrowserWindow } from 'electron'
import { IPC } from './ipc.ts'

/**
 * Send a window's fullscreen state to its document on every transition and after each load, as the official
 * Desktop does. Fullscreen hides the macOS traffic lights and the Windows caption buttons, so the official layout
 * drops their clearance while `<html data-fullscreen>` is set. Linux draws no window controls over the page.
 * @param window - Window whose preload mirrors the state.
 * @param platform - Platform the window runs on.
 */
export function syncWindowFullscreenState(
  window: Pick<BrowserWindow, 'isDestroyed' | 'isFullScreen' | 'on' | 'webContents'>,
  platform: NodeJS.Platform,
): void {
  if (platform !== 'darwin' && platform !== 'win32') return
  const send = (): void => {
    if (!window.isDestroyed()) window.webContents.send(IPC.windowFullscreen, window.isFullScreen())
  }
  window.on('enter-full-screen', send)
  window.on('leave-full-screen', send)
  // Reloads and navigations register the preload listener again; resend the state so a fullscreen reload
  // does not fall back to the windowed layout.
  window.webContents.on('did-finish-load', send)
}
