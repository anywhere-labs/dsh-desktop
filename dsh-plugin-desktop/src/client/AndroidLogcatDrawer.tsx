import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { CSSProperties, PointerEvent as ReactPointerEvent, KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  ANDROID_LOGCAT_MAX_FILTER_LENGTH,
  androidLogcatErrorMessage,
  captureAndroidLogcatScreenshot,
  copyAndroidLogcatScreenshotToClipboard,
  compileAndroidLogcatPattern,
  exportAndroidLogcatEntries,
  filterAndroidLogcatEntries,
  readAndroidLogcatDevices,
  readAndroidLogcatProcesses,
  streamAndroidLogcatWithReconnect,
  type AndroidLogcatDevice,
  type AndroidLogcatSeverity,
} from './android-logcat-api.ts'
import { ANDROID_LOGCAT_LOCALE_NAMESPACE } from './android-logcat-locales.ts'
import { flushAndroidLogcatLogWrites } from './android-logcat-log-persistence.ts'
import {
  ANDROID_LOGCAT_LOG_FONT_SIZES,
  ANDROID_LOGCAT_UI_FONT_SIZES,
  readAndroidLogcatFilterPreferences,
  writeAndroidLogcatFilterPreferences,
  writeAndroidLogcatDisplayPreferences,
} from './android-logcat-preferences.ts'
import type { AndroidLogcatDisplayPreferences, AndroidLogcatFilterPatterns } from './android-logcat-preferences.ts'
import type { AndroidLogcatStore } from './android-logcat-store.ts'

export type AndroidLogcatDrawerProps = PropsRuntime<'shell.overlay'>
  & PropsStore<AndroidLogcatStore>
  & PropsLocale<typeof ANDROID_LOGCAT_LOCALE_NAMESPACE>

const LEVELS: readonly AndroidLogcatSeverity[] = ['verbose', 'debug', 'info', 'warn', 'error']
/** While following live output, only this trailing window is rendered; history expands on scroll-up. */
const LOG_RENDER_WINDOW = 500
/** Distance from the bottom (px) still treated as "at the bottom" for follow state. */
const FOLLOW_BOTTOM_THRESHOLD_PX = 40
/** Poll cadence for the device process list so newly started apps appear without reselecting. */
const PROCESS_POLL_INTERVAL_MS = 5_000
/** The drawer is client-only; fall back to a passive effect for server-side test renders. */
const useIsomorphicLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect

/** Bottom-anchored Logcat drawer; its overlay intentionally does not resize the host layout. */
export function AndroidLogcatDrawer({ useStore, actions, t }: AndroidLogcatDrawerProps) {
  const state = useStore(snapshot => snapshot)
  const actionsRef = useRef(actions)
  actionsRef.current = actions
  const drawerRef = useRef<HTMLElement>(null)
  const logListRef = useRef<HTMLDivElement>(null)
  const selectedSerialRef = useRef(state.selectedSerial)
  selectedSerialRef.current = state.selectedSerial
  const sinceMarkerRef = useRef(state.sinceMarker)
  sinceMarkerRef.current = state.sinceMarker
  /** Latest viewport distance from the list bottom, kept so window expansion can restore it. */
  const keepFromBottomRef = useRef(0)
  const wasWindowedRef = useRef(false)
  const [deviceLoading, setDeviceLoading] = useState(false)
  const [processLoading, setProcessLoading] = useState(false)
  const [screenshotLoading, setScreenshotLoading] = useState(false)
  const [screenshotUrl, setScreenshotUrl] = useState<string | null>(null)
  const [screenshotBlob, setScreenshotBlob] = useState<Blob | null>(null)
  const [screenshotCopyNotice, setScreenshotCopyNotice] = useState('')
  const [actionNotice, setActionNotice] = useState('')
  const screenshotControllerRef = useRef<AbortController | null>(null)
  const screenshotUrlRef = useRef<string | null>(null)

  const visibleSource = state.paused ? state.pausedEntries ?? [] : state.entries
  const filterResults = useMemo(() => ({
    tag: compileAndroidLogcatPattern(state.tagPattern),
    excludeTag: compileAndroidLogcatPattern(state.excludeTagPattern),
    processFilter: compileAndroidLogcatPattern(state.processPattern),
    message: compileAndroidLogcatPattern(state.messagePattern),
  }), [state.tagPattern, state.excludeTagPattern, state.processPattern, state.messagePattern])
  const filterPatterns: AndroidLogcatFilterPatterns = {
    tag: state.tagPattern,
    excludeTag: state.excludeTagPattern,
    process: state.processPattern,
    message: state.messagePattern,
  }
  const visibleEntries = useMemo(
    () => filterAndroidLogcatEntries(
      visibleSource, state.selectedPids, state.selectedTags, state.selectedSeverities,
      filterPatterns, state.processes,
    ),
    [visibleSource, state.selectedPids, state.selectedTags, state.selectedSeverities, filterPatterns.tag, filterPatterns.excludeTag, filterPatterns.process, filterPatterns.message, state.processes],
  )
  const availableTags = useMemo(() => [...new Set(visibleSource.flatMap(entry => entry.tag ? [entry.tag] : []))].sort(), [visibleSource])
  // While pinned to the live tail, render only a trailing window; scrolling up (or pausing)
  // expands the full history so the live-stream DOM cost stays bounded.
  const following = state.autoFollow && !state.paused
  const windowed = following && visibleEntries.length > LOG_RENDER_WINDOW
  const renderedEntries = windowed ? visibleEntries.slice(-LOG_RENDER_WINDOW) : visibleEntries

  useEffect(() => {
    screenshotControllerRef.current?.abort()
    screenshotControllerRef.current = null
    if (screenshotUrlRef.current !== null) URL.revokeObjectURL(screenshotUrlRef.current)
    screenshotUrlRef.current = null
    setScreenshotUrl(null)
    setScreenshotBlob(null)
    setScreenshotCopyNotice('')
    setScreenshotLoading(false)
    return () => screenshotControllerRef.current?.abort()
  }, [state.open, state.selectedSerial])

  useEffect(() => () => {
    screenshotControllerRef.current?.abort()
    if (screenshotUrlRef.current !== null) URL.revokeObjectURL(screenshotUrlRef.current)
  }, [])

  const refreshDevices = useCallback(async (signal?: AbortSignal) => {
    setDeviceLoading(true)
    try {
      const result = await readAndroidLogcatDevices(signal)
      actionsRef.current.setDevices(result.available, result.devices)
      if (result.error) actionsRef.current.setDevicesError(result.error)
    } catch (error) {
      if (!(error instanceof Error && error.name === 'AbortError')) {
        actionsRef.current.setDevicesError(androidLogcatErrorMessage(error))
      }
    } finally {
      if (!signal?.aborted) setDeviceLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!state.open) return
    const controller = new AbortController()
    void refreshDevices(controller.signal)
    return () => controller.abort()
  }, [state.open, refreshDevices])

  // Poll the device process list so apps started after device selection still appear.
  useEffect(() => {
    if (!state.open || !state.selectedSerial) return
    const serial = state.selectedSerial
    let cancelled = false
    let inFlight = false
    let first = true
    const tick = async () => {
      if (cancelled || inFlight) return
      inFlight = true
      if (first) setProcessLoading(true)
      try {
        const result = await readAndroidLogcatProcesses(serial)
        if (!cancelled) actionsRef.current.setProcesses(result.processes)
      } catch (error) {
        if (!cancelled) actionsRef.current.setProcessesError(androidLogcatErrorMessage(error))
      } finally {
        inFlight = false
        if (first) {
          first = false
          if (!cancelled) setProcessLoading(false)
        }
      }
    }
    void tick()
    const timer = setInterval(() => { void tick() }, PROCESS_POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(timer) }
  }, [state.open, state.selectedSerial])

  // Load the per-device remembered filters whenever the selection changes, including
  // the automatic first-connected-device pick done by the store.
  const filtersLoadedSerialRef = useRef('')
  useEffect(() => {
    const serial = state.selectedSerial
    if (!state.open || serial === '' || filtersLoadedSerialRef.current === serial) return
    filtersLoadedSerialRef.current = serial
    const saved = readAndroidLogcatFilterPreferences(serial)
    actionsRef.current.setTagPattern(saved.tag)
    actionsRef.current.setExcludeTagPattern(saved.excludeTag)
    actionsRef.current.setProcessPattern(saved.process)
    actionsRef.current.setMessagePattern(saved.message)
  }, [state.open, state.selectedSerial])

  useEffect(() => {
    if (!state.open || !state.streamActive || !state.selectedSerial) return
    const controller = new AbortController()
    const serial = state.selectedSerial
    let pending: string[] = []
    let frame: number | undefined
    const flush = () => {
      frame = undefined
      const batch = pending
      pending = []
      if (batch.length > 0 && selectedSerialRef.current === serial) actionsRef.current.appendLines(batch)
    }
    void streamAndroidLogcatWithReconnect(serial, controller.signal, line => {
      pending.push(line)
      if (frame === undefined) frame = requestAnimationFrame(flush)
    }, () => actionsRef.current.setStreamConnected(), () => actionsRef.current.setStreamReconnecting(),
    () => sinceMarkerRef.current === '' ? undefined : sinceMarkerRef.current).then(() => {
      if (!controller.signal.aborted) actionsRef.current.stop()
    }).catch(error => {
      if (!controller.signal.aborted) actionsRef.current.setStreamError(androidLogcatErrorMessage(error) || t('streamStopped'))
    })
    return () => {
      controller.abort()
      if (frame !== undefined) cancelAnimationFrame(frame)
      if (selectedSerialRef.current === serial) flush()
      else pending = []
    }
  }, [state.open, state.streamActive, state.selectedSerial, t])

  useEffect(() => {
    if (!state.open) return
    drawerRef.current?.focus()
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      if (document.querySelectorAll('[role="dialog"][aria-modal="true"]').length > 0) return
      actionsRef.current.close()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [state.open])

  useEffect(() => {
    if (!state.open || state.collapsed || !state.autoFollow || state.paused) return
    const element = logListRef.current
    if (element !== null) {
      element.scrollTop = element.scrollHeight
      keepFromBottomRef.current = element.clientHeight
    }
  }, [state.open, state.collapsed, state.autoFollow, state.paused, visibleEntries])

  // Smart follow: scrolling away from the bottom pauses follow, scrolling back resumes it.
  const onLogListScroll = () => {
    const element = logListRef.current
    if (element === null) return
    keepFromBottomRef.current = element.scrollHeight - element.scrollTop
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= FOLLOW_BOTTOM_THRESHOLD_PX
    if (atBottom !== state.autoFollow) actionsRef.current.setAutoFollow(atBottom)
  }

  // Expanding from the trailing window to full history inserts rows above the viewport;
  // keep the same rows in view by restoring the distance from the bottom.
  useIsomorphicLayoutEffect(() => {
    const element = logListRef.current
    if (element !== null && wasWindowedRef.current && !windowed) {
      element.scrollTop = element.scrollHeight - keepFromBottomRef.current
    }
    wasWindowedRef.current = windowed
  }, [windowed, renderedEntries])

  // Flush debounced log persistence before the page is hidden or unloaded.
  useEffect(() => {
    const flushOnHide = () => { if (document.visibilityState === 'hidden') flushAndroidLogcatLogWrites() }
    document.addEventListener('visibilitychange', flushOnHide)
    window.addEventListener('pagehide', flushAndroidLogcatLogWrites)
    return () => {
      document.removeEventListener('visibilitychange', flushOnHide)
      window.removeEventListener('pagehide', flushAndroidLogcatLogWrites)
    }
  }, [])

  const onResizePointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
  }
  const onResizePointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    actionsRef.current.setHeight(window.innerHeight - event.clientY)
  }
  const onResizePointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const onResizeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return
    event.preventDefault()
    actionsRef.current.setHeight(state.height + (event.key === 'ArrowUp' ? 24 : -24))
  }

  const selectedDevice = state.devices.find(device => device.serial === state.selectedSerial)
  const selectedDeviceConnected = selectedDevice?.state === 'device'
  const unavailable = state.available === false
  // Filter preferences load through the selectedSerial effect, so auto-selected and
  // manually picked devices behave identically here.
  const selectDevice = (serial: string) => {
    actionsRef.current.setSelectedSerial(serial)
  }
  const updateFilterPattern = (field: keyof AndroidLogcatFilterPatterns, value: string) => {
    const patterns: AndroidLogcatFilterPatterns = {
      tag: field === 'tag' ? value : state.tagPattern,
      excludeTag: field === 'excludeTag' ? value : state.excludeTagPattern,
      process: field === 'process' ? value : state.processPattern,
      message: field === 'message' ? value : state.messagePattern,
    }
    if (field === 'tag') actionsRef.current.setTagPattern(value)
    else if (field === 'excludeTag') actionsRef.current.setExcludeTagPattern(value)
    else if (field === 'process') actionsRef.current.setProcessPattern(value)
    else actionsRef.current.setMessagePattern(value)
    writeAndroidLogcatFilterPreferences(state.selectedSerial, patterns)
  }
  const updateDisplayPreference = (field: keyof AndroidLogcatDisplayPreferences, value: number | boolean) => {
    const preferences: AndroidLogcatDisplayPreferences = {
      uiFontSize: field === 'uiFontSize' ? Number(value) : state.uiFontSize,
      logFontSize: field === 'logFontSize' ? Number(value) : state.logFontSize,
      showOperationTips: field === 'showOperationTips' ? Boolean(value) : state.showOperationTips,
    }
    if (field === 'uiFontSize') actionsRef.current.setUiFontSize(preferences.uiFontSize)
    else if (field === 'logFontSize') actionsRef.current.setLogFontSize(preferences.logFontSize)
    else actionsRef.current.setShowOperationTips(preferences.showOperationTips)
    writeAndroidLogcatDisplayPreferences(preferences)
  }
  const dimensions: CSSProperties & {
    '--dsh-android-logcat-height': string
    '--dsh-android-logcat-ui-font-size': string
    '--dsh-android-logcat-log-font-size': string
  } = {
    '--dsh-android-logcat-height': `${state.height}px`,
    '--dsh-android-logcat-ui-font-size': `${state.uiFontSize}px`,
    '--dsh-android-logcat-log-font-size': `${state.logFontSize}px`,
  }

  const copyVisible = async () => {
    try {
      await navigator.clipboard.writeText(exportAndroidLogcatEntries(visibleEntries))
      setActionNotice(t('copied'))
    } catch {
      setActionNotice(t('copyFailed'))
    }
  }

  const exportVisible = () => {
    try {
      const blob = new Blob([exportAndroidLogcatEntries(visibleEntries)], { type: 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `android-logcat-${new Date().toISOString().replaceAll(':', '-')}.txt`
      anchor.click()
      URL.revokeObjectURL(url)
      setActionNotice(t('exported'))
    } catch {
      setActionNotice(t('exportFailed'))
    }
  }

  const captureScreenshot = async () => {
    if (!state.selectedSerial) return
    screenshotControllerRef.current?.abort()
    const controller = new AbortController()
    screenshotControllerRef.current = controller
    setScreenshotLoading(true)
    try {
      const blob = await captureAndroidLogcatScreenshot(state.selectedSerial, controller.signal)
      if (controller.signal.aborted) return
      if (screenshotUrlRef.current !== null) URL.revokeObjectURL(screenshotUrlRef.current)
      const url = URL.createObjectURL(blob)
      screenshotUrlRef.current = url
      setScreenshotUrl(url)
      setScreenshotBlob(blob)
      setScreenshotCopyNotice('')
      setActionNotice(t('screenshotCaptured'))
    } catch (error) {
      if (!controller.signal.aborted) setActionNotice(androidLogcatErrorMessage(error) || t('screenshotFailed'))
    } finally {
      if (screenshotControllerRef.current === controller) screenshotControllerRef.current = null
      if (!controller.signal.aborted) setScreenshotLoading(false)
    }
  }

  const copyScreenshot = async () => {
    if (screenshotBlob === null) return
    try {
      await copyAndroidLogcatScreenshotToClipboard(screenshotBlob)
      setScreenshotCopyNotice(t('screenshotCopied'))
    } catch {
      setScreenshotCopyNotice(t('screenshotCopyFailed'))
    }
  }

  const closeScreenshot = () => {
    screenshotControllerRef.current?.abort()
    screenshotControllerRef.current = null
    if (screenshotUrlRef.current !== null) URL.revokeObjectURL(screenshotUrlRef.current)
    screenshotUrlRef.current = null
    setScreenshotUrl(null)
    setScreenshotBlob(null)
    setScreenshotCopyNotice('')
    setScreenshotLoading(false)
  }

  // Row PID click is the "show only this process" shortcut: first click isolates the
  // process, clicking the same row again restores the unfiltered view.
  const togglePidExclusive = (pid: number) => {
    const alreadyExclusive = state.selectedPids.length === 1 && state.selectedPids[0] === pid
    actionsRef.current.setSelectedPids(alreadyExclusive ? [] : [pid])
  }
  const toggleTag = (tag: string) => actionsRef.current.setSelectedTags(toggleSelection(state.selectedTags, tag))

  if (!state.open) return null

  return (
    <>
    <section
      id="dsh-android-logcat-drawer"
      ref={drawerRef}
      className="dshAndroidLogcatDrawer"
      data-collapsed={state.collapsed || undefined}
      style={dimensions}
      role="region"
      aria-label={t('title')}
      tabIndex={-1}
    >
      {!state.collapsed && (
        <div
          className="dshAndroidLogcatResizeHandle"
          role="separator"
          aria-orientation="horizontal"
          aria-label={t('resize')}
          aria-valuemin={180}
          aria-valuemax={720}
          aria-valuenow={state.height}
          tabIndex={0}
          onPointerDown={onResizePointerDown}
          onPointerMove={onResizePointerMove}
          onPointerUp={onResizePointerUp}
          onKeyDown={onResizeKeyDown}
        />
      )}
      <header className="dshAndroidLogcatHeader">
        <div className="dshAndroidLogcatHeading">
          <strong>{t('title')}</strong>
          {!state.collapsed && <span>{t('subtitle')}</span>}
          {state.streamActive && <span className="dshAndroidLogcatStatus" data-state={state.streamReconnecting ? 'reconnecting' : 'running'}>{state.streamReconnecting ? t('reconnecting') : t('running')}</span>}
          {state.paused && <span className="dshAndroidLogcatStatus" data-state="paused">{t('paused')}</span>}
        </div>
        <div className="dshAndroidLogcatHeaderActions">
          <button type="button" className="dshAndroidLogcatIconButton" aria-label={state.collapsed ? t('expand') : t('collapse')} title={state.collapsed ? t('expand') : t('collapse')} onClick={() => actions.toggleCollapsed()}>
            {state.collapsed ? '▴' : '▾'}
          </button>
          <button type="button" className="dshAndroidLogcatIconButton" aria-label={t('close')} title={t('close')} onClick={() => actions.close()}>×</button>
        </div>
      </header>
      {!state.collapsed && (
        <>
          <div className="dshAndroidLogcatToolbar">
            <label className="dshAndroidLogcatField">
              <span>{t('device')}</span>
              <select
                aria-label={t('device')}
                value={state.selectedSerial}
                onChange={event => selectDevice(event.currentTarget.value)}
              >
                <option value="">{t('chooseDevice')}</option>
                {state.selectedSerial && selectedDevice === undefined && <option value={state.selectedSerial}>{state.selectedSerial} ({t('offline')})</option>}
                {state.devices.map(device => <option key={device.serial} value={device.serial}>{deviceLabel(device, t)}</option>)}
              </select>
            </label>
            <button type="button" className="dshAndroidLogcatButton" aria-label={t('refreshDevices')} title={t('refreshDevices')} disabled={deviceLoading} onClick={() => { void refreshDevices() }}>
              {deviceLoading ? '…' : '↻'}
            </button>
            <MultiSelectFilter
              label={t('processes')}
              allLabel={processLoading ? t('loadingProcesses') : t('allProcesses')}
              disabled={!state.selectedSerial || processLoading}
              selected={state.selectedPids.map(String)}
              options={state.processes.map(androidProcess => ({ value: String(androidProcess.pid), label: `${androidProcess.name} (PID ${androidProcess.pid})` }))}
              onChange={values => actions.setSelectedPids(values.map(Number).filter(Number.isSafeInteger))}
            />
            <MultiSelectFilter
              label={t('severity')}
              allLabel={t('allLevels')}
              disabled={!state.selectedSerial}
              selected={[...state.selectedSeverities]}
              options={LEVELS.map(level => ({ value: level, label: t(level) }))}
              onChange={values => actions.setSelectedSeverities(values as AndroidLogcatSeverity[])}
            />
            <button type="button" className="dshAndroidLogcatButton" disabled={!selectedDeviceConnected || unavailable || screenshotLoading} onClick={() => { void captureScreenshot() }}>
              {screenshotLoading ? t('screenshotLoading') : t('screenshot')}
            </button>
            <button
              type="button"
              className="dshAndroidLogcatButton dshAndroidLogcatPrimaryButton"
              disabled={!state.streamActive && (!selectedDeviceConnected || unavailable)}
              onClick={() => state.streamActive ? actions.stop() : actions.start()}
            >
              {state.streamActive ? t('stop') : t('start')}
            </button>
          </div>
          <div className="dshAndroidLogcatToolbar dshAndroidLogcatFilterBar">
            <MultiSelectFilter
              label={t('tags')}
              allLabel={t('allTags')}
              disabled={availableTags.length === 0}
              selected={[...state.selectedTags]}
              options={[...new Set([...state.selectedTags, ...availableTags])].map(tag => ({ value: tag, label: tag }))}
              onChange={values => actions.setSelectedTags(values)}
            />
            <label className="dshAndroidLogcatPatternField">
              <span>{t('tagFilter')}</span>
              <input
                type="search"
                aria-label={t('tagFilter')}
                aria-describedby="dsh-android-logcat-filter-help"
                aria-invalid={filterResults.tag.error !== undefined}
                maxLength={ANDROID_LOGCAT_MAX_FILTER_LENGTH}
                spellCheck={false}
                placeholder={t('tagFilterPlaceholder')}
                value={state.tagPattern}
                onChange={event => updateFilterPattern('tag', event.currentTarget.value)}
              />
              {filterResults.tag.error && <span className="dshAndroidLogcatFilterError" role="alert">{t('invalidFilter')}</span>}
            </label>
            <label className="dshAndroidLogcatPatternField">
              <span>{t('excludeTagFilter')}</span>
              <input
                type="search"
                aria-label={t('excludeTagFilter')}
                aria-describedby="dsh-android-logcat-filter-help"
                aria-invalid={filterResults.excludeTag.error !== undefined}
                maxLength={ANDROID_LOGCAT_MAX_FILTER_LENGTH}
                spellCheck={false}
                placeholder={t('excludeTagFilterPlaceholder')}
                value={state.excludeTagPattern}
                onChange={event => updateFilterPattern('excludeTag', event.currentTarget.value)}
              />
              {filterResults.excludeTag.error && <span className="dshAndroidLogcatFilterError" role="alert">{t('invalidFilter')}</span>}
            </label>
            <label className="dshAndroidLogcatPatternField">
              <span>{t('processFilter')}</span>
              <input
                type="search"
                aria-label={t('processFilter')}
                aria-describedby="dsh-android-logcat-filter-help"
                aria-invalid={filterResults.processFilter.error !== undefined}
                maxLength={ANDROID_LOGCAT_MAX_FILTER_LENGTH}
                spellCheck={false}
                placeholder={t('processFilterPlaceholder')}
                value={state.processPattern}
                onChange={event => updateFilterPattern('process', event.currentTarget.value)}
              />
              {filterResults.processFilter.error && <span className="dshAndroidLogcatFilterError" role="alert">{t('invalidFilter')}</span>}
            </label>
            <label className="dshAndroidLogcatPatternField">
              <span>{t('messageFilter')}</span>
              <input
                type="search"
                aria-label={t('messageFilter')}
                aria-describedby="dsh-android-logcat-filter-help"
                aria-invalid={filterResults.message.error !== undefined}
                maxLength={ANDROID_LOGCAT_MAX_FILTER_LENGTH}
                spellCheck={false}
                placeholder={t('messageFilterPlaceholder')}
                value={state.messagePattern}
                onChange={event => updateFilterPattern('message', event.currentTarget.value)}
              />
              {filterResults.message.error && <span className="dshAndroidLogcatFilterError" role="alert">{t('invalidFilter')}</span>}
            </label>
            <button type="button" className="dshAndroidLogcatButton" disabled={visibleEntries.length === 0} onClick={() => { void copyVisible() }}>{t('copy')}</button>
            <button type="button" className="dshAndroidLogcatButton" disabled={visibleEntries.length === 0} onClick={exportVisible}>{t('export')}</button>
            <button type="button" className="dshAndroidLogcatButton" onClick={() => actions.clear()}>{t('clear')}</button>
            <button type="button" className="dshAndroidLogcatButton" onClick={() => state.paused ? actions.resume() : actions.pause()}>
              {state.paused ? t('resume') : t('pause')}
            </button>
            <label className="dshAndroidLogcatFollowToggle" title={t('followHint')}>
              <input type="checkbox" checked={state.autoFollow} onChange={() => actions.toggleAutoFollow()} />
              <span>{t('autoFollow')}</span>
            </label>
          </div>
          <div className="dshAndroidLogcatDisplaySettings">
            <label className="dshAndroidLogcatDisplayField">
              <span>{t('uiFontSize')}</span>
              <select aria-label={t('uiFontSize')} value={state.uiFontSize} onChange={event => updateDisplayPreference('uiFontSize', Number(event.currentTarget.value))}>
                {ANDROID_LOGCAT_UI_FONT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
              </select>
            </label>
            <label className="dshAndroidLogcatDisplayField">
              <span>{t('logFontSize')}</span>
              <select aria-label={t('logFontSize')} value={state.logFontSize} onChange={event => updateDisplayPreference('logFontSize', Number(event.currentTarget.value))}>
                {ANDROID_LOGCAT_LOG_FONT_SIZES.map(size => <option key={size} value={size}>{size} px</option>)}
              </select>
            </label>
            <label className="dshAndroidLogcatTipsToggle">
              <input
                type="checkbox"
                aria-label={t('showOperationTips')}
                aria-controls="dsh-android-logcat-filter-help"
                checked={state.showOperationTips}
                onChange={event => updateDisplayPreference('showOperationTips', event.currentTarget.checked)}
              />
              <span>{t('showOperationTips')}</span>
            </label>
          </div>
          <div className="dshAndroidLogcatFilterHelp" id="dsh-android-logcat-filter-help" role="note" aria-label={t('filterHelpTitle')} hidden={!state.showOperationTips}>
            <strong>{t('filterHelpTitle')}</strong>
            <span>{t('filterHelpBase')}</span>
            <span>{t('filterHelpAlternation')}</span>
            <span>{t('filterHelpConjunction')}</span>
            <span>{t('filterHelpExclusion')}</span>
            <span>{t('filterHelpSafety')}</span>
          </div>
          {(unavailable || state.devicesError || state.processesError || state.streamError || actionNotice) && (
            <div className="dshAndroidLogcatAlerts" aria-live="polite">
              {unavailable && <p role="status">{t('adbMissing')}{state.devicesError ? ` ${state.devicesError}` : ''}</p>}
              {!unavailable && state.devicesError && <p role="alert">{state.devicesError}</p>}
              {state.processesError && <p role="status">{t('processesUnavailable')} {state.processesError}</p>}
              {state.streamError && <p role="alert">{state.streamError}</p>}
              {actionNotice && <p role="status">{actionNotice}</p>}
            </div>
          )}
          {state.available === true && state.devices.length === 0 && !deviceLoading && !state.devicesError && (
            <p className="dshAndroidLogcatEmptyHint" role="status">{t('noDevices')}</p>
          )}
          {selectedDevice && selectedDevice.state !== 'device' && (
            <p className="dshAndroidLogcatEmptyHint" role="status">{t('deviceUnavailable')}: {deviceLabel(selectedDevice, t)}</p>
          )}
          <div className="dshAndroidLogcatLogList" ref={logListRef} role="log" aria-label={t('title')} aria-live="off" aria-relevant="additions text" onScroll={onLogListScroll}>
            {visibleEntries.length === 0
              ? <p className="dshAndroidLogcatEmptyHint">{state.streamActive ? t('empty') : t('idleHint')}</p>
              : (<>
                {windowed && (
                  <div className="dshAndroidLogcatLogRow" data-level="unknown">
                    <code>{t('windowHint').replace('{shown}', String(renderedEntries.length)).replace('{total}', String(visibleEntries.length))}</code>
                  </div>
                )}
                {renderedEntries.map(entry => (
                  <div className="dshAndroidLogcatLogRow" data-level={entry.severity ?? 'unknown'} key={entry.id}>
                    {entry.timestamp === undefined ? <code>{entry.raw}</code> : <>
                      <span className="dshAndroidLogcatTimestamp">{entry.timestamp}</span>
                      <button type="button" className="dshAndroidLogcatLogMeta" title={t('filterPid')} onClick={() => entry.pid !== undefined && togglePidExclusive(entry.pid)}>{entry.pid ?? '—'}/{entry.tid ?? '—'}</button>
                      <span className="dshAndroidLogcatLevel" data-level={entry.severity}>{entry.severity?.toUpperCase() ?? '?'}</span>
                      {entry.tag !== undefined && <button type="button" className="dshAndroidLogcatLogTag" title={t('filterTag')} onClick={() => toggleTag(entry.tag ?? '')}>{entry.tag}</button>}
                      <code className="dshAndroidLogcatMessage">{entry.message ?? entry.raw}</code>
                    </>}
                  </div>
                ))}
              </>)}
          </div>
          <footer className="dshAndroidLogcatFooter">
            <span>{visibleEntries.length} {t('entries')}</span>
            {state.paused && <span>{t('paused')}</span>}
          </footer>
        </>
      )}
    </section>
    {screenshotUrl !== null && createPortal(
      <div className="dshAndroidLogcatScreenshotBackdrop" role="dialog" aria-modal="true" aria-label={t('screenshotPreview')}>
        <section className="dshAndroidLogcatScreenshotDialog">
          <header><strong>{t('screenshotPreview')}</strong><button type="button" className="dshAndroidLogcatIconButton" aria-label={t('closeScreenshot')} onClick={closeScreenshot}>×</button></header>
          <img src={screenshotUrl} alt={t('screenshotPreview')} />
          {screenshotCopyNotice && <p role="status" aria-live="polite">{screenshotCopyNotice}</p>}
          <footer>
            <button type="button" className="dshAndroidLogcatButton" onClick={() => void copyScreenshot()} disabled={screenshotBlob === null}>{t('copyScreenshot')}</button>
            <a className="dshAndroidLogcatButton" href={screenshotUrl} download={`android-screenshot-${new Date().toISOString().replaceAll(':', '-')}.png`}>{t('saveScreenshot')}</a>
            <button type="button" className="dshAndroidLogcatButton" onClick={closeScreenshot}>{t('closeScreenshot')}</button>
          </footer>
        </section>
      </div>,
      document.body,
    )}
    </>
  )
}

function deviceLabel(device: AndroidLogcatDevice, t: AndroidLogcatDrawerProps['t']): string {
  const status = device.state === 'device' ? t('connected')
    : device.state === 'unauthorized' ? t('unauthorized')
      : t('offline')
  return `${device.model ? `${device.model} · ` : ''}${device.serial} — ${status}`
}

interface MultiSelectFilterProps {
  readonly label: string
  readonly allLabel: string
  readonly selected: readonly string[]
  readonly options: readonly { readonly value: string; readonly label: string }[]
  readonly disabled?: boolean
  readonly onChange: (selected: string[]) => void
}

function MultiSelectFilter({ label, allLabel, selected, options, disabled = false, onChange }: MultiSelectFilterProps) {
  return (
    <details className="dshAndroidLogcatMultiFilter" data-disabled={disabled || undefined}>
      <summary aria-label={label} aria-disabled={disabled}>
        {label} · {selected.length === 0 ? allLabel : selected.length}
      </summary>
      <div className="dshAndroidLogcatMultiFilterMenu" role="group" aria-label={label}>
        <label><input type="checkbox" checked={selected.length === 0} disabled={disabled} onChange={() => onChange([])} />{allLabel}</label>
        {options.map(option => (
          <label key={option.value}>
            <input
              type="checkbox"
              checked={selected.includes(option.value)}
              disabled={disabled}
              onChange={() => onChange(toggleSelection(selected, option.value))}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </details>
  )
}

function toggleSelection<Value extends string | number>(values: readonly Value[], value: Value): Value[] {
  return values.includes(value) ? values.filter(candidate => candidate !== value) : [...values, value]
}
