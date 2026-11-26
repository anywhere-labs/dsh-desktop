/**
 * Desktop screen-capture seam: the Electron launcher captures the primary
 * screen and exposes it as a PNG data URL, consumed through
 * `ctx.get('desktopCapture')`. This is what closes the perception loop — the
 * agent can look at the actual screen, not just images handed to it.
 *
 * Headless boots do not provide it (no display), so consumers treat it as
 * optional and degrade gracefully; tests and headless boots can inject
 * `createMemoryCapture` instead.
 *
 * @module dsh-plugin-desktop-beta/desktop-capture
 */

/** Screen-capture surface exposed by the Electron launcher. */
export interface DesktopCapture {
  /**
   * Capture the primary screen as a `data:image/png;base64,…` URL.
   * Resolves `undefined` when no display source is available.
   */
  captureScreen(): Promise<string | undefined>
}

/** In-memory capture for headless boots and tests (no display required). */
export function createMemoryCapture(dataUrl = ''): DesktopCapture {
  return {
    async captureScreen() {
      return dataUrl.length > 0 ? dataUrl : undefined
    },
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Present only when the Electron launcher injected screen capture. */
    desktopCapture?: DesktopCapture
  }
}
