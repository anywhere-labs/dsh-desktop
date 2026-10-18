// TinTin channel main-process capabilities (channel-only addition; see
// docs/tintin-migration-plan.md Phase 4). The mirrored desktop bootstrap files
// stay byte-identical to Beta, so every TinTin-specific main-process behavior
// installs itself from here, before the mirrored bootstrap runs.

import { app } from 'electron'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { registerBrowserService } from 'dsh-tintin-browser'
import { seedTinTinDefaults } from './first-boot.ts'

let installed = false
let browserAttached = false

/**
 * Install TinTin main-process capabilities. Safe to call more than once.
 *
 * - First-boot provisioning: seed the tintin-server model provider, default
 *   model, placeholder credential and the bridge's own config store into the
 *   channel home before the Host boots (ported from the source first-boot;
 *   without it a fresh install defaults to the official DeepSeek provider).
 * - Media binaries: point the host bridge at `<resources>/bin`
 *   (ffmpeg/ffprobe/yt-dlp delivered by the fetch scripts) when packaged.
 * - Browser domain: attach to the first top-level window the desktop
 *   bootstrap creates — the harness main window. Later windows (native-ui
 *   modals, dialogs, recovery chrome) are ignored, matching the source
 *   wiring where registerBrowserService received the main window only.
 */
export function installTinTinMainHook(): void {
  if (installed) return
  installed = true

  seedTinTinDefaults(app.getPath('appData'))

  if (process.env.TINTIN_BIN_DIR === undefined && app.isPackaged) {
    const binDir = join(process.resourcesPath, 'bin')
    if (existsSync(binDir)) {
      process.env.TINTIN_BIN_DIR = binDir
      // OpenFilm runtime (2026-10-17): the vendored node.exe/openfilm.cmd sit
      // beside ffmpeg in bin/ — append (never prepend: system tools keep
      // precedence, the vendored set fills machines without them) so the
      // agent's shell and every child process resolve `openfilm` bare.
      if (process.platform === 'win32' && process.env.PATH !== undefined) {
        process.env.PATH = `${process.env.PATH};${binDir}`
      }
      const browsersDir = join(process.resourcesPath, 'playwright-browsers')
      if (process.env.PLAYWRIGHT_BROWSERS_PATH === undefined && existsSync(browsersDir)) {
        process.env.PLAYWRIGHT_BROWSERS_PATH = browsersDir
      }
    }
  }

  app.on('browser-window-created', (_event, window) => {
    if (browserAttached) return
    if (window.getParentWindow() !== null) return
    browserAttached = true
    try {
      registerBrowserService(window)
    } catch (error) {
      console.error(
        `dsh-plugin-desktop-tintin: browser domain registration failed: ${error instanceof Error ? error.message : String(error)}`,
      )
      browserAttached = false
    }
  })
}

// Install on module load so the composition entry only needs to import this
// module before the mirrored bootstrap; ESM evaluation order then guarantees
// the listeners exist before any window is created.
installTinTinMainHook()
