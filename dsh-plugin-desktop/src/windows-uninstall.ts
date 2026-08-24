/** Windows installed-app detection and NSIS uninstaller launch. */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { win32 } from 'node:path'
import type { DesktopLocale, DesktopPlatform } from './runtime.ts'

/** Inputs that distinguish an installed NSIS build from portable and development builds. */
export interface WindowsUninstallerResolution {
  readonly platform: DesktopPlatform
  readonly isPackaged: boolean
  readonly executablePath: string
  readonly productName: string
}

/** Native confirmation copy shown before the installed application exits. */
export interface WindowsUninstallCopy {
  readonly title: string
  readonly message: string
  readonly detail: string
  readonly confirm: string
  readonly cancel: string
}

const copy: Record<DesktopLocale, WindowsUninstallCopy> = {
  en: {
    title: 'Uninstall DSH Desktop',
    message: 'Uninstall DSH Desktop?',
    detail: 'DSH Desktop will close and open the Windows uninstaller. Your profiles, plugins, settings, logs, and caches will be kept.',
    confirm: 'Uninstall',
    cancel: 'Cancel',
  },
  zh: {
    title: '卸载 DSH Desktop',
    message: '要卸载 DSH Desktop 吗？',
    detail: 'DSH Desktop 将关闭并打开 Windows 卸载程序。Profile、插件、设置、日志和缓存会保留。',
    confirm: '卸载',
    cancel: '取消',
  },
}

/**
 * Resolve the standard Electron Builder NSIS uninstaller beside the running app.
 * Portable archives and unpackaged Electron processes have no such capability.
 */
export function resolveWindowsUninstallerPath(
  value: WindowsUninstallerResolution,
  fileExists: (path: string) => boolean = existsSync,
): string | undefined {
  if (value.platform !== 'win32' || !value.isPackaged || value.productName.length === 0) return undefined
  const path = win32.join(win32.dirname(value.executablePath), `Uninstall ${value.productName}.exe`)
  return fileExists(path) ? path : undefined
}

/** Resolve the localized native confirmation for one installed-app uninstall. */
export function windowsUninstallCopy(locale: DesktopLocale): WindowsUninstallCopy {
  return copy[locale]
}

/** Launch the assisted NSIS uninstaller without a command shell. */
export async function launchWindowsUninstaller(
  uninstallerPath: string,
  spawnProcess: typeof spawn = spawn,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawnProcess(uninstallerPath, [], {
        detached: true,
        stdio: 'ignore',
        shell: false,
        windowsHide: false,
      })
    } catch (cause) {
      reject(cause)
      return
    }
    const fail = (cause: Error): void => { reject(cause) }
    child.once('error', fail)
    child.once('spawn', () => {
      child.off('error', fail)
      child.once('error', () => {})
      child.unref()
      resolve()
    })
  })
}
