/** Same-origin browser API for the Desktop Android Logcat Host routes. */

import {
  ANDROID_LOGCAT_DEVICES_PATH,
  ANDROID_LOGCAT_PROCESSES_PATH,
  ANDROID_LOGCAT_SCREENSHOT_PATH,
  ANDROID_LOGCAT_STREAM_PATH,
} from '../android-logcat-contract.ts'
import type {
  AndroidLogcatDevicesResponse,
  AndroidLogcatProcess,
  AndroidLogcatProcessesResponse,
} from '../android-logcat-contract.ts'
import type { AndroidLogcatFilterPatterns } from './android-logcat-preferences.ts'

export type {
  AndroidLogcatDevice,
  AndroidLogcatDevicesResponse,
  AndroidLogcatProcess,
  AndroidLogcatProcessesResponse,
} from '../android-logcat-contract.ts'


export type AndroidLogcatSseFrame =
  | { readonly kind: 'log'; readonly line: string }
  | { readonly kind: 'error'; readonly error: string }

/** An HTTP or protocol failure returned by the Android Logcat Host API. */
export class AndroidLogcatApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'AndroidLogcatApiError'
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let value: unknown
  try {
    value = await response.json()
  } catch {
    if (!response.ok) throw new AndroidLogcatApiError(`Request failed (${response.status})`, response.status)
    throw new AndroidLogcatApiError('The Logcat service returned invalid JSON', response.status)
  }
  if (!response.ok) {
    const error = typeof value === 'object' && value !== null && 'error' in value
      && typeof value.error === 'string' ? value.error : `Request failed (${response.status})`
    throw new AndroidLogcatApiError(error, response.status)
  }
  return value as T
}

/** Read adb availability and the current device list. */
export async function readAndroidLogcatDevices(signal?: AbortSignal): Promise<AndroidLogcatDevicesResponse> {
  return await readJson(await fetch(ANDROID_LOGCAT_DEVICES_PATH, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** Read processes for one adb serial. */
export async function readAndroidLogcatProcesses(
  serial: string,
  signal?: AbortSignal,
): Promise<AndroidLogcatProcessesResponse> {
  const query = new URLSearchParams({ serial })
  return await readJson(await fetch(`${ANDROID_LOGCAT_PROCESSES_PATH}?${query}`, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  }))
}

/** Decode one Server-Sent Events frame using the agreed Host wire contract. */
export function parseAndroidLogcatSseFrame(frame: string): AndroidLogcatSseFrame | undefined {
  let event = 'message'
  const data: string[] = []
  for (const line of frame.split(/\r?\n/)) {
    if (line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon < 0 ? line : line.slice(0, colon)
    let value = colon < 0 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'event') event = value
    else if (field === 'data') data.push(value)
  }
  if (data.length === 0) return undefined
  const payload = data.join('\n')
  if (event === 'error') {
    let message = payload
    try {
      const parsed: unknown = JSON.parse(payload)
      if (typeof parsed === 'object' && parsed !== null && 'error' in parsed && typeof parsed.error === 'string') {
        message = parsed.error
      }
    } catch { /* Keep a plain-text event payload useful as an error message. */ }
    return { kind: 'error', error: message || 'The Logcat stream failed' }
  }
  try {
    const parsed: unknown = JSON.parse(payload)
    if (typeof parsed === 'string') return { kind: 'log', line: parsed }
    if (parsed !== null && parsed !== undefined) return { kind: 'log', line: String(parsed) }
  } catch {
    // Be tolerant of a plain-text SSE data frame from a compatible Host.
    return { kind: 'log', line: payload }
  }
  throw new AndroidLogcatApiError('The Logcat stream contained an empty log entry')
}

/**
 * Normalize one parsed threadtime timestamp into the `adb logcat -T` form
 * (`MM-DD HH:MM:SS.mmm`, year stripped); undefined when the value is unusable.
 */
export function normalizeAndroidLogcatSince(timestamp: string): string | undefined {
  const stripped = timestamp.trim().replace(/^\d{4}-/u, '')
  return /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}$/u.test(stripped) ? stripped : undefined
}

/**
 * Consume one same-origin event stream until it ends or its signal aborts.
 * Host `error` events reject the promise so the drawer can show the failure.
 * When `since` is a normalized logcat timestamp, the Host starts the adb
 * stream with `-T` so an already-seen buffer backlog is not replayed.
 */
export async function streamAndroidLogcat(
  serial: string,
  signal: AbortSignal,
  onLine: (line: string) => void,
  onConnected?: () => void,
  since?: string,
): Promise<void> {
  const query = new URLSearchParams({ serial })
  if (since !== undefined && since !== '') query.set('since', since)
  const response = await fetch(`${ANDROID_LOGCAT_STREAM_PATH}?${query}`, {
    cache: 'no-store',
    headers: { accept: 'text/event-stream' },
    signal,
  })
  if (!response.ok) {
    let message = `Logcat stream request failed (${response.status})`
    try {
      const value: unknown = await response.json()
      if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') {
        message = value.error
      }
    } catch { /* The status is enough when the failure body is not JSON. */ }
    throw new AndroidLogcatApiError(message, response.status)
  }
  if (response.body === null) throw new AndroidLogcatApiError('The Logcat stream has no response body')
  onConnected?.()

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let pending = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      let boundary = pending.search(/\r?\n\r?\n/)
      while (boundary >= 0) {
        const frame = pending.slice(0, boundary)
        const delimiter = pending.slice(boundary).match(/^\r?\n\r?\n/)?.[0] ?? '\n\n'
        pending = pending.slice(boundary + delimiter.length)
        const parsed = parseAndroidLogcatSseFrame(frame)
        if (parsed?.kind === 'error') throw new AndroidLogcatApiError(parsed.error)
        if (parsed?.kind === 'log') onLine(parsed.line)
        boundary = pending.search(/\r?\n\r?\n/)
      }
    }
    pending += decoder.decode()
    if (pending.trim()) {
      const parsed = parseAndroidLogcatSseFrame(pending)
      if (parsed?.kind === 'error') throw new AndroidLogcatApiError(parsed.error)
      if (parsed?.kind === 'log') onLine(parsed.line)
    }
  } finally {
    reader.releaseLock()
  }
}

/** Return a localized-friendly message without exposing browser internals. */
export function androidLogcatErrorMessage(error: unknown): string {
  if (error instanceof AndroidLogcatApiError) return error.message
  if (error instanceof Error && error.name === 'AbortError') return ''
  if (error instanceof Error && error.message) return error.message
  return 'Unknown Logcat error'
}

const TERMINAL_LOGCAT_HTTP_STATUSES = new Set([400, 401, 403, 404, 405])
const MAX_RECONNECT_DELAY_MS = 10_000

function waitForReconnect(signal: AbortSignal, delayMs: number): Promise<void> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout>
    const finish = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', finish)
      resolve()
    }
    timer = setTimeout(finish, delayMs)
    signal.addEventListener('abort', finish, { once: true })
    if (signal.aborted) finish()
  })
}

/**
 * Keep the selected device stream alive across EOF, adb exits, and transient HTTP/device failures.
 * `getSince` is read on every (re)connect so a restarted stream resumes after the newest seen log
 * instead of replaying the whole device buffer again.
 */
export async function streamAndroidLogcatWithReconnect(
  serial: string,
  signal: AbortSignal,
  onLine: (line: string) => void,
  onConnected?: () => void,
  onReconnecting?: () => void,
  getSince?: () => string | undefined,
): Promise<void> {
  let retryAttempt = 0
  while (!signal.aborted) {
    try {
      await streamAndroidLogcat(serial, signal, line => {
        retryAttempt = 0
        onLine(line)
      }, () => {
        onConnected?.()
      }, getSince?.())
    } catch (error) {
      if (signal.aborted) return
      if (error instanceof AndroidLogcatApiError && error.status !== undefined
        && TERMINAL_LOGCAT_HTTP_STATUSES.has(error.status)) throw error
    }
    if (signal.aborted) return
    onReconnecting?.()
    const delayMs = Math.min(500 * 2 ** retryAttempt, MAX_RECONNECT_DELAY_MS)
    retryAttempt = Math.min(retryAttempt + 1, 5)
    await waitForReconnect(signal, delayMs)
  }
}

/** Parsed Android `threadtime` fields used by filters and the row renderer. */
export function parseAndroidLogcatLine(raw: string): {
  readonly timestamp?: string
  readonly pid?: number
  readonly tid?: number
  readonly severity?: AndroidLogcatSeverity
  readonly tag?: string
  readonly message?: string
} {
  const match = raw.match(/^\s*((?:\d{4}-)?\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}(?:\.\d+)?)\s+(\d+)\s+(\d+)\s+([VDIWEAF])\s+(.+?):(?:\s?(.*))?$/u)
  if (match) {
    const [, timestamp, rawPid, rawTid, priority, tag, message] = match
    const pid = Number(rawPid)
    const tid = Number(rawTid)
    const severity = logcatPriority(priority ?? '')
    return {
      ...(timestamp === undefined ? {} : { timestamp }),
      ...(Number.isSafeInteger(pid) ? { pid } : {}),
      ...(Number.isSafeInteger(tid) ? { tid } : {}),
      ...(severity === undefined ? {} : { severity }),
      ...(tag === undefined ? {} : { tag: tag.trim() }),
      ...(message === undefined ? {} : { message }),
    }
  }
  const legacy = raw.match(/^\s*\S+\s+(\d+)\s+\S+\s+([VDIWEAF])\s+/u)
  if (!legacy) return {}
  const pid = Number(legacy[1])
  const severity = logcatPriority(legacy[2] ?? '')
  return {
    ...(Number.isSafeInteger(pid) ? { pid } : {}),
    ...(severity === undefined ? {} : { severity }),
  }
}

export type AndroidLogcatSeverity = 'verbose' | 'debug' | 'info' | 'warn' | 'error'

export function logcatPriority(value: string): AndroidLogcatSeverity | undefined {
  switch (value.toUpperCase()) {
    case 'V': return 'verbose'
    case 'D': return 'debug'
    case 'I': return 'info'
    case 'W': return 'warn'
    case 'E':
    case 'F':
    case 'A': return 'error'
    default: return undefined
  }
}

function normalizeLogcatLevel(value: string): string {
  return logcatPriority(value) ?? value.toLocaleLowerCase()
}

export const ANDROID_LOGCAT_SEVERITIES: readonly AndroidLogcatSeverity[] = [
  'verbose', 'debug', 'info', 'warn', 'error',
]

/** Keep rows parsable and bounded by their line-oriented display contract. */
export const ANDROID_LOGCAT_MAX_ENTRIES = 3000
export const ANDROID_LOGCAT_MAX_FILTER_LENGTH = 512

export function makeAndroidLogcatEntry(raw: string, id: number): AndroidLogcatEntry {
  return Object.freeze({ id, raw, ...parseAndroidLogcatLine(raw) })
}

export interface AndroidLogcatEntry {
  readonly id: number
  readonly raw: string
  readonly timestamp?: string
  readonly pid?: number
  readonly tid?: number
  readonly severity?: AndroidLogcatSeverity
  readonly tag?: string
  readonly message?: string
}

export interface AndroidLogcatQueryResult {
  readonly error?: string
  matches(entry: AndroidLogcatEntry, processName?: string): boolean
}

export interface AndroidLogcatPatternResult {
  readonly error?: string
  matches(value: string): boolean
}

/** Compile one case-insensitive regex for a single Tag, Process, or Message field. */
export function compileAndroidLogcatPattern(pattern: string): AndroidLogcatPatternResult {
  const source = pattern.trim()
  if (!source) return { matches: () => true }
  if (source.length > ANDROID_LOGCAT_MAX_FILTER_LENGTH) {
    return { error: `Filter is limited to ${ANDROID_LOGCAT_MAX_FILTER_LENGTH} characters.`, matches: () => false }
  }
  if (/\\[1-9]|\\k<|\([^)]*[+*{][^)]*\)[+*{]|\([^)]*\|[^)]*\)[+*{]/u.test(source)) {
    return { error: 'This regular expression uses an unsupported or potentially unsafe pattern.', matches: () => false }
  }
  try {
    const expression = new RegExp(source, 'i')
    return { matches: value => expression.test(value) }
  } catch {
    return { error: 'Invalid regular expression.', matches: () => false }
  }
}

type QueryField = 'text' | 'tag' | 'process' | 'level' | 'message'
interface QueryTerm { readonly field: QueryField; readonly value: string; readonly excluded: boolean }

/** Compile an Android Studio-style query: implicit AND, explicit OR, field:value, and - exclusions. */
export function compileAndroidLogcatQuery(query: string, regex = false): AndroidLogcatQueryResult {
  const source = query.trim()
  if (!source) return { matches: () => true }
  if (source.length > ANDROID_LOGCAT_MAX_FILTER_LENGTH) {
    return { error: `Filter is limited to ${ANDROID_LOGCAT_MAX_FILTER_LENGTH} characters.`, matches: () => false }
  }
  if (regex) {
    const pattern = compileAndroidLogcatPattern(source)
    return pattern.error === undefined
      ? { matches: entry => pattern.matches(entry.raw) }
      : { error: pattern.error, matches: () => false }
  }
  const tokens = tokenizeLogcatQuery(source)
  if (typeof tokens === 'string') return { error: tokens, matches: () => false }
  if (tokens.length === 0) return { error: 'Filter terms cannot be empty.', matches: () => false }
  const groups: QueryTerm[][] = [[]]
  for (const token of tokens) {
    if (token.toLocaleUpperCase() === 'OR') {
      if (groups.at(-1)?.length === 0) return { error: 'OR must appear between filter terms.', matches: () => false }
      groups.push([])
      continue
    }
    const excluded = token.startsWith('-') && token.length > 1
    const content = excluded ? token.slice(1) : token
    const fieldMatch = content.match(/^(tag|process|package|level|message):(.*)$/iu)
    const fieldName = fieldMatch?.[1]?.toLocaleLowerCase()
    const field: QueryField = fieldName === 'package' ? 'process' : (fieldName as QueryField | undefined) ?? 'text'
    const rawValue = fieldMatch ? fieldMatch[2] ?? '' : content
    if (rawValue.length === 0) return { error: 'Filter fields need a value, for example tag:Network.', matches: () => false }
    const value = field === 'level' ? normalizeLogcatLevel(rawValue) : rawValue.toLocaleLowerCase()
    const group = groups.at(-1)
    if (group === undefined) return { error: 'Invalid filter expression.', matches: () => false }
    group.push({ field, value, excluded })
  }
  if (groups.at(-1)?.length === 0) return { error: 'OR must appear between filter terms.', matches: () => false }
  return {
    matches: (entry, processName = '') => groups.some(group => group.every(term => {
      const target = term.field === 'tag' ? entry.tag ?? ''
        : term.field === 'process' ? processName
          : term.field === 'level' ? entry.severity ?? ''
            : term.field === 'message' ? entry.message ?? entry.raw
              : entry.raw
      const found = target.toLocaleLowerCase().includes(term.value)
      return term.excluded ? !found : found
    })),
  }
}

function tokenizeLogcatQuery(source: string): string[] | string {
  const tokens: string[] = []
  let token = ''
  let quoted = false
  let escaped = false
  for (const character of source) {
    if (escaped) { token += character; escaped = false; continue }
    if (quoted && character === '\\') { escaped = true; continue }
    if (character === '"') { quoted = !quoted; continue }
    if (/\s/u.test(character) && !quoted) {
      if (token) tokens.push(token)
      token = ''
    } else token += character
  }
  if (quoted) return 'Close the quotation mark in the filter.'
  if (token) tokens.push(token)
  return tokens
}

/** Filter retained rows; selected values within each category use OR, fields use AND. */
export function filterAndroidLogcatEntries(
  entries: readonly AndroidLogcatEntry[],
  selectedPids: readonly number[],
  selectedTags: readonly string[],
  selectedSeverities: readonly AndroidLogcatSeverity[],
  patterns: AndroidLogcatFilterPatterns,
  processes: readonly AndroidLogcatProcess[] = [],
): readonly AndroidLogcatEntry[] {
  const tagPattern = compileAndroidLogcatPattern(patterns.tag)
  const excludeTagPattern = compileAndroidLogcatPattern(patterns.excludeTag)
  const processPattern = compileAndroidLogcatPattern(patterns.process)
  const messagePattern = compileAndroidLogcatPattern(patterns.message)
  if (tagPattern.error || excludeTagPattern.error || processPattern.error || messagePattern.error) return []
  const processNames = new Map(processes.map(androidProcess => [androidProcess.pid, androidProcess.name]))
  return entries.filter(entry => (selectedPids.length === 0 || selectedPids.includes(entry.pid ?? -1))
    && (selectedTags.length === 0 || selectedTags.includes(entry.tag ?? ''))
    && (selectedSeverities.length === 0 || (entry.severity !== undefined && selectedSeverities.includes(entry.severity)))
    && tagPattern.matches(entry.tag ?? '')
    && (!patterns.excludeTag.trim() || !excludeTagPattern.matches(entry.tag ?? ''))
    && processPattern.matches(processNames.get(entry.pid ?? -1) ?? '')
    && messagePattern.matches(entry.message ?? entry.raw))
}

/** Format the given rows as a plain-text export. */
export function exportAndroidLogcatEntries(entries: readonly AndroidLogcatEntry[]): string {
  return entries.map(entry => entry.raw).join('\n')
}

/** Fetch one PNG captured from the selected Android device. */
export async function captureAndroidLogcatScreenshot(serial: string, signal?: AbortSignal): Promise<Blob> {
  const query = new URLSearchParams({ serial })
  const response = await fetch(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?${query}`, {
    cache: 'no-store',
    ...(signal === undefined ? {} : { signal }),
  })
  if (!response.ok) {
    let message = `Screenshot request failed (${response.status})`
    try {
      const value: unknown = await response.json()
      if (typeof value === 'object' && value !== null && 'error' in value && typeof value.error === 'string') message = value.error
    } catch { /* Keep the HTTP status when the Host error body is not JSON. */ }
    throw new AndroidLogcatApiError(message, response.status)
  }
  const blob = await response.blob()
  const signature = new Uint8Array(await blob.slice(0, 8).arrayBuffer())
  const expected = [137, 80, 78, 71, 13, 10, 26, 10]
  if (blob.type !== 'image/png' || signature.length !== expected.length || expected.some((byte, index) => signature[index] !== byte)) {
    throw new AndroidLogcatApiError('The device returned an invalid PNG screenshot.')
  }
  return blob
}

/** Copy one validated PNG screenshot into the system image clipboard. */
export async function copyAndroidLogcatScreenshotToClipboard(blob: Blob): Promise<void> {
  if (typeof navigator === 'undefined' || typeof navigator.clipboard?.write !== 'function' || typeof ClipboardItem === 'undefined') {
    throw new AndroidLogcatApiError('Image clipboard writing is not supported in this environment.')
  }
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
}
