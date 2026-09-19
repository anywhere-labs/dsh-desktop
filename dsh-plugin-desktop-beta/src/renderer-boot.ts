import type { IncomingMessage, ServerResponse } from 'node:http'
import type { RendererBootReport } from './renderer-boot-contract.ts'

export { RENDERER_BOOT_REPORT_PATH } from './renderer-boot-contract.ts'
export type { RendererBootReport } from './renderer-boot-contract.ts'

const MAX_REPORT_BYTES = 16 * 1024
const MAX_FAILED_PLUGINS = 64

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseReport(value: unknown): RendererBootReport | undefined {
  if (!isRecord(value)) return undefined
  if (value.status === 'healthy') return { status: 'healthy' }
  if (value.status !== 'failed' || !Array.isArray(value.plugins) || value.plugins.length > MAX_FAILED_PLUGINS) {
    return undefined
  }
  if (!value.plugins.every(plugin => typeof plugin === 'string' && plugin.length > 0 && plugin.length <= 512)) {
    return undefined
  }
  if (value.error !== undefined && (typeof value.error !== 'string' || value.error.length > 12 * 1024)) {
    return undefined
  }
  return {
    status: 'failed',
    plugins: [...value.plugins],
    ...(value.error === undefined ? {} : { error: value.error }),
  }
}

async function readReport(req: IncomingMessage): Promise<RendererBootReport | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
    size += bytes.byteLength
    if (size > MAX_REPORT_BYTES) return undefined
    chunks.push(bytes)
  }
  try {
    return parseReport(JSON.parse(Buffer.concat(chunks).toString('utf8')))
  } catch {
    return undefined
  }
}

function finish(res: ServerResponse, statusCode: number): void {
  res.statusCode = statusCode
  res.end()
}

/** Validate and forward one same-origin renderer Loader outcome. */
export async function handleRendererBootRequest(
  req: IncomingMessage,
  res: ServerResponse,
  expectedOrigin: string,
  report: (value: RendererBootReport) => void,
): Promise<void> {
  if (req.method !== 'POST') return finish(res, 405)
  if (req.headers.origin !== expectedOrigin) return finish(res, 403)
  if (req.headers['content-type']?.split(';', 1)[0]?.trim().toLowerCase() !== 'application/json') {
    return finish(res, 415)
  }
  const value = await readReport(req)
  if (value === undefined) return finish(res, 400)
  report(value)
  finish(res, 204)
}
