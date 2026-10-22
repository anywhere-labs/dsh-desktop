import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  SubprocessExecutableNotFoundError,
  type SubprocessHandle,
  type SubprocessRuntime,
  type SubprocessSpawnSpec,
} from '@deepseek-ai/dsh-subprocess'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import { describe, expect, it, vi } from 'vitest'
import {
  ANDROID_LOGCAT_DEVICES_PATH,
  ANDROID_LOGCAT_PROCESSES_PATH,
  ANDROID_LOGCAT_SCREENSHOT_PATH,
  ANDROID_LOGCAT_STREAM_PATH,
} from '../src/android-logcat-contract.ts'
import { apply, inject, name, parseAndroidLogcatDevices, parseAndroidLogcatProcesses } from '../src/android-logcat.ts'

function child(stdout: string, stderr = '', exitCode: number | null = 0): SubprocessHandle {
  return {
    stdin: undefined,
    stdout: undefined,
    stderr: undefined,
    control: undefined,
    collected: {
      stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
      stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
    },
    done: Promise.resolve({ exitCode, signal: null }),
    terminate: vi.fn(),
    waitForExit: vi.fn(async () => true),
  }
}

function binaryChild(stdoutBytes: Buffer, exitCode: number | null = 0): SubprocessHandle {
  const stdout = new PassThrough()
  queueMicrotask(() => stdout.end(stdoutBytes))
  return { ...child(''), stdout, done: Promise.resolve({ exitCode, signal: null }) }
}

function request(url: string): IncomingMessage {
  return Object.assign(new EventEmitter(), {
    method: 'GET', url, headers: { host: '127.0.0.1:43120', origin: 'http://127.0.0.1:43120' },
    socket: { remoteAddress: '127.0.0.1' },
  }) as unknown as IncomingMessage
}

function response(): ServerResponse & {
  body: string
  binaryBody: Buffer | undefined
  headers: Map<string, string>
  writeResult: boolean
  onWrite?: () => void
} {
  const emitter = new EventEmitter()
  const value = Object.assign(emitter, {
    statusCode: 200,
    headersSent: false,
    writableEnded: false,
    destroyed: false,
    body: '',
    binaryBody: undefined as Buffer | undefined,
    headers: new Map<string, string>(),
    writeResult: true,
    onWrite: undefined as (() => void) | undefined,
    setHeader(name: string, header: string) { this.headers.set(name, header) },
    writeHead(status: number, values: Record<string, string> = {}) {
      this.statusCode = status
      this.headersSent = true
      for (const [name, value] of Object.entries(values)) this.headers.set(name, value)
    },
    flushHeaders() { this.headersSent = true },
    write(body: string | Uint8Array) {
      this.body += String(body)
      this.onWrite?.()
      return this.writeResult
    },
    end(body: string | Uint8Array = '') {
      if (typeof body === 'string') this.body += body
      else this.binaryBody = Buffer.from(body)
      this.writableEnded = true
      emitter.emit('close')
    },
  })
  return value as unknown as ServerResponse & {
    body: string
    binaryBody: Buffer | undefined
    headers: Map<string, string>
    writeResult: boolean
    onWrite?: () => void
  }
}

async function harness(children: SubprocessHandle[], rejection?: 401 | 403) {
  const routes = new Map<string, WebRoute>()
  const requestRejection = vi.fn((_req: IncomingMessage) => rejection)
  const spawn = vi.fn((spec: SubprocessSpawnSpec) => {
    const next = children.shift()
    if (next === undefined) throw new Error(`unexpected adb spawn: ${spec.argv.join(' ')}`)
    return next
  })
  let cleanup: void | (() => void | Promise<void>)
  const ctx = {
    webServer: {
      register: (route: WebRoute) => {
        routes.set(route.path, route)
        return () => { routes.delete(route.path) }
      },
    },
    connection: { requestRejection },
    subprocess: {
      resolveExecutable: vi.fn(async () => '/fixture/platform-tools/adb'),
      spawn,
    },
    effect: (register: () => void | (() => void | Promise<void>)) => { cleanup = register() },
  } as unknown as Context
  apply(ctx)
  return {
    routes,
    requestRejection,
    spawn,
    subprocess: ctx.subprocess as SubprocessRuntime,
    teardown: async () => {
      if (typeof cleanup === 'function') await cleanup()
    },
  }
}

describe('Android Logcat Host plugin', () => {
  it('registers authenticated read-only routes and declares the subprocess dependency', async () => {
    const h = await harness([])
    expect(name).toBe('desktop-android-logcat')
    expect(inject).toEqual(['webServer', 'connection', 'subprocess'])
    expect([...h.routes.keys()]).toEqual([
      ANDROID_LOGCAT_DEVICES_PATH,
      ANDROID_LOGCAT_PROCESSES_PATH,
      ANDROID_LOGCAT_STREAM_PATH,
      ANDROID_LOGCAT_SCREENSHOT_PATH,
    ])
  })

  it('parses connected, unauthorized, and offline devices without losing status details', () => {
    expect(parseAndroidLogcatDevices([
      'List of devices attached',
      'emulator-5554 device product:sdk_gphone64_x86_64 model:Pixel_8 transport_id:1',
      'R58M unauthorized usb:1-2',
      '192.168.1.2:5555 offline',
      '',
    ].join('\n'))).toEqual([
      { serial: 'emulator-5554', state: 'device', model: 'Pixel 8' },
      { serial: 'R58M', state: 'unauthorized' },
      { serial: '192.168.1.2:5555', state: 'offline' },
    ])
  })

  it('parses process rows, ignores headers, and de-duplicates PIDs', () => {
    expect(parseAndroidLogcatProcesses('PID NAME\n101 com.example.app\n102 com.example.app:worker\n102 stale-name\nnope invalid'))
      .toEqual([
        { pid: 101, name: 'com.example.app' },
        { pid: 102, name: 'com.example.app:worker' },
      ])
  })

  it('returns adb availability and device state from the authenticated route', async () => {
    const h = await harness([child('List of devices attached\nemulator-5554 device model:Pixel_8\nR58M unauthorized\n')])
    const req = request(ANDROID_LOGCAT_DEVICES_PATH)
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_DEVICES_PATH)!.handler(req, res)
    expect(h.requestRejection).toHaveBeenCalledWith(req)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toEqual({
      available: true,
      devices: [
        { serial: 'emulator-5554', state: 'device', model: 'Pixel 8' },
        { serial: 'R58M', state: 'unauthorized' },
      ],
    })
    expect(h.spawn.mock.calls[0]![0].argv).toEqual(['/fixture/platform-tools/adb', 'devices', '-l'])
  })

  it('explains a missing adb executable without exposing an implementation error', async () => {
    const h = await harness([])
    vi.mocked(h.subprocess.resolveExecutable).mockRejectedValue(new SubprocessExecutableNotFoundError('not found'))
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_DEVICES_PATH)!.handler(request(ANDROID_LOGCAT_DEVICES_PATH), res)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body)).toMatchObject({
      available: false,
      error: expect.stringContaining('Install Android platform-tools'),
      devices: [],
    })
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('rejects unauthorized browser requests before spawning adb', async () => {
    const h = await harness([], 403)
    const req = request(ANDROID_LOGCAT_DEVICES_PATH)
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_DEVICES_PATH)!.handler(req, res)
    expect(h.requestRejection).toHaveBeenCalledWith(req)
    expect(res.statusCode).toBe(403)
    expect(res.body).toBe('forbidden')
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('validates the serial and uses fixed argv for process enumeration', async () => {
    const h = await harness([
      child('List of devices attached\nemulator-5554 device\n'),
      child('PID NAME\n101 com.example.app\n'),
    ])
    const bad = response()
    await h.routes.get(ANDROID_LOGCAT_PROCESSES_PATH)!.handler(
      request(`${ANDROID_LOGCAT_PROCESSES_PATH}?serial=emulator-5554%3Btouch%20/tmp/pwned`),
      bad,
    )
    expect(bad.statusCode).toBe(400)
    expect(h.spawn).not.toHaveBeenCalled()

    const good = response()
    await h.routes.get(ANDROID_LOGCAT_PROCESSES_PATH)!.handler(
      request(`${ANDROID_LOGCAT_PROCESSES_PATH}?serial=emulator-5554`),
      good,
    )
    expect(JSON.parse(good.body)).toEqual({ processes: [{ pid: 101, name: 'com.example.app' }] })
    expect(h.spawn.mock.calls.map(([spec]) => spec.argv)).toEqual([
      ['/fixture/platform-tools/adb', 'devices', '-l'],
      ['/fixture/platform-tools/adb', '-s', 'emulator-5554', 'shell', 'ps', '-A', '-o', 'PID,NAME'],
    ])
  })

  it('captures a ready device screenshot as bounded PNG bytes using fixed adb argv', async () => {
    const png = Buffer.from('89504e470d0a1a0a01020304', 'hex')
    const screenshot = binaryChild(png)
    const h = await harness([
      child('List of devices attached\nemulator-5554 device\n'),
      screenshot,
    ])
    const req = request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`)
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(req, res)

    expect(h.requestRejection).toHaveBeenCalledWith(req)
    expect(h.spawn.mock.calls.map(([spec]) => spec.argv)).toEqual([
      ['/fixture/platform-tools/adb', 'devices', '-l'],
      ['/fixture/platform-tools/adb', '-s', 'emulator-5554', 'exec-out', 'screencap', '-p'],
    ])
    expect(res.statusCode).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/png')
    expect(res.headers.get('content-length')).toBe(String(png.byteLength))
    expect(res.binaryBody).toEqual(png)
    expect(screenshot.terminate).toHaveBeenCalledOnce()
    expect(screenshot.waitForExit).toHaveBeenCalled()
  })

  it('rejects screenshots when the selected device is unauthorized or offline', async () => {
    const h = await harness([child('List of devices attached\nemulator-5554 unauthorized\n')])
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(
      request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`),
      res,
    )
    expect(res.statusCode).toBe(409)
    expect(JSON.parse(res.body)).toMatchObject({ code: 'device-not-ready' })
    expect(h.spawn).toHaveBeenCalledOnce()
  })

  it('accepts screenshot output exactly at the 16 MiB per-request cap', async () => {
    const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(16 * 1024 * 1024 - 8)])
    const screenshot = binaryChild(png)
    const h = await harness([child('List of devices attached\nemulator-5554 device\n'), screenshot])
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(
      request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`),
      res,
    )
    expect(res.statusCode).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(16 * 1024 * 1024))
    expect(res.binaryBody?.byteLength).toBe(16 * 1024 * 1024)
  })

  it('returns JSON errors for invalid or oversized screenshot output and cleans up adb', async () => {
    const invalid = binaryChild(Buffer.from('adb error text'))
    const invalidHarness = await harness([
      child('List of devices attached\nemulator-5554 device\n'),
      invalid,
    ])
    const invalidResponse = response()
    await invalidHarness.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(
      request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`),
      invalidResponse,
    )
    expect(invalidResponse.statusCode).toBe(502)
    expect(JSON.parse(invalidResponse.body)).toMatchObject({ code: 'invalid-screenshot' })
    expect(invalid.terminate).toHaveBeenCalledOnce()
    expect(invalid.waitForExit).toHaveBeenCalled()

    const oversized = binaryChild(Buffer.concat([
      Buffer.from('89504e470d0a1a0a', 'hex'),
      Buffer.alloc(16 * 1024 * 1024),
    ]))
    const oversizedHarness = await harness([
      child('List of devices attached\nemulator-5554 device\n'),
      oversized,
    ])
    const oversizedResponse = response()
    await oversizedHarness.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(
      request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`),
      oversizedResponse,
    )
    expect(oversizedResponse.statusCode).toBe(502)
    expect(JSON.parse(oversizedResponse.body)).toMatchObject({ code: 'screenshot-too-large' })
    expect(oversized.terminate).toHaveBeenCalled()
    expect(oversized.waitForExit).toHaveBeenCalled()
  })

  it('rejects unauthorized screenshot requests before spawning adb', async () => {
    const h = await harness([], 401)
    const req = request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`)
    const res = response()
    await h.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(req, res)
    expect(h.requestRejection).toHaveBeenCalledWith(req)
    expect(res.statusCode).toBe(401)
    expect(res.body).toBe('unauthorized')
    expect(h.spawn).not.toHaveBeenCalled()
  })

  it('cancels and awaits screenshot adb when the HTTP request is aborted', async () => {
    const stdout = new PassThrough()
    let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
    const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
    const screenshot = { ...child(''), stdout, done }
    const h = await harness([child('List of devices attached\nemulator-5554 device\n'), screenshot])
    let announceStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    const originalSpawn = h.spawn.getMockImplementation()
    if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
    h.spawn.mockImplementation(spec => {
      const handle = originalSpawn(spec)
      if (spec.argv.includes('screencap')) announceStarted()
      return handle
    })

    const req = request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`)
    const res = response()
    const capture = h.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(req, res)
    await started
    req.emit('aborted')
    res.destroyed = true
    stdout.end(Buffer.from('89504e470d0a1a0a01020304', 'hex'))
    finish({ exitCode: 0, signal: null })
    await capture

    const screenshotSpec = h.spawn.mock.calls.find(([spec]) => spec.argv.includes('screencap'))?.[0]
    expect(screenshotSpec?.signal?.aborted).toBe(true)
    expect(screenshot.terminate).toHaveBeenCalled()
    expect(screenshot.waitForExit).toHaveBeenCalled()
  })

  it('terminates and awaits screenshot adb during plugin teardown', async () => {
    const stdout = new PassThrough()
    let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
    const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
    const screenshot = { ...child(''), stdout, done }
    const h = await harness([
      child('List of devices attached\nemulator-5554 device\n'),
      screenshot,
    ])
    let announceStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    const originalSpawn = h.spawn.getMockImplementation()
    if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
    h.spawn.mockImplementation(spec => {
      const handle = originalSpawn(spec)
      if (spec.argv.includes('screencap')) announceStarted()
      return handle
    })

    const capture = h.routes.get(ANDROID_LOGCAT_SCREENSHOT_PATH)!.handler(
      request(`${ANDROID_LOGCAT_SCREENSHOT_PATH}?serial=emulator-5554`),
      response(),
    )
    await started
    const teardown = h.teardown()
    stdout.end(Buffer.from('89504e470d0a1a0a01020304', 'hex'))
    finish({ exitCode: 0, signal: null })
    await Promise.all([capture, teardown])

    expect(screenshot.terminate).toHaveBeenCalled()
    expect(screenshot.waitForExit).toHaveBeenCalled()
  })

  it('streams adb logcat lines as SSE and waits for the process to exit', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
    const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
    const logcat = { ...child(''), stdout, stderr, done }
    const h = await harness([child('List of devices attached\nemulator-5554 device\n'), logcat])
    let announceStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    const originalSpawn = h.spawn.getMockImplementation()
    if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
    h.spawn.mockImplementation(spec => {
      const handle = originalSpawn(spec)
      if (spec.argv.includes('logcat')) announceStarted()
      return handle
    })

    const res = response()
    const streaming = h.routes.get(ANDROID_LOGCAT_STREAM_PATH)!.handler(
      request(`${ANDROID_LOGCAT_STREAM_PATH}?serial=emulator-5554`),
      res,
    )
    await started
    stdout.end('06-27 10:00:00.000  101  101 I Example: ready\n')
    stderr.end()
    finish({ exitCode: 0, signal: null })
    await streaming

    expect(res.statusCode).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(res.body).toContain('event: message\ndata: "06-27 10:00:00.000  101  101 I Example: ready"\n\n')
    expect(h.spawn.mock.calls.map(([spec]) => spec.argv)).toEqual([
      ['/fixture/platform-tools/adb', 'devices', '-l'],
      ['/fixture/platform-tools/adb', '-s', 'emulator-5554', 'logcat', '-v', 'threadtime'],
    ])
    expect(logcat.terminate).toHaveBeenCalledOnce()
    expect(logcat.waitForExit).toHaveBeenCalled()
  })

  it('resumes the logcat stream with -T when a valid since marker is provided', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
    const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
    const logcat = { ...child(''), stdout, stderr, done }
    const h = await harness([child('List of devices attached\nemulator-5554 device\n'), logcat])
    let announceStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    const originalSpawn = h.spawn.getMockImplementation()
    if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
    h.spawn.mockImplementation(spec => {
      const handle = originalSpawn(spec)
      if (spec.argv.includes('logcat')) announceStarted()
      return handle
    })

    const res = response()
    const streaming = h.routes.get(ANDROID_LOGCAT_STREAM_PATH)!.handler(
      request(`${ANDROID_LOGCAT_STREAM_PATH}?serial=emulator-5554&since=${encodeURIComponent('2026-06-27 10:00:00.000')}`),
      res,
    )
    await started
    stdout.end('06-27 10:00:01.000  101  101 I Example: resumed\n')
    stderr.end()
    finish({ exitCode: 0, signal: null })
    await streaming

    expect(h.spawn.mock.calls.map(([spec]) => spec.argv)).toEqual([
      ['/fixture/platform-tools/adb', 'devices', '-l'],
      ['/fixture/platform-tools/adb', '-s', 'emulator-5554', 'logcat', '-v', 'threadtime', '-T', '06-27 10:00:00.000'],
    ])
  })

  it('ignores an invalid since parameter so reconnect loops stay alive', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
    const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
    const logcat = { ...child(''), stdout, stderr, done }
    const h = await harness([child('List of devices attached\nemulator-5554 device\n'), logcat])
    let announceStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    const originalSpawn = h.spawn.getMockImplementation()
    if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
    h.spawn.mockImplementation(spec => {
      const handle = originalSpawn(spec)
      if (spec.argv.includes('logcat')) announceStarted()
      return handle
    })

    const res = response()
    const streaming = h.routes.get(ANDROID_LOGCAT_STREAM_PATH)!.handler(
      request(`${ANDROID_LOGCAT_STREAM_PATH}?serial=emulator-5554&since=not-a-time`),
      res,
    )
    await started
    stdout.end('06-27 10:00:01.000  101  101 I Example: full buffer\n')
    stderr.end()
    finish({ exitCode: 0, signal: null })
    await streaming

    expect(h.spawn.mock.calls.map(([spec]) => spec.argv)).toEqual([
      ['/fixture/platform-tools/adb', 'devices', '-l'],
      ['/fixture/platform-tools/adb', '-s', 'emulator-5554', 'logcat', '-v', 'threadtime'],
    ])
  })

  it('keeps an idle SSE connection alive with periodic comments', async () => {
    vi.useFakeTimers()
    try {
      const stdout = new PassThrough()
      const stderr = new PassThrough()
      let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
      const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
      const logcat = { ...child(''), stdout, stderr, done }
      const h = await harness([child('List of devices attached\nemulator-5554 device\n'), logcat])
      let announceStarted: () => void = () => {}
      const started = new Promise<void>(resolve => { announceStarted = resolve })
      const originalSpawn = h.spawn.getMockImplementation()
      if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
      h.spawn.mockImplementation(spec => {
        const handle = originalSpawn(spec)
        if (spec.argv.includes('logcat')) announceStarted()
        return handle
      })
      const res = response()
      const streaming = h.routes.get(ANDROID_LOGCAT_STREAM_PATH)!.handler(
        request(`${ANDROID_LOGCAT_STREAM_PATH}?serial=emulator-5554`), res,
      )
      await started
      await vi.advanceTimersByTimeAsync(15_000)
      expect(res.body).toContain(': keep-alive\n\n')

      const teardown = h.teardown()
      stdout.end()
      stderr.end()
      finish({ exitCode: 0, signal: null })
      await Promise.all([streaming, teardown])
    } finally {
      vi.useRealTimers()
    }
  })

  it('releases a blocked SSE write when plugin teardown aborts the stream', async () => {
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    let finish: (outcome: Awaited<SubprocessHandle['done']>) => void = () => {}
    const done = new Promise<Awaited<SubprocessHandle['done']>>(resolve => { finish = resolve })
    const logcat = { ...child(''), stdout, stderr, done }
    const h = await harness([child('List of devices attached\nemulator-5554 device\n'), logcat])
    let announceStarted: () => void = () => {}
    const started = new Promise<void>(resolve => { announceStarted = resolve })
    const originalSpawn = h.spawn.getMockImplementation()
    if (originalSpawn === undefined) throw new Error('missing subprocess fixture')
    h.spawn.mockImplementation(spec => {
      const handle = originalSpawn(spec)
      if (spec.argv.includes('logcat')) announceStarted()
      return handle
    })
    const res = response()
    res.writeResult = false
    let announceWrite: () => void = () => {}
    const blockedWrite = new Promise<void>(resolve => { announceWrite = resolve })
    res.onWrite = announceWrite
    const streaming = h.routes.get(ANDROID_LOGCAT_STREAM_PATH)!.handler(
      request(`${ANDROID_LOGCAT_STREAM_PATH}?serial=emulator-5554`),
      res,
    )
    await started
    stdout.write('06-27 10:00:00.000  101  101 I Example: blocked\n')
    await blockedWrite

    const teardown = h.teardown()
    stdout.end()
    stderr.end()
    finish({ exitCode: 0, signal: null })
    await Promise.all([streaming, teardown])

    expect(res.writableEnded).toBe(true)
    expect(logcat.terminate).toHaveBeenCalled()
    expect(logcat.waitForExit).toHaveBeenCalled()
  })
})
