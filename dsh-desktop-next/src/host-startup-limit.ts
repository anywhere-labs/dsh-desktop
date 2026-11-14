/**
 * How long a Host start may take before recovery opens (#1569), and what a slow start is still loading (#1617).
 * Upstream Desktop waits for its Host without a limit; the 60-second limit is the Desktop's own.
 */

/** Seconds a Host start may take, or `'none'` to wait for it like upstream Desktop. */
export type HostStartupTimeout = number | 'none'

/** The limit every release before #1569 applied: the default, and Safe Mode's fixed limit. */
export const DEFAULT_HOST_STARTUP_TIMEOUT = 60
/** A shorter limit would only turn slow starts into failures. */
export const MIN_HOST_STARTUP_TIMEOUT = 60
/** The longest finite limit; a longer wait is the unlimited choice. */
export const MAX_HOST_STARTUP_TIMEOUT = 600
/** The choices Desktop settings and the recovery assistant offer. */
export const HOST_STARTUP_TIMEOUT_PRESETS: readonly HostStartupTimeout[] = [60, 120, 180, 300, 600, 'none']
/** A start allowed to take longer than this tells the user once, after this long, where recovery is. */
export const HOST_STARTUP_NOTICE_MS = 60_000
/** Entries one answer carries, the longest-waiting first. */
export const MAX_STARTUP_ENTRIES = 20
/** Characters of an entry id or module name the Host reports. */
export const MAX_STARTUP_ENTRY_TEXT = 256

/**
 * @param value - A stored or requested limit.
 * @returns Whether it is `'none'` or a whole number of seconds from 60 through 600.
 */
export function isHostStartupTimeout(value: unknown): value is HostStartupTimeout {
  return value === 'none' || (typeof value === 'number' && Number.isInteger(value)
    && value >= MIN_HOST_STARTUP_TIMEOUT && value <= MAX_HOST_STARTUP_TIMEOUT)
}

/**
 * @param id - The value a recovery link carries: seconds, or `none`.
 * @returns The limit it names.
 * @throws when it names no valid limit.
 */
export function hostStartupTimeoutFromId(id: unknown): HostStartupTimeout {
  const value = id === 'none' ? 'none' : typeof id === 'string' && /^\d{1,4}$/u.test(id) ? Number(id) : undefined
  if (!isHostStartupTimeout(value)) throw new Error('Invalid Host startup limit')
  return value
}

/**
 * @param zh - Whether the interface is Chinese.
 * @returns The setting's title in Desktop settings, the recovery assistant and its notice.
 */
export function hostStartupLimitTitle(zh: boolean): string {
  return zh ? '插件服务（Host）启动时限' : 'Plugin service (Host) startup limit'
}

/**
 * @param value - A limit.
 * @param zh - Whether the interface is Chinese.
 * @returns Its label in Desktop settings and the recovery assistant.
 */
export function hostStartupTimeoutLabel(value: HostStartupTimeout, zh: boolean): string {
  if (value === 'none') return zh ? '不限时' : 'No limit'
  const seconds = zh ? `${String(value)} 秒` : `${String(value)} seconds`
  return value === DEFAULT_HOST_STARTUP_TIMEOUT ? `${seconds}${zh ? '（默认）' : ' (default)'}` : seconds
}

/** One Loader entry a Host start still waits for, as src/host/startup-entries.ts reports it. */
export interface DesktopStartupEntry {
  /** The entry's id in its configuration, by which a Profile patch can disable it. */
  readonly id: string
  /** The module the entry imports. */
  readonly name: string
  /** Importing that module, starting the plugin, or stopping it. */
  readonly phase: 'importing' | 'starting' | 'stopping'
  /** Milliseconds since the Host created the entry. */
  readonly waitedMs: number
}

/**
 * @param value - One item of a Host answer.
 * @returns Whether it is a well-formed entry.
 */
export function isDesktopStartupEntry(value: unknown): value is DesktopStartupEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.id === 'string' && entry.id.length <= MAX_STARTUP_ENTRY_TEXT
    && typeof entry.name === 'string' && entry.name.length <= MAX_STARTUP_ENTRY_TEXT
    && (entry.phase === 'importing' || entry.phase === 'starting' || entry.phase === 'stopping')
    && typeof entry.waitedMs === 'number' && Number.isFinite(entry.waitedMs) && entry.waitedMs >= 0
}

/** The limit a Host start exceeded and what it was still loading. */
export interface DesktopStartupTimeoutFailure {
  readonly seconds: number
  /** Absent when the Host did not say. */
  readonly pending?: readonly DesktopStartupEntry[]
  /** Why the Host did not say, such as a query that timed out or a Host not yet loading plugins. */
  readonly unanswered?: string
}

/** A Host start allowed more than a minute that is still going after one. */
export interface DesktopStartupNotice {
  readonly limit: HostStartupTimeout
  /** Undefined when the Host did not say. */
  readonly pending: readonly DesktopStartupEntry[] | undefined
}

function waited(entry: DesktopStartupEntry): string {
  return `${String(Math.round(entry.waitedMs / 1000))} s`
}

/**
 * @param pending - What the Host still loaded, or undefined when it did not say.
 * @param unanswered - Why it did not say.
 * @returns One line for the failure text and the log.
 */
export function startupEntriesSummary(pending: readonly DesktopStartupEntry[] | undefined, unanswered?: string): string {
  if (pending === undefined) return `The Host did not say which plugins were still loading${unanswered === undefined ? '' : ` (${unanswered})`}.`
  if (pending.length === 0) return 'Every plugin had finished loading; the Host was completing its own startup.'
  const named = pending.slice(0, 3).map(entry => `${entry.id} (${entry.name}, ${entry.phase}, ${waited(entry)})`)
  return `Still loading: ${named.join(', ')}${pending.length > 3 ? ` and ${String(pending.length - 3)} more` : ''}.`
}

/**
 * @param failure - The limit and what the Host still loaded.
 * @returns The failure report's section listing every entry the start was waiting for.
 */
export function startupEntriesSection(failure: DesktopStartupTimeoutFailure): string[] {
  const { pending } = failure
  return [`--- plugins still loading at the ${String(failure.seconds)}-second startup limit ---`,
    ...pending === undefined ? [`(the Host did not answer${failure.unanswered === undefined ? '' : `: ${failure.unanswered}`})`]
      : pending.length === 0 ? ['(none: every plugin had finished loading; the Host was completing its own startup)']
        : pending.map(entry => `${entry.id} (${entry.name}): ${entry.phase}, ${waited(entry)} since the Host created it`)]
}

/** A Host start that reached its limit. */
export class DesktopHostStartupTimeoutError extends Error {
  /**
   * @param seconds - The limit it exceeded.
   * @param pending - What the Host was still loading, or undefined when it did not say.
   * @param unanswered - Why it did not say.
   */
  constructor(readonly seconds: number, readonly pending: readonly DesktopStartupEntry[] | undefined, readonly unanswered?: string) {
    super(`Host startup exceeded ${String(seconds)} seconds\n${startupEntriesSummary(pending, unanswered)}`)
  }
}

/**
 * @param notice - The limit and what the Host still loaded after a minute.
 * @param language - The application language.
 * @param platform - Where the recovery assistant's menu lives.
 * @param trayAvailable - Whether a tray icon offers that menu.
 * @returns The system notification for a start that is still going.
 */
export function startupNoticeCopy(notice: DesktopStartupNotice, language: string, platform: string, trayAvailable: boolean): { title: string; body: string } {
  const zh = language.toLowerCase().startsWith('zh')
  const ids = notice.pending?.map(entry => entry.id) ?? []
  const named = ids.slice(0, 2).join(zh ? '、' : ', ')
  const loading = ids.length === 0 ? ''
    : zh ? `仍在加载 ${named}${ids.length > 2 ? ` 等 ${String(ids.length)} 个插件` : ''}。`
      : `Still loading ${named}${ids.length > 2 ? ` and ${String(ids.length - 2)} more` : ''}. `
  const menu = platform === 'darwin' ? zh ? '菜单栏图标或 DSH NEXT 菜单' : 'the menu bar icon or the DSH NEXT menu'
    : !trayAvailable ? undefined
      : platform === 'win32' ? zh ? '托盘图标（可能收在任务栏的隐藏图标中）' : 'the tray icon, which may be among the hidden taskbar icons'
        : zh ? '托盘图标' : 'the tray icon'
  const limit = notice.limit === 'none' ? '' : zh ? `，时限为 ${String(notice.limit)} 秒` : ` (limit: ${String(notice.limit)} seconds)`
  return zh ? {
    title: 'DSH NEXT 仍在启动',
    body: `插件服务启动已超过 1 分钟${limit}。${loading}${menu === undefined ? '' : `如需排查，可从${menu}打开恢复助手。`}`,
  } : {
    title: 'DSH NEXT is still starting',
    body: `The plugin service has been starting for over a minute${limit}. ${loading}${menu === undefined ? '' : `To investigate, open the recovery assistant from ${menu}.`}`.trimEnd(),
  }
}
