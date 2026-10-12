/** Loopback Host endpoint reserved for one renderer generation's terminal boot report. */
export const RENDERER_BOOT_REPORT_PATH = '/_dsh/desktop/renderer-boot'

/** One terminal renderer boot outcome reported to the desktop Host. */
export type RendererBootReport =
  | { status: 'healthy' }
  | { status: 'failed', plugins: string[], error?: string }
