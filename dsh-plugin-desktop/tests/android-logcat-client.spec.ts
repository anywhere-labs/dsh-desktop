import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AndroidLogcatDrawer, type AndroidLogcatDrawerProps } from '../src/client/AndroidLogcatDrawer.tsx'
import { androidLogcatEn } from '../src/client/android-logcat-locales.ts'
import {
  ANDROID_LOGCAT_MAX_ENTRIES,
  AndroidLogcatApiError,
  captureAndroidLogcatScreenshot,
  copyAndroidLogcatScreenshotToClipboard,
  compileAndroidLogcatPattern,
  compileAndroidLogcatQuery,
  filterAndroidLogcatEntries,
  makeAndroidLogcatEntry,
  normalizeAndroidLogcatSince,
  parseAndroidLogcatLine,
  parseAndroidLogcatSseFrame,
  readAndroidLogcatDevices,
  readAndroidLogcatProcesses,
  streamAndroidLogcat,
  streamAndroidLogcatWithReconnect,
} from '../src/client/android-logcat-api.ts'
import { createAndroidLogcatStore } from '../src/client/android-logcat-store.ts'
import {
  cancelAndroidLogcatLogWrite,
  clearAndroidLogcatEntries,
  flushAndroidLogcatLogWrites,
  readAndroidLogcatEntries,
  scheduleAndroidLogcatLogWrite,
  writeAndroidLogcatEntries,
} from '../src/client/android-logcat-log-persistence.ts'
import { writeAndroidLogcatDisplayPreferences } from '../src/client/android-logcat-preferences.ts'
import { installAndroidLogcatStyles } from '../src/client/android-logcat-styles.ts'

// The package's runtime store adapter pulls in optional zustand here; this test
// exercises the pure store actions without installing or changing dependencies.
vi.mock('@deepseek-ai/dsh-client-store', () => ({
  defineStore: (spec: { init: () => unknown; actions: Record<string, unknown> }) => ({
    create: () => {
      let state: unknown = spec.init()
      const actions = Object.fromEntries(Object.entries(spec.actions).map(([name, action]) => [name, (...args: unknown[]) => {
        const draft = structuredClone(state)
        ;(action as (draft: unknown, ...args: unknown[]) => void)(draft, ...args)
        state = draft
      }]))
      return { actions, getSnapshot: () => state }
    },
  }),
}))

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Android Logcat overlay styles', () => {
  it('anchors to the shell overlay bottom and uses theme-aware opaque surfaces and text', () => {
    const style = { id: '', dataset: {} as Record<string, string>, textContent: '', remove: vi.fn() }
    const appendChild = vi.fn()
    vi.stubGlobal('document', {
      getElementById: () => null,
      createElement: () => style,
      head: { appendChild },
    })

    try {
      const dispose = installAndroidLogcatStyles('dsh-plugin-desktop')
      expect(style.dataset).toMatchObject({ plugin: 'dsh-plugin-desktop', pluginCss: 'dsh-plugin-desktop/android-logcat' })
      expect(style.textContent).toMatch(/\.dshAndroidLogcatDrawer \{[^}]*position: absolute;[^}]*right: 0;[^}]*bottom: 0;[^}]*left: 0;/)
      expect(style.textContent).toContain('max-height: calc(100% - 8px);')
      expect(style.textContent).toContain('background: var(--dsh-android-logcat-bg-layer-1);')
      expect(style.textContent).toContain('background: var(--dsh-android-logcat-bg-layer-2);')
      expect(style.textContent).toContain('color: var(--dsw-alias-label-primary);')
      expect(style.textContent).toContain('color: var(--dsw-alias-label-secondary);')
      expect(style.textContent).toContain('color: var(--dsw-alias-link);')
      expect(style.textContent).toContain('color: var(--dsw-alias-label-tertiary);')
      expect(style.textContent).toContain('color: var(--dsw-alias-state-warn-primary)')
      expect(style.textContent).toContain('background: var(--dsw-alias-bg-mask-photo);')
      expect(style.textContent).not.toMatch(/#[\da-f]{3,8}\b/iu)
      expect(style.textContent).toContain('align-self: flex-start;')
      expect(style.textContent).toContain('justify-content: flex-start;')
      expect(style.textContent).toContain('margin-inline-start: 0;')
      expect(style.textContent).toContain('padding-inline: 0;')
      expect(style.textContent).toContain('width: max-content;')
       expect(style.textContent).toContain('flex-wrap: wrap;')
       expect(style.textContent).toContain('overflow-wrap: anywhere;')
       expect(style.textContent).toContain('--dsh-android-logcat-ui-font-size')
       expect(style.textContent).toContain('--dsh-android-logcat-log-font-size')
      expect(style.textContent).toContain('font: var(--dsh-android-logcat-ui-font-size, 12px)/1.45')
      expect(style.textContent).toContain('font: var(--dsh-android-logcat-log-font-size, 12px)/1.55')
      expect(style.textContent).toContain('.dshAndroidLogcatLogRow code { min-width: 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }')
      expect(style.textContent).toContain('.dshAndroidLogcatMessage { flex: 1 1 240px; min-width: 0; color: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }')
      expect(appendChild).toHaveBeenCalledWith(style)
      dispose()
      expect(style.remove).toHaveBeenCalledOnce()
    } finally {
      vi.unstubAllGlobals()
    }
  })
})

describe('Android Logcat filter UI', () => {
  it('renders separate include/exclude Tag, Process, and Message regex fields with no regex toggle', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.open()
    const snapshot = store.getSnapshot()
    const useStore = <Selected,>(selector: (state: typeof snapshot) => Selected) => selector(snapshot)
    const props = {
      useStore,
      actions: store.actions,
      t: (key: keyof typeof androidLogcatEn) => androidLogcatEn[key],
    } as unknown as AndroidLogcatDrawerProps
    const markup = renderToStaticMarkup(createElement(AndroidLogcatDrawer, props))

    expect(markup).toContain('aria-label="Tag regex"')
    expect(markup).toContain('aria-label="Exclude Tag regex"')
    expect(markup).toContain('aria-label="Process regex"')
    expect(markup).toContain('aria-label="Message regex"')
    expect(markup).toContain('aria-label="UI font size"')
    expect(markup).toContain('aria-label="Log text size"')
    expect(markup).toContain('aria-label="Show operation tips"')
    expect(markup).toContain('id="dsh-android-logcat-filter-help"')
    expect(markup).not.toContain('id="dsh-android-logcat-filter-help" role="note" aria-label="Regex filter guide" hidden=""')
    expect(markup).toContain('value="native|osagent|claw|frame"')
    expect(markup).toContain('value="WebSocketClient|OSAgent\\.TTS|OSAgent\\.TaskCenter"')
    expect(markup).toContain('Example: ^(ActivityManager|WindowManager)$')
    expect(markup).toContain('(?=.*error)(?=.*timeout)')
    expect(markup).not.toContain('dshAndroidLogcatRegexToggle')
  })
})

describe('Android Logcat Client API', () => {
  it('uses the exact same-origin device and process endpoints', async () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ available: true, devices: [{ serial: 'usb 1', state: 'device' }] })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ processes: [{ pid: 7, name: 'com.example.app' }] })))
      .mockResolvedValueOnce(new Response(png, { headers: { 'content-type': 'image/png' } }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(readAndroidLogcatDevices()).resolves.toMatchObject({ available: true })
    await expect(readAndroidLogcatProcesses('usb 1')).resolves.toMatchObject({ processes: [{ pid: 7 }] })
    await expect(captureAndroidLogcatScreenshot('usb 1')).resolves.toBeInstanceOf(Blob)
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/desktop/android-logcat/devices')
    expect(fetchMock.mock.calls[1]?.[0]).toBe('/api/desktop/android-logcat/processes?serial=usb+1')
    expect(fetchMock.mock.calls[2]?.[0]).toBe('/api/desktop/android-logcat/screenshot?serial=usb+1')
  })

  it('decodes JSON-wrapped log lines and Host error events', () => {
    expect(parseAndroidLogcatSseFrame('data: "hello\\nworld"')).toEqual({ kind: 'log', line: 'hello\nworld' })
    expect(parseAndroidLogcatSseFrame('event: error\ndata: {"error":"device disconnected"}'))
      .toEqual({ kind: 'error', error: 'device disconnected' })
  })

  it('reads SSE frames across chunk boundaries and rejects Host error events', async () => {
    const encoder = new TextEncoder()
    const source = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: "first line"\n\ndata: "second'))
        controller.enqueue(encoder.encode(' line"\n\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(source, {
      headers: { 'content-type': 'text/event-stream' },
    })))
    const lines: string[] = []
    await streamAndroidLogcat('emulator-5554', new AbortController().signal, line => lines.push(line))
    expect(lines).toEqual(['first line', 'second line'])

    const errorSource = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('event: error\ndata: {"error":"adb exited"}\n\n'))
        controller.close()
      },
    })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(errorSource)))
    await expect(streamAndroidLogcat('emulator-5554', new AbortController().signal, () => {}))
      .rejects.toEqual(expect.objectContaining<Partial<AndroidLogcatApiError>>({ message: 'adb exited' }))
  })

  it('retries transient HTTP failures with backoff but stops on terminal requests', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'temporarily unavailable' }), { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'invalid device' }), { status: 400 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    let announceReconnect: () => void = () => {}
    const reconnecting = new Promise<void>(resolve => { announceReconnect = resolve })
    const stream = streamAndroidLogcatWithReconnect('device-1', controller.signal, () => {}, undefined, announceReconnect)

    await reconnecting
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const rejected = expect(stream).rejects.toMatchObject({ status: 400, message: 'invalid device' })
    await vi.advanceTimersByTimeAsync(500)
    await rejected
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('serial=device-1')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('serial=device-1')
  })

  it('cancels the reconnect delay when the user stops streaming', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    let announceReconnect: () => void = () => {}
    const reconnecting = new Promise<void>(resolve => { announceReconnect = resolve })
    const stream = streamAndroidLogcatWithReconnect('device-1', controller.signal, () => {}, undefined, announceReconnect)
    await reconnecting
    controller.abort()
    await expect(stream).resolves.toBeUndefined()
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('passes the since marker to the stream endpoint and normalizes timestamps', async () => {
    const source = new ReadableStream<Uint8Array>({ start(controller) { controller.close() } })
    const fetchMock = vi.fn().mockResolvedValue(new Response(source))
    vi.stubGlobal('fetch', fetchMock)
    await streamAndroidLogcat('emulator-5554', new AbortController().signal, () => {}, undefined, '06-14 17:02:33.123')
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toBe('/api/desktop/android-logcat/stream?serial=emulator-5554&since=06-14+17%3A02%3A33.123')
    expect(normalizeAndroidLogcatSince('2026-06-14 17:02:33.123')).toBe('06-14 17:02:33.123')
    expect(normalizeAndroidLogcatSince('06-14 17:02:33.123')).toBe('06-14 17:02:33.123')
    expect(normalizeAndroidLogcatSince('not a timestamp')).toBeUndefined()
  })

  it('reads the since marker anew on every reconnect attempt', async () => {
    vi.useFakeTimers()
    const fetchMock = vi.fn().mockResolvedValue(new Response('unavailable', { status: 502 }))
    vi.stubGlobal('fetch', fetchMock)
    const controller = new AbortController()
    let marker: string | undefined
    let announceReconnect: () => void = () => {}
    const reconnecting = new Promise<void>(resolve => { announceReconnect = resolve })
    const stream = streamAndroidLogcatWithReconnect('device-1', controller.signal, () => {}, undefined, announceReconnect, () => marker)
    await reconnecting
    marker = '06-14 17:02:33.123'
    await vi.advanceTimersByTimeAsync(500)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('since=')
    expect(String(fetchMock.mock.calls[1]?.[0])).toContain('since=06-14')
    controller.abort()
    await expect(stream).resolves.toBeUndefined()
  })

  it('parses threadtime columns and applies process, tag, level, and text filters', () => {
    const error = '06-14 17:02:33.123 123 456 E AndroidRuntime: FATAL EXCEPTION'
    const warning = '06-14 17:02:34.123 456 789 W ActivityTask: slow launch'
    expect(parseAndroidLogcatLine(error)).toEqual({
      timestamp: '06-14 17:02:33.123', pid: 123, tid: 456, severity: 'error', tag: 'AndroidRuntime', message: 'FATAL EXCEPTION',
    })
    const entries = [makeAndroidLogcatEntry(error, 1), makeAndroidLogcatEntry(warning, 2)]
    const processes = [{ pid: 123, name: 'com.example.app' }, { pid: 456, name: 'system_server' }]
    expect(filterAndroidLogcatEntries(entries, [123], ['AndroidRuntime'], ['error'], {
      tag: '^AndroidRuntime$', excludeTag: '', process: '^com\\.example\\.app$', message: 'fatal',
    }, processes)).toEqual([entries[0]])
    expect(filterAndroidLogcatEntries(entries, [123], [], [], {
      tag: '', excludeTag: '', process: '', message: 'missing',
    }, processes)).toEqual([])
  })

  it('supports AND, OR, exclusions, field filters, and multiple selected values', () => {
    const one = makeAndroidLogcatEntry('06-14 17:02:33.123 123 456 E AndroidRuntime: FATAL EXCEPTION', 1)
    const two = makeAndroidLogcatEntry('06-14 17:02:34.123 456 789 W ActivityTask: slow launch', 2)
    const entries = [one, two]
    const processes = [{ pid: 123, name: 'com.example.app' }, { pid: 456, name: 'system_server' }]
    expect(filterAndroidLogcatEntries(entries, [], [], [], {
      tag: 'AndroidRuntime|ActivityTask', excludeTag: '', process: 'com\\.example\\.app|system_server', message: 'FATAL|slow launch',
    }, processes)).toEqual(entries)
    expect(filterAndroidLogcatEntries(entries, [], ['AndroidRuntime', 'ActivityTask'], ['error', 'warn'], {
      tag: '', excludeTag: '', process: '', message: '^(?!.*launch).*$',
    }, processes)).toEqual([one])

    const excludedSocket = makeAndroidLogcatEntry('06-14 17:02:35.123 789 789 I WebSocketClient: connecting', 3)
    const excludedAgent = makeAndroidLogcatEntry('06-14 17:02:36.123 790 790 I OSAgent.TTS: synthesis', 4)
    expect(filterAndroidLogcatEntries([...entries, excludedSocket, excludedAgent], [], [], [], {
      tag: '', excludeTag: 'WebSocketClient|OSAgent\\.TTS|OSAgent\\.TaskCenter', process: '', message: '',
    })).toEqual(entries)
    const query = compileAndroidLogcatQuery('tag:AndroidRuntime message:"FATAL EXCEPTION"')
    expect(query.error).toBeUndefined()
    expect(query.matches(one, 'com.example.app')).toBe(true)
    expect(compileAndroidLogcatQuery('tag:').error).toBeTruthy()
    expect(compileAndroidLogcatQuery('a OR').error).toBeTruthy()
    expect(compileAndroidLogcatQuery('""').error).toContain('empty')
  })

  it('supports bounded regular expressions and rejects malformed or unsafe patterns', () => {
    const entry = makeAndroidLogcatEntry('06-14 17:02:33.123 123 456 E Example: network timeout', 1)
    expect(compileAndroidLogcatQuery('network.*time', true).matches(entry)).toBe(true)
    expect(compileAndroidLogcatQuery('(', true).error).toBe('Invalid regular expression.')
    expect(compileAndroidLogcatQuery('(a+)+$', true).error).toContain('unsafe')
    expect(compileAndroidLogcatQuery('^(a|aa)+$', true).error).toContain('unsafe')
    expect(compileAndroidLogcatQuery('x'.repeat(513)).error).toContain('512')
  })

  it('compiles default case-insensitive field regexes and rejects malformed or unsafe patterns', () => {
    expect(compileAndroidLogcatPattern('network.*time').matches('NETWORK timeout')).toBe(true)
    expect(compileAndroidLogcatPattern('^(ActivityManager|WindowManager)$').matches('WindowManager')).toBe(true)
    expect(compileAndroidLogcatPattern('(').error).toBe('Invalid regular expression.')
    expect(compileAndroidLogcatPattern('(a+)+$').error).toContain('unsafe')
    expect(compileAndroidLogcatPattern('x'.repeat(513)).error).toContain('512')
  })

  it('rejects invalid screenshot responses instead of treating them as PNG images', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('not an image', { headers: { 'content-type': 'text/plain' } })))
    await expect(captureAndroidLogcatScreenshot('emulator-5554')).rejects.toThrow('invalid PNG')
  })

  it('writes a screenshot PNG as an image clipboard item', async () => {
    let clipboardData: Record<string, Blob> | undefined
    class FakeClipboardItem {
      constructor(data: Record<string, Blob>) { clipboardData = data }
    }
    const write = vi.fn().mockResolvedValue(undefined)
    const png = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' })
    vi.stubGlobal('ClipboardItem', FakeClipboardItem)
    vi.stubGlobal('navigator', { clipboard: { write } })

    await copyAndroidLogcatScreenshotToClipboard(png)

    expect(write).toHaveBeenCalledOnce()
    expect(clipboardData).toEqual({ 'image/png': png })
  })

  it('reports when image clipboard writing is unavailable', async () => {
    vi.stubGlobal('ClipboardItem', undefined)
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn() } })
    await expect(copyAndroidLogcatScreenshotToClipboard(new Blob())).rejects.toThrow('not supported')
  })
})

describe('Android Logcat slot store', () => {
  it('bounds retained rows, freezes the paused view, and resumes into the live ring', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.appendLines(['first'])
    store.actions.pause()
    store.actions.appendLines(['later'])
    expect(store.getSnapshot().entries.map(entry => entry.raw)).toEqual(['first', 'later'])
    expect(store.getSnapshot().pausedEntries?.map(entry => entry.raw)).toEqual(['first'])
    store.actions.resume()
    expect(store.getSnapshot().pausedEntries).toBeNull()
    expect(store.getSnapshot().entries.map(entry => entry.raw)).toEqual(['first', 'later'])

    store.actions.appendLines(Array.from({ length: ANDROID_LOGCAT_MAX_ENTRIES + 1 }, (_, i) => `line-${i}`))
    expect(store.getSnapshot().entries).toHaveLength(ANDROID_LOGCAT_MAX_ENTRIES)
    expect(store.getSnapshot().entries[0]?.raw).toBe('line-1')
  })

  it('clamps resize values and stops the stream when closed or the selected device changes', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.setHeight(900)
    expect(store.getSnapshot().height).toBe(720)
    store.actions.setDevices(true, [{ serial: 'one', state: 'device' }])
    store.actions.setSelectedSerial('one')
    store.actions.start()
    store.actions.setSelectedSerial('two')
    expect(store.getSnapshot().streamActive).toBe(false)
    store.actions.start()
    store.actions.close()
    expect(store.getSnapshot().streamActive).toBe(false)
  })

  it('retains logs when switching devices or losing the selected device', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.setDevices(true, [
      { serial: 'one', state: 'device' },
      { serial: 'two', state: 'device' },
    ])
    store.actions.setSelectedSerial('one')
    store.actions.appendLines(['log from one'])
    store.actions.pause()
    store.actions.setSelectedSerial('two')
    expect(store.getSnapshot()).toMatchObject({
      selectedSerial: 'two', entries: [], pausedEntries: null, paused: false,
    })
    store.actions.appendLines(['log from two'])
    store.actions.setDevices(true, [{ serial: 'one', state: 'device' }])
    expect(store.getSnapshot()).toMatchObject({
      selectedSerial: 'two', entries: [expect.objectContaining({ raw: 'log from two' })], pausedEntries: null, paused: false,
    })
  })

  it('restores persisted log bodies and deletes them only on explicit clear', () => {
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    writeAndroidLogcatEntries('device-one', [makeAndroidLogcatEntry('persisted line', 1)], storage)
    expect(readAndroidLogcatEntries('device-one', storage).map(entry => entry.raw)).toEqual(['persisted line'])
    clearAndroidLogcatEntries('device-one', storage)
    expect(readAndroidLogcatEntries('device-one', storage)).toEqual([])
  })

  it('auto-selects the first connected device but keeps an explicit selection', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.setDevices(true, [
      { serial: 'off', state: 'offline' },
      { serial: 'one', state: 'device' },
      { serial: 'two', state: 'device' },
    ])
    expect(store.getSnapshot().selectedSerial).toBe('one')
    store.actions.setSelectedSerial('two')
    store.actions.setDevices(true, [{ serial: 'one', state: 'device' }, { serial: 'two', state: 'device' }])
    expect(store.getSnapshot().selectedSerial).toBe('two')
  })

  it('tracks the newest timestamp as since marker and drops replayed overlap', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.setDevices(true, [{ serial: 'one', state: 'device' }])
    store.actions.setSelectedSerial('one')
    store.actions.appendLines(['06-14 17:02:33.123 123 456 E AndroidRuntime: first'])
    expect(store.getSnapshot().sinceMarker).toBe('06-14 17:02:33.123')
    store.actions.appendLines([
      '06-14 17:02:33.123 123 456 E AndroidRuntime: first',
      '06-14 17:02:33.456 123 456 E AndroidRuntime: second',
    ])
    expect(store.getSnapshot().entries.map(entry => entry.raw)).toEqual([
      '06-14 17:02:33.123 123 456 E AndroidRuntime: first',
      '06-14 17:02:33.456 123 456 E AndroidRuntime: second',
    ])
    expect(store.getSnapshot().sinceMarker).toBe('06-14 17:02:33.456')
    store.actions.clear()
    expect(store.getSnapshot().entries).toEqual([])
    expect(store.getSnapshot().sinceMarker).toBe('06-14 17:02:33.456')
  })

  it('supports explicitly setting the smart-follow state from scroll tracking', () => {
    const store = createAndroidLogcatStore().create()
    expect(store.getSnapshot().autoFollow).toBe(true)
    store.actions.setAutoFollow(false)
    expect(store.getSnapshot().autoFollow).toBe(false)
    store.actions.setAutoFollow(true)
    expect(store.getSnapshot().autoFollow).toBe(true)
  })

  it('debounces log persistence writes and flushes them explicitly', () => {
    vi.useFakeTimers()
    const values = new Map<string, string>()
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    scheduleAndroidLogcatLogWrite('device-one', [makeAndroidLogcatEntry('first', 1)], storage)
    scheduleAndroidLogcatLogWrite('device-one', [makeAndroidLogcatEntry('first', 1), makeAndroidLogcatEntry('second', 2)], storage)
    expect(values.size).toBe(0)
    vi.advanceTimersByTime(1_200)
    expect(readAndroidLogcatEntries('device-one', storage).map(entry => entry.raw)).toEqual(['first', 'second'])
    scheduleAndroidLogcatLogWrite('device-one', [makeAndroidLogcatEntry('third', 3)], storage)
    flushAndroidLogcatLogWrites()
    expect(readAndroidLogcatEntries('device-one', storage).map(entry => entry.raw)).toEqual(['third'])
    scheduleAndroidLogcatLogWrite('device-one', [makeAndroidLogcatEntry('discarded', 4)], storage)
    cancelAndroidLogcatLogWrite('device-one')
    vi.advanceTimersByTime(2_400)
    expect(readAndroidLogcatEntries('device-one', storage).map(entry => entry.raw)).toEqual(['third'])
  })

  it('retains the selected serial and logs while the active stream reconnects after device loss', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.setDevices(true, [{ serial: 'device-one', state: 'device' }])
    store.actions.setSelectedSerial('device-one')
    store.actions.start()
    store.actions.appendLines(['before disconnect'])
    store.actions.setStreamReconnecting()
    store.actions.setDevices(true, [])
    expect(store.getSnapshot()).toMatchObject({
      selectedSerial: 'device-one', streamActive: true, streamReconnecting: true,
      entries: [expect.objectContaining({ raw: 'before disconnect' })],
    })
    store.actions.setStreamConnected()
    expect(store.getSnapshot().streamReconnecting).toBe(false)
  })

  it('stores multi-process, tag, level, and regex filter selections', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.setSelectedPids([10, 20, 10])
    store.actions.setSelectedTags(['Network', 'Network'])
    store.actions.setSelectedSeverities(['error', 'warn'])
    store.actions.setTagPattern('^Network$')
    store.actions.setExcludeTagPattern('^WebSocketClient$')
    store.actions.setProcessPattern('^system_server$')
    store.actions.setMessagePattern('timeout|error')
    expect(store.getSnapshot()).toMatchObject({
      selectedPids: [10, 20], selectedTags: ['Network'], selectedSeverities: ['error', 'warn'],
      tagPattern: '^Network$', excludeTagPattern: '^WebSocketClient$',
      processPattern: '^system_server$', messagePattern: 'timeout|error',
    })
    store.actions.setSelectedSerial('device-two')
    expect(store.getSnapshot()).toMatchObject({
      selectedPids: [], selectedTags: [], tagPattern: '',
      excludeTagPattern: 'WebSocketClient|OSAgent\\.TTS|OSAgent\\.TaskCenter',
      processPattern: 'native|osagent|claw|frame', messagePattern: '',
    })
  })

  it('defaults operation tips to visible and keeps UI and log font sizes independent', () => {
    const store = createAndroidLogcatStore().create()
    expect(store.getSnapshot()).toMatchObject({ uiFontSize: 12, logFontSize: 12, showOperationTips: true })
    store.actions.setUiFontSize(18)
    store.actions.setLogFontSize(20)
    store.actions.setShowOperationTips(false)
    expect(store.getSnapshot()).toMatchObject({ uiFontSize: 18, logFontSize: 20, showOperationTips: false })
  })

  it('restores saved display preferences when a fresh drawer store is created', () => {
    const values = new Map<string, string>()
    vi.stubGlobal('window', { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
    } })
    writeAndroidLogcatDisplayPreferences({ uiFontSize: 18, logFontSize: 20, showOperationTips: false })
    const store = createAndroidLogcatStore().create()
    expect(store.getSnapshot()).toMatchObject({ uiFontSize: 18, logFontSize: 20, showOperationTips: false })
  })

  it('requests one-time launcher focus restoration after closing the drawer', () => {
    const store = createAndroidLogcatStore().create()
    store.actions.open()
    store.actions.close()
    expect(store.getSnapshot().focusReturnRequested).toBe(true)
    store.actions.consumeFocusReturn()
    expect(store.getSnapshot().focusReturnRequested).toBe(false)
  })
})
