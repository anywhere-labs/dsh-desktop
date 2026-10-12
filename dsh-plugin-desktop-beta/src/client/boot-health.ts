import {
  RENDERER_BOOT_REPORT_PATH,
  type RendererBootReport,
} from '../renderer-boot-contract.ts'

export { RENDERER_BOOT_REPORT_PATH } from '../renderer-boot-contract.ts'
export type { RendererBootReport } from '../renderer-boot-contract.ts'

/** Browser Loader state needed to decide whether one desktop generation is healthy. */
export interface RendererBootLoader {
  await(): Promise<void>
  entries(): Iterable<{
    options: { name: string }
    fiber?: { state: number }
  }>
}

const ACTIVE_FIBER_STATE = 2

/** Wait for client Loader settlement and summarize entries that did not activate. */
export async function rendererBootReport(loader: RendererBootLoader): Promise<RendererBootReport> {
  let error: string | undefined
  try {
    await loader.await()
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause)
  }
  const plugins = [...loader.entries()]
    .filter(entry => entry.fiber?.state !== ACTIVE_FIBER_STATE)
    .map(entry => entry.options.name)
  return error === undefined && plugins.length === 0
    ? { status: 'healthy' }
    : { status: 'failed', plugins, ...(error === undefined ? {} : { error }) }
}

/** Send the settled client Loader outcome to the same-origin desktop Host. */
export async function sendRendererBootReport(
  loader: RendererBootLoader,
  request: typeof globalThis.fetch = globalThis.fetch,
): Promise<RendererBootReport> {
  const report = await rendererBootReport(loader)
  await postRendererBootReport(report, request)
  return report
}

async function postRendererBootReport(
  report: RendererBootReport,
  request: typeof globalThis.fetch,
): Promise<void> {
  const response = await request(RENDERER_BOOT_REPORT_PATH, {
    method: 'POST',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(report),
  })
  if (!response.ok) {
    throw new Error(`dsh-plugin-desktop: renderer boot report failed with HTTP ${String(response.status)}`)
  }
}

/** Defer health reporting until the current client plugin activation has completed. */
export function startRendererBootReporter(
  loader: RendererBootLoader,
  request: typeof globalThis.fetch = globalThis.fetch,
): () => void {
  let active = true
  const timer = setTimeout(() => {
    void rendererBootReport(loader)
      .then(async (report) => {
        if (active) await postRendererBootReport(report, request)
      })
      .catch((cause: unknown) => {
        console.error('dsh-plugin-desktop: failed to report renderer boot health', cause)
      })
  }, 0)
  return () => {
    active = false
    clearTimeout(timer)
  }
}
