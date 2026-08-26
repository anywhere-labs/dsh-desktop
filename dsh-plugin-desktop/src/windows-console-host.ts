/** Console inheritance adapter for Windows ACL children launched from Electron. */

import { createRequire } from 'node:module'

const SW_HIDE = 0

export interface WindowsConsoleHostApi {
  getConsoleWindow: () => unknown
  allocConsole: () => number
  getLastError: () => number
  showWindow: (window: unknown, command: number) => number
}

export type WindowsConsoleHostApiLoader = () => WindowsConsoleHostApi

function loadWindowsConsoleHostApi(): WindowsConsoleHostApi {
  const koffi = createRequire(import.meta.url)('koffi') as typeof import('koffi').default
  const kernel32 = koffi.load('kernel32.dll')
  const user32 = koffi.load('user32.dll')
  return {
    getConsoleWindow: kernel32.func('void * __stdcall GetConsoleWindow()'),
    allocConsole: kernel32.func('int __stdcall AllocConsole()'),
    getLastError: kernel32.func('uint32 __stdcall GetLastError()'),
    showWindow: user32.func('int __stdcall ShowWindow(void *, int)'),
  }
}

/** Ensure restricted console children can inherit a real console from the Desktop runner. */
export function ensureWindowsConsoleHost(
  platform: NodeJS.Platform = process.platform,
  loadApi: WindowsConsoleHostApiLoader = loadWindowsConsoleHostApi,
): void {
  if (platform !== 'win32') return
  const api = loadApi()
  if (api.getConsoleWindow() !== null) return
  if (api.allocConsole() === 0) {
    throw new Error(`could not allocate a console for the Windows ACL runner (Win32 ${api.getLastError()})`)
  }
  const window = api.getConsoleWindow()
  if (window !== null) api.showWindow(window, SW_HIDE)
}
