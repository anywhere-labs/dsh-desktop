import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-store'
import {
  cancelAndroidLogcatLogWrite,
  clearAndroidLogcatEntries,
  flushAndroidLogcatLogWrites,
  readAndroidLogcatEntries,
  scheduleAndroidLogcatLogWrite,
} from './android-logcat-log-persistence.ts'
import {
  DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES,
  readAndroidLogcatDisplayPreferences,
} from './android-logcat-preferences.ts'
import {
  ANDROID_LOGCAT_MAX_ENTRIES,
  makeAndroidLogcatEntry,
  normalizeAndroidLogcatSince,
  type AndroidLogcatDevice,
  type AndroidLogcatEntry,
  type AndroidLogcatProcess,
  type AndroidLogcatSeverity,
} from './android-logcat-api.ts'

export interface AndroidLogcatState {
  open: boolean
  collapsed: boolean
  height: number
  available: boolean | null
  devices: AndroidLogcatDevice[]
  selectedSerial: string
  devicesError: string
  processes: AndroidLogcatProcess[]
  selectedPids: number[]
  selectedTags: string[]
  processesError: string
  selectedSeverities: AndroidLogcatSeverity[]
  tagPattern: string
  excludeTagPattern: string
  processPattern: string
  messagePattern: string
  uiFontSize: number
  logFontSize: number
  showOperationTips: boolean
  entries: AndroidLogcatEntry[]
  pausedEntries: AndroidLogcatEntry[] | null
  nextEntryId: number
  /** Newest seen threadtime timestamp (`MM-DD HH:MM:SS.mmm`); reconnects resume after it via `adb logcat -T`. */
  sinceMarker: string
  streamActive: boolean
  streamReconnecting: boolean
  streamError: string
  paused: boolean
  autoFollow: boolean
  focusReturnRequested: boolean
}

type AndroidLogcatActions = {
  open: (draft: AndroidLogcatState) => void
  close: (draft: AndroidLogcatState) => void
  consumeFocusReturn: (draft: AndroidLogcatState) => void
  toggleCollapsed: (draft: AndroidLogcatState) => void
  setHeight: (draft: AndroidLogcatState, height: number) => void
  setDevices: (draft: AndroidLogcatState, available: boolean, devices: readonly AndroidLogcatDevice[]) => void
  setDevicesError: (draft: AndroidLogcatState, error: string) => void
  setSelectedSerial: (draft: AndroidLogcatState, serial: string) => void
  setProcesses: (draft: AndroidLogcatState, processes: readonly AndroidLogcatProcess[]) => void
  setProcessesError: (draft: AndroidLogcatState, error: string) => void
  setSelectedPids: (draft: AndroidLogcatState, pids: readonly number[]) => void
  setSelectedTags: (draft: AndroidLogcatState, tags: readonly string[]) => void
  setSelectedSeverities: (draft: AndroidLogcatState, severities: readonly AndroidLogcatSeverity[]) => void
  setTagPattern: (draft: AndroidLogcatState, pattern: string) => void
  setExcludeTagPattern: (draft: AndroidLogcatState, pattern: string) => void
  setProcessPattern: (draft: AndroidLogcatState, pattern: string) => void
  setMessagePattern: (draft: AndroidLogcatState, pattern: string) => void
  setUiFontSize: (draft: AndroidLogcatState, size: number) => void
  setLogFontSize: (draft: AndroidLogcatState, size: number) => void
  setShowOperationTips: (draft: AndroidLogcatState, show: boolean) => void
  start: (draft: AndroidLogcatState) => void
  stop: (draft: AndroidLogcatState) => void
  setStreamError: (draft: AndroidLogcatState, error: string) => void
  setStreamConnected: (draft: AndroidLogcatState) => void
  setStreamReconnecting: (draft: AndroidLogcatState) => void
  appendLines: (draft: AndroidLogcatState, lines: readonly string[]) => void
  clear: (draft: AndroidLogcatState) => void
  pause: (draft: AndroidLogcatState) => void
  resume: (draft: AndroidLogcatState) => void
  toggleAutoFollow: (draft: AndroidLogcatState) => void
  setAutoFollow: (draft: AndroidLogcatState, follow: boolean) => void
}

/** Latest parseable timestamp of one entry list, normalized for `adb logcat -T`. */
function sinceMarkerFromEntries(entries: readonly AndroidLogcatEntry[]): string {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const timestamp = entries[index]?.timestamp
    if (timestamp === undefined) continue
    const since = normalizeAndroidLogcatSince(timestamp)
    if (since !== undefined) return since
  }
  return ''
}

/** Shared selection reset used by explicit device picks and automatic device selection. */
function applySerialSelection(draft: AndroidLogcatState, serial: string): void {
  draft.selectedSerial = serial
  draft.processes = []
  draft.selectedPids = []
  draft.selectedTags = []
  draft.tagPattern = DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.tag
  draft.excludeTagPattern = DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.excludeTag
  draft.processPattern = DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.process
  draft.messagePattern = DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.message
  draft.processesError = ''
  draft.streamError = ''
  draft.streamReconnecting = false
  draft.entries = readAndroidLogcatEntries(serial)
  draft.pausedEntries = null
  draft.nextEntryId = draft.entries.length + 1
  draft.sinceMarker = sinceMarkerFromEntries(draft.entries)
  draft.paused = false
  draft.streamActive = false
}

/** Shared Client slot state for the Logcat launcher and drawer. */
export function createAndroidLogcatStore(): EngineStoreHandle<AndroidLogcatState, AndroidLogcatActions> {
  return defineStore({
    init: (): AndroidLogcatState => {
      const displayPreferences = readAndroidLogcatDisplayPreferences()
      return {
        open: false,
        collapsed: false,
        height: 340,
        available: null,
        devices: [],
        selectedSerial: '',
        devicesError: '',
        processes: [],
        selectedPids: [],
        selectedTags: [],
        processesError: '',
        selectedSeverities: [],
        tagPattern: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.tag,
        excludeTagPattern: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.excludeTag,
        processPattern: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.process,
        messagePattern: DEFAULT_ANDROID_LOGCAT_FILTER_PREFERENCES.message,
        uiFontSize: displayPreferences.uiFontSize,
        logFontSize: displayPreferences.logFontSize,
        showOperationTips: displayPreferences.showOperationTips,
        entries: [],
        pausedEntries: null,
        nextEntryId: 1,
        sinceMarker: '',
        streamActive: false,
        streamReconnecting: false,
        streamError: '',
        paused: false,
        autoFollow: true,
        focusReturnRequested: false,
      }
    },
    actions: {
      open: draft => { draft.open = true; draft.collapsed = false; draft.focusReturnRequested = false },
      close: draft => {
        flushAndroidLogcatLogWrites()
        draft.focusReturnRequested = draft.open
        draft.open = false
        draft.streamActive = false
        draft.streamReconnecting = false
      },
      consumeFocusReturn: draft => { draft.focusReturnRequested = false },
      toggleCollapsed: draft => { draft.collapsed = !draft.collapsed },
      setHeight: (draft, height: number) => {
        draft.height = Math.max(180, Math.min(720, Math.round(height)))
      },
      setDevices: (draft, available: boolean, devices: readonly AndroidLogcatDevice[]) => {
        draft.available = available
        draft.devices = [...devices]
        draft.devicesError = ''
        if (draft.selectedSerial === '') {
          // Default to the first connected device so the drawer never opens on an empty pick.
          const firstConnected = devices.find(device => device.state === 'device')
          if (firstConnected !== undefined) applySerialSelection(draft, firstConnected.serial)
          return
        }
        const selected = devices.find(device => device.serial === draft.selectedSerial)
        if (selected === undefined) {
          if (!draft.streamActive) {
            draft.processes = []
            draft.selectedPids = []
            draft.selectedTags = []
            draft.processesError = ''
          }
        } else if ((!available || selected.state !== 'device') && !draft.streamActive) {
          draft.streamActive = false
        }
      },
      setDevicesError: (draft, error: string) => { draft.devicesError = error },
      setSelectedSerial: (draft, serial: string) => {
        if (draft.selectedSerial === serial) return
        flushAndroidLogcatLogWrites()
        applySerialSelection(draft, serial)
      },
      setProcesses: (draft, processes: readonly AndroidLogcatProcess[]) => {
        // Polled refreshes usually return the same list; avoid churning subscribers then.
        const unchanged = draft.processes.length === processes.length
          && draft.processes.every((current, index) => current.pid === processes[index]?.pid && current.name === processes[index]?.name)
        draft.processesError = ''
        if (!unchanged) draft.processes = [...processes]
      },
      setProcessesError: (draft, error: string) => { draft.processesError = error },
      setSelectedPids: (draft, pids: readonly number[]) => { draft.selectedPids = [...new Set(pids)] },
      setSelectedTags: (draft, tags: readonly string[]) => { draft.selectedTags = [...new Set(tags)] },
      setSelectedSeverities: (draft, severities: readonly AndroidLogcatSeverity[]) => { draft.selectedSeverities = [...new Set(severities)] },
      setTagPattern: (draft, pattern: string) => { draft.tagPattern = pattern },
      setExcludeTagPattern: (draft, pattern: string) => { draft.excludeTagPattern = pattern },
      setProcessPattern: (draft, pattern: string) => { draft.processPattern = pattern },
      setMessagePattern: (draft, pattern: string) => { draft.messagePattern = pattern },
      setUiFontSize: (draft, size: number) => { draft.uiFontSize = size },
      setLogFontSize: (draft, size: number) => { draft.logFontSize = size },
      setShowOperationTips: (draft, show: boolean) => { draft.showOperationTips = show },
      start: draft => { draft.streamActive = true; draft.streamReconnecting = false; draft.streamError = '' },
      stop: draft => {
        flushAndroidLogcatLogWrites()
        draft.streamActive = false
        draft.streamReconnecting = false
      },
      setStreamError: (draft, error: string) => { draft.streamError = error; draft.streamActive = false; draft.streamReconnecting = false },
      setStreamConnected: draft => { if (draft.streamActive) draft.streamReconnecting = false },
      setStreamReconnecting: draft => { if (draft.streamActive) draft.streamReconnecting = true },
      appendLines: (draft, lines: readonly string[]) => {
        for (const line of lines) {
          const entry = makeAndroidLogcatEntry(line, draft.nextEntryId++)
          const since = entry.timestamp === undefined ? undefined : normalizeAndroidLogcatSince(entry.timestamp)
          // A restarted `adb logcat -T` stream replays lines at or before the marker; drop that overlap.
          if (since !== undefined && draft.sinceMarker !== '' && since <= draft.sinceMarker) continue
          if (since !== undefined) draft.sinceMarker = since
          draft.entries.push(entry)
        }
        const overflow = draft.entries.length - ANDROID_LOGCAT_MAX_ENTRIES
        if (overflow > 0) draft.entries.splice(0, overflow)
        scheduleAndroidLogcatLogWrite(draft.selectedSerial, draft.entries)
      },
      clear: draft => {
        // Keep `sinceMarker`: a later start must not replay the buffer the user just cleared away.
        cancelAndroidLogcatLogWrite(draft.selectedSerial)
        clearAndroidLogcatEntries(draft.selectedSerial)
        draft.entries = []
        draft.pausedEntries = draft.paused ? [] : null
      },
      pause: draft => {
        if (draft.paused) return
        draft.paused = true
        draft.pausedEntries = [...draft.entries]
      },
      resume: draft => { draft.paused = false; draft.pausedEntries = null },
      toggleAutoFollow: draft => { draft.autoFollow = !draft.autoFollow },
      setAutoFollow: (draft, follow: boolean) => { draft.autoFollow = follow },
    },
  })
}

export type AndroidLogcatStore = ReturnType<typeof createAndroidLogcatStore>
