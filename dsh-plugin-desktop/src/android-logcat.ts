/** Host routes and managed adb subprocesses for the Android Logcat drawer. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { SubprocessExecutableNotFoundError, type SubprocessHandle, type SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-client-connection'
import {
  ANDROID_LOGCAT_DEVICES_PATH,
  ANDROID_LOGCAT_PROCESSES_PATH,
  ANDROID_LOGCAT_SCREENSHOT_PATH,
  ANDROID_LOGCAT_STREAM_PATH,
  type AndroidLogcatDevice,
  type AndroidLogcatProcess,
} from './android-logcat-contract.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-android-logcat'

/** Host capabilities used by the authenticated adb routes. */
export const inject = ['webServer', 'connection', 'subprocess']

const COMMAND_TIMEOUT_MS = 8_000
const TERMINATION_GRACE_MS = 1_500
const MAX_COMMAND_OUTPUT_BYTES = 512 * 1024
/** Per-request raw screenshot memory ceiling for binary adb output (16 MiB). */
const MAX_SCREENSHOT_BYTES = 16 * 1024 * 1024
const MAX_ERROR_OUTPUT_BYTES = 16 * 1024
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const MAX_STREAM_LINE_CHARS = 32 * 1024
const DEVICE_SERIAL_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/u
/** Accepted `since` query value for `adb logcat -T` (`MM-DD HH:MM:SS.mmm`, optional year). */
const STREAM_SINCE_PATTERN = /^(?:\d{4}-)?\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{1,6}$/u

/** Read the optional `since` stream parameter; invalid values are ignored so reconnect loops stay alive. */
function parseStreamSince(req: IncomingMessage): string | undefined {
  const since = parseUrl(req).searchParams.get('since')
  if (since === null || !STREAM_SINCE_PATTERN.test(since)) return undefined
  return since.replace(/^\d{4}-/u, '')
}

class AndroidLogcatError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message)
    this.name = 'AndroidLogcatError'
  }
}

interface AdbOutput {
  readonly stdout: string
  readonly stderr: string
}

interface RequestLifetime {
  readonly signal: AbortSignal
  dispose(): void
}

function json(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(value))
}

function rejectRequest(ctx: Context, req: IncomingMessage, res: ServerResponse): boolean {
  const rejection = ctx.connection.requestRejection(req)
  if (rejection === undefined) return false
  res.writeHead(rejection)
  res.end(rejection === 401 ? 'unauthorized' : 'forbidden')
  return true
}

function requestLifetime(
  req: IncomingMessage,
  res: ServerResponse,
  lifetimes: Set<AbortController>,
): RequestLifetime {
  const controller = new AbortController()
  const abort = (): void => {
    if (!res.writableEnded) controller.abort()
  }
  lifetimes.add(controller)
  req.once('aborted', abort)
  res.once('close', abort)
  return {
    signal: controller.signal,
    dispose: () => {
      req.off('aborted', abort)
      res.off('close', abort)
      lifetimes.delete(controller)
    },
  }
}

function parseUrl(req: IncomingMessage): URL {
  return new URL(req.url ?? '/', 'http://127.0.0.1')
}

function parseDeviceSerial(req: IncomingMessage): string {
  const serial = parseUrl(req).searchParams.get('serial')
  if (serial === null || !DEVICE_SERIAL_PATTERN.test(serial)) {
    throw new AndroidLogcatError('Choose a valid Android device.', 400, 'invalid-device')
  }
  return serial
}

function requireGet(req: IncomingMessage, res: ServerResponse): boolean {
  if (req.method === 'GET') return true
  res.setHeader('allow', 'GET')
  json(res, 405, { error: 'method not allowed', code: 'method-not-allowed' })
  return false
}

function sendFailure(res: ServerResponse, cause: unknown): void {
  if (res.destroyed || res.writableEnded) return
  if (cause instanceof SubprocessExecutableNotFoundError) {
    json(res, 503, { error: 'Android Debug Bridge (adb) was not found on PATH.', code: 'adb-not-found' })
    return
  }
  if (cause instanceof AndroidLogcatError) {
    json(res, cause.status, { error: cause.message, code: cause.code })
    return
  }
  json(res, 502, { error: 'The adb command failed. Check that Android platform-tools are installed and try again.', code: 'adb-failed' })
}

function safeDiagnostic(value: string): string {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, '').trim().slice(0, 1_000)
}

async function runAdb(
  ctx: Context,
  args: readonly string[],
  signal: AbortSignal,
  handles: Set<SubprocessHandle>,
): Promise<AdbOutput> {
  const timeout = AbortSignal.timeout(COMMAND_TIMEOUT_MS)
  const commandSignal = AbortSignal.any([signal, timeout])
  let handle: SubprocessHandle | undefined
  try {
    const executable = await ctx.subprocess.resolveExecutable('adb', undefined, commandSignal)
    const spec: SubprocessSpawnSpec = {
      argv: [executable, ...args],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_COMMAND_OUTPUT_BYTES },
        stderr: { maxBytes: MAX_ERROR_OUTPUT_BYTES },
      },
      graceMs: TERMINATION_GRACE_MS,
      signal: commandSignal,
    }
    handle = ctx.subprocess.spawn(spec)
    handles.add(handle)
    const outcome = await handle.done
    await handle.waitForExit()
    if (timeout.aborted) throw new AndroidLogcatError('The adb command timed out.', 504, 'adb-timeout')
    if (signal.aborted) throw new AndroidLogcatError('The request was cancelled.', 499, 'request-cancelled')
    const stdout = handle.collected.stdout?.readFrom(0).text ?? ''
    const stderr = handle.collected.stderr?.readFrom(0).text ?? ''
    if (outcome.exitCode !== 0) {
      const diagnostic = safeDiagnostic(stderr)
      throw new AndroidLogcatError(
        diagnostic.length > 0 ? diagnostic : 'The adb command returned an error.',
        502,
        'adb-failed',
      )
    }
    return { stdout, stderr }
  } catch (cause) {
    if (timeout.aborted) throw new AndroidLogcatError('The adb command timed out.', 504, 'adb-timeout')
    throw cause
  } finally {
    if (handle !== undefined) {
      if (commandSignal.aborted) handle.terminate()
      try { await handle.waitForExit() } catch { /* provider teardown owns any remaining failure */ }
      handles.delete(handle)
    }
  }
}

async function captureScreenshot(
  ctx: Context,
  serial: string,
  signal: AbortSignal,
  handles: Set<SubprocessHandle>,
): Promise<Buffer> {
  const timeout = AbortSignal.timeout(COMMAND_TIMEOUT_MS)
  const commandSignal = AbortSignal.any([signal, timeout])
  let handle: SubprocessHandle | undefined
  const chunks: Buffer[] = []
  let outputBytes = 0
  let outputTooLarge = false
  let stdoutFailure: Error | undefined
  try {
    const executable = await ctx.subprocess.resolveExecutable('adb', undefined, commandSignal)
    const spec: SubprocessSpawnSpec = {
      argv: [executable, '-s', serial, 'exec-out', 'screencap', '-p'],
      cwd: process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: { maxBytes: MAX_ERROR_OUTPUT_BYTES },
      },
      graceMs: TERMINATION_GRACE_MS,
      signal: commandSignal,
    }
    handle = ctx.subprocess.spawn(spec)
    handles.add(handle)
    const stdout = handle.stdout
    if (stdout === undefined) {
      throw new AndroidLogcatError('The adb screenshot process did not expose its output stream.', 502, 'adb-screenshot-unavailable')
    }
    const stdoutEnded = new Promise<void>(resolve => {
      stdout.once('end', resolve)
      stdout.once('close', resolve)
      stdout.once('error', cause => {
        stdoutFailure = cause instanceof Error ? cause : new Error('Unable to read screenshot output.')
        resolve()
      })
    })
    stdout.on('data', (value: Buffer | string) => {
      if (outputTooLarge) return
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value)
      if (chunk.byteLength > MAX_SCREENSHOT_BYTES - outputBytes) {
        outputTooLarge = true
        chunks.length = 0
        handle?.terminate()
        return
      }
      chunks.push(chunk)
      outputBytes += chunk.byteLength
    })

    const outcome = await handle.done
    await stdoutEnded
    await handle.waitForExit()
    if (timeout.aborted) throw new AndroidLogcatError('The adb command timed out.', 504, 'adb-timeout')
    if (signal.aborted) throw new AndroidLogcatError('The request was cancelled.', 499, 'request-cancelled')
    if (outputTooLarge) {
      throw new AndroidLogcatError('The Android screenshot exceeds the maximum allowed size.', 502, 'screenshot-too-large')
    }
    if (stdoutFailure !== undefined) {
      throw new AndroidLogcatError('Unable to read the Android screenshot output.', 502, 'screenshot-read-failed')
    }
    if (outcome.exitCode !== 0) {
      throw new AndroidLogcatError('The adb screenshot command returned an error.', 502, 'adb-failed')
    }
    const png = Buffer.concat(chunks, outputBytes)
    if (png.byteLength < PNG_SIGNATURE.byteLength || !png.subarray(0, PNG_SIGNATURE.byteLength).equals(PNG_SIGNATURE)) {
      throw new AndroidLogcatError('The adb screenshot output is not a valid PNG image.', 502, 'invalid-screenshot')
    }
    return png
  } catch (cause) {
    if (timeout.aborted) throw new AndroidLogcatError('The adb command timed out.', 504, 'adb-timeout')
    if (signal.aborted) throw new AndroidLogcatError('The request was cancelled.', 499, 'request-cancelled')
    throw cause
  } finally {
    if (handle !== undefined) {
      handle.terminate()
      try { await handle.done } catch { /* provider teardown owns any remaining failure */ }
      try { await handle.waitForExit() } catch { /* provider owns the final cleanup */ }
      handles.delete(handle)
    }
  }
}

/** Parse `adb devices -l` without treating unauthorized/offline entries as usable. */
export function parseAndroidLogcatDevices(output: string): AndroidLogcatDevice[] {
  const devices: AndroidLogcatDevice[] = []
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (trimmed.length === 0 || trimmed.startsWith('List of devices attached')) continue
    const [serial, state, ...details] = trimmed.split(/\s+/u)
    if (serial === undefined || state === undefined || !DEVICE_SERIAL_PATTERN.test(serial)) continue
    const modelValue = details.find(item => item.startsWith('model:'))?.slice('model:'.length)
    devices.push({
      serial,
      state,
      ...(modelValue === undefined ? {} : { model: modelValue.replace(/_/gu, ' ') }),
    })
  }
  return devices
}

/** Parse `ps -A -o PID,NAME`; ignore headers and malformed rows. */
export function parseAndroidLogcatProcesses(output: string): AndroidLogcatProcess[] {
  const processes = new Map<number, AndroidLogcatProcess>()
  for (const line of output.split(/\r?\n/u)) {
    const columns = line.trim().split(/\s+/u)
    if (columns.length < 2 || !/^\d+$/u.test(columns[0] ?? '')) continue
    const pid = Number(columns[0])
    const name = columns.at(-1)
    if (!Number.isSafeInteger(pid) || pid <= 0 || name === undefined || name === 'NAME') continue
    if (!processes.has(pid)) processes.set(pid, { pid, name })
  }
  return [...processes.values()].sort((left, right) => left.name.localeCompare(right.name) || left.pid - right.pid)
}

function deviceIsReady(serial: string, devices: readonly AndroidLogcatDevice[]): boolean {
  return devices.some(device => device.serial === serial && device.state === 'device')
}

async function readDevices(
  ctx: Context,
  signal: AbortSignal,
  handles: Set<SubprocessHandle>,
): Promise<AndroidLogcatDevice[]> {
  const result = await runAdb(ctx, ['devices', '-l'], signal, handles)
  return parseAndroidLogcatDevices(result.stdout)
}

async function waitForSseDrain(res: ServerResponse, signal: AbortSignal): Promise<void> {
  await new Promise<void>(resolve => {
    const done = (): void => {
      res.off('drain', done)
      res.off('close', done)
      signal.removeEventListener('abort', done)
      resolve()
    }
    res.once('drain', done)
    res.once('close', done)
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted || res.destroyed || res.writableEnded) done()
  })
}

async function writeSse(res: ServerResponse, event: string, payload: unknown, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted || res.destroyed || res.writableEnded) return false
  const text = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`
  if (!res.write(text)) await waitForSseDrain(res, signal)
  return !signal.aborted && !res.destroyed && !res.writableEnded
}

async function writeSseComment(res: ServerResponse, signal: AbortSignal): Promise<void> {
  if (signal.aborted || res.destroyed || res.writableEnded) return
  if (!res.write(': keep-alive\n\n')) await waitForSseDrain(res, signal)
}

function startSseHeartbeat(res: ServerResponse, signal: AbortSignal): () => void {
  let writing = false
  const timer = setInterval(() => {
    if (writing || signal.aborted || res.destroyed || res.writableEnded) return
    writing = true
    void writeSseComment(res, signal).finally(() => { writing = false })
  }, 15_000)
  timer.unref?.()
  return () => clearInterval(timer)
}

function startStream(
  ctx: Context,
  req: IncomingMessage,
  res: ServerResponse,
  lifetimes: Set<AbortController>,
  handles: Set<SubprocessHandle>,
): Promise<void> {
  const lifetime = requestLifetime(req, res, lifetimes)
  const { signal } = lifetime
  let handle: SubprocessHandle | undefined
  let stopHeartbeat = (): void => {}
  let stderrTail = ''

  const work = async (): Promise<void> => {
    try {
      const serial = parseDeviceSerial(req)
      const devices = await readDevices(ctx, signal, handles)
      if (!deviceIsReady(serial, devices)) {
        throw new AndroidLogcatError('The selected Android device is disconnected, unauthorized, or offline.', 409, 'device-not-ready')
      }
      const executable = await ctx.subprocess.resolveExecutable('adb', undefined, signal)
      // `-T` resumes after the newest seen log instead of replaying the whole device buffer.
      const since = parseStreamSince(req)
      handle = ctx.subprocess.spawn({
        argv: since === undefined
          ? [executable, '-s', serial, 'logcat', '-v', 'threadtime']
          : [executable, '-s', serial, 'logcat', '-v', 'threadtime', '-T', since],
        cwd: process.cwd(),
        stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
        graceMs: TERMINATION_GRACE_MS,
        signal,
      })
      handles.add(handle)
      const stdout = handle.stdout
      if (stdout === undefined) {
        handle.terminate()
        throw new AndroidLogcatError('The adb logcat process did not expose its output stream.', 502, 'adb-stream-unavailable')
      }
      handle.stderr?.on('data', (chunk: Buffer | string) => {
        stderrTail = (stderrTail + String(chunk)).slice(-MAX_ERROR_OUTPUT_BYTES)
      })
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-store, no-transform',
        'connection': 'keep-alive',
        'x-accel-buffering': 'no',
        'x-content-type-options': 'nosniff',
      })
      res.flushHeaders()
      stopHeartbeat = startSseHeartbeat(res, signal)

      stdout.setEncoding('utf8')
      let pending = ''
      const emitLine = async (line: string): Promise<boolean> => await writeSse(res, 'message', line.replace(/\r$/u, ''), signal)
      for await (const chunk of stdout) {
        if (signal.aborted || res.destroyed) break
        pending += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8')
        let newline = pending.indexOf('\n')
        while (newline >= 0) {
          const line = pending.slice(0, newline)
          pending = pending.slice(newline + 1)
          if (!await emitLine(line)) break
          newline = pending.indexOf('\n')
        }
        while (pending.length > MAX_STREAM_LINE_CHARS) {
          const part = pending.slice(0, MAX_STREAM_LINE_CHARS)
          pending = pending.slice(MAX_STREAM_LINE_CHARS)
          if (!await emitLine(part)) break
        }
      }
      if (pending.length > 0 && !signal.aborted && !res.destroyed) await emitLine(pending)
      const outcome = await handle.done
      await handle.waitForExit()
      if (!signal.aborted && outcome.exitCode !== 0) {
        const diagnostic = safeDiagnostic(stderrTail)
        await writeSse(res, 'error', {
          error: diagnostic.length > 0 ? diagnostic : 'The adb logcat process stopped unexpectedly.',
        }, signal)
      }
    } catch (cause) {
      if (!res.headersSent) sendFailure(res, cause)
      else if (!signal.aborted) {
        const message = cause instanceof AndroidLogcatError || cause instanceof Error
          ? cause.message
          : 'Unable to read Android logs.'
        await writeSse(res, 'error', { error: message }, signal)
      }
    } finally {
      stopHeartbeat()
      lifetime.dispose()
      if (handle !== undefined) {
        handle.terminate()
        try { await handle.done } catch { /* reported through the route when possible */ }
        try { await handle.waitForExit() } catch { /* process provider owns the final cleanup */ }
        handles.delete(handle)
      }
      if (!res.destroyed && !res.writableEnded) res.end()
    }
  }
  return work()
}

/** Register authenticated device, process, stream, and screenshot routes. @param ctx - Host context. */
export function apply(ctx: Context): void {
  ctx.effect(() => {
    const lifetimes = new Set<AbortController>()
    const handles = new Set<SubprocessHandle>()

    const register = (path: string, handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>): (() => void) => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: (req, res) => {
        if (rejectRequest(ctx, req, res)) return
        if (!requireGet(req, res)) return
        return handler(req, res)
      },
    })

    const unregisterDevices = register(ANDROID_LOGCAT_DEVICES_PATH, async (req, res) => {
      const lifetime = requestLifetime(req, res, lifetimes)
      try {
        const devices = await readDevices(ctx, lifetime.signal, handles)
        json(res, 200, { available: true, devices })
      } catch (cause) {
        if (cause instanceof SubprocessExecutableNotFoundError) {
          json(res, 200, {
            available: false,
            error: 'Android Debug Bridge (adb) was not found on PATH. Install Android platform-tools and restart DSH Desktop.',
            devices: [],
          })
        } else {
          sendFailure(res, cause)
        }
      } finally {
        lifetime.dispose()
      }
    })

    const unregisterProcesses = register(ANDROID_LOGCAT_PROCESSES_PATH, async (req, res) => {
      const lifetime = requestLifetime(req, res, lifetimes)
      try {
        const serial = parseDeviceSerial(req)
        const devices = await readDevices(ctx, lifetime.signal, handles)
        if (!deviceIsReady(serial, devices)) {
          throw new AndroidLogcatError('The selected Android device is disconnected, unauthorized, or offline.', 409, 'device-not-ready')
        }
        const result = await runAdb(ctx, ['-s', serial, 'shell', 'ps', '-A', '-o', 'PID,NAME'], lifetime.signal, handles)
        json(res, 200, { processes: parseAndroidLogcatProcesses(result.stdout) })
      } catch (cause) {
        sendFailure(res, cause)
      } finally {
        lifetime.dispose()
      }
    })

    const unregisterStream = register(ANDROID_LOGCAT_STREAM_PATH, (req, res) => startStream(ctx, req, res, lifetimes, handles))

    const unregisterScreenshot = register(ANDROID_LOGCAT_SCREENSHOT_PATH, async (req, res) => {
      const lifetime = requestLifetime(req, res, lifetimes)
      try {
        const serial = parseDeviceSerial(req)
        const devices = await readDevices(ctx, lifetime.signal, handles)
        if (!deviceIsReady(serial, devices)) {
          throw new AndroidLogcatError('The selected Android device is disconnected, unauthorized, or offline.', 409, 'device-not-ready')
        }
        const png = await captureScreenshot(ctx, serial, lifetime.signal, handles)
        if (res.destroyed || res.writableEnded) return
        res.writeHead(200, {
          'content-type': 'image/png',
          'content-length': String(png.byteLength),
          'cache-control': 'no-store',
          'x-content-type-options': 'nosniff',
        })
        res.end(png)
      } catch (cause) {
        sendFailure(res, cause)
      } finally {
        lifetime.dispose()
      }
    })

    return async () => {
      unregisterScreenshot()
      unregisterDevices()
      unregisterProcesses()
      unregisterStream()
      for (const lifetime of lifetimes) lifetime.abort()
      for (const handle of handles) handle.terminate()
      await Promise.allSettled([...handles].map(async handle => {
        try { await handle.done } finally { await handle.waitForExit() }
      }))
      lifetimes.clear()
      handles.clear()
    }
  }, 'dsh-plugin-desktop: authenticated Android adb Logcat routes')
}
