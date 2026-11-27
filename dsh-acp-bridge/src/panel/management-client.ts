/** Management reads may precede Host route registration during first activation. */
import { MANAGEMENT_PATH, type ManagementState } from '../management-contract.js'

export class ManagementError extends Error {
  constructor(readonly kind: 'unavailable' | 'http' | 'invalid', readonly status: number) {
    super(`ACP management: ${kind} (HTTP ${status})`)
  }
}

export function managementErrorText(cause: unknown, language: string): string {
  if (!(cause instanceof ManagementError)) return cause instanceof Error ? cause.message : String(cause)
  const zh = language.startsWith('zh')
  if (cause.kind === 'unavailable') return zh ? '插件管理服务尚未就绪，请确认插件已启用后重试。' : 'The plugin management service is not ready. Enable the plugin and retry.'
  if (cause.kind === 'invalid') return zh ? '插件管理服务返回了无效数据，请重试。' : 'The plugin management service returned invalid data. Please retry.'
  return zh ? `读取插件管理信息失败（HTTP ${cause.status}）。` : `Could not read plugin management information (HTTP ${cause.status}).`
}

export async function callManagement(body?: object, signal?: AbortSignal): Promise<ManagementState> {
  const response = await fetch(MANAGEMENT_PATH, { method: body ? 'POST' : 'GET', cache: 'no-store',
    ...(signal ? { signal } : {}), ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  // A route that has not registered yet returns plain text, not a JSON error envelope.
  if (response.status === 404 || response.status === 503) throw new ManagementError('unavailable', response.status)
  const value = await response.json().catch(() => undefined) as (ManagementState & { error?: string }) | undefined
  if (!response.ok) throw value?.error ? new Error(value.error) : new ManagementError('http', response.status)
  if (value?.error) throw new Error(value.error)
  if (!value?.settings || !value.live || !Array.isArray(value.checks)) throw new ManagementError('invalid', response.status)
  return value
}

/** Retry only read-only requests for a temporarily absent service; writes are never replayed. */
export async function readManagementWhenReady(signal: AbortSignal): Promise<ManagementState> {
  for (let attempt = 0; ; attempt++) {
    signal.throwIfAborted()
    try { return await callManagement(undefined, signal) }
    catch (cause) {
      if (!(cause instanceof ManagementError) || cause.kind !== 'unavailable' || attempt >= 14) throw cause
      await new Promise<void>((resolve, reject) => {
        const abort = () => { clearTimeout(timer); reject(signal.reason) }
        const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, 1_000)
        signal.addEventListener('abort', abort, { once: true })
        if (signal.aborted) abort()
      })
    }
  }
}
