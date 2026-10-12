import { EventEmitter } from 'node:events'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installFailLoud } from '@deepseek-ai/dsh-app-boot'
import {
  createDesktopFailLoudProcess,
  describeDesktopChildProcess,
  ElectronStderrLogger,
  formatDesktopErrorDetails,
  installDesktopChildProcessLogging,
  installDesktopUncaughtExceptionLogging,
} from '../src/desktop-logger.ts'
import { LogFileSink } from '../src/log-files.ts'

function todaySuffix(): string {
  const now = new Date()
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function sink(): { s: LogFileSink; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-log-'))
  return { s: new LogFileSink(dir, { maxFileBytes: 1e6, maxDirectoryBytes: 1e7 }), dir }
}

describe('ElectronStderrLogger', () => {
  it('logs Electron child process crashes with the Windows exception code', () => {
    const app = new EventEmitter()
    const logger = { error: vi.fn(), errorCause: vi.fn(), info: vi.fn() }
    const remove = installDesktopChildProcessLogging(app, logger)

    app.emit('child-process-gone', {}, {
      type: 'Utility',
      reason: 'crashed',
      exitCode: -1073741819,
      serviceName: 'network.mojom.NetworkService',
      name: 'Network Service',
    })

    expect(logger.error).toHaveBeenCalledWith(
      'dsh-plugin-desktop: child process gone (type: Utility, name: Network Service, service: network.mojom.NetworkService, reason: crashed, exitCode: -1073741819 / 0xc0000005)',
    )
    remove()
    expect(app.listenerCount('child-process-gone')).toBe(0)
  })

  it('hands the same child process failure to a correlation observer', () => {
    const app = new EventEmitter()
    const logger = { error: vi.fn(), errorCause: vi.fn(), info: vi.fn() }
    const observer = vi.fn()
    const remove = installDesktopChildProcessLogging(app, logger, observer)
    const details = {
      type: 'Utility',
      reason: 'killed',
      exitCode: 1073807364,
      name: 'Network Service',
    }

    app.emit('child-process-gone', {}, details)

    expect(observer).toHaveBeenCalledWith(details)
    expect(describeDesktopChildProcess(details)).toBe(
      'Utility/Network Service reason: killed, exitCode: 1073807364 / 0x40010004',
    )
    remove()
  })

  it('keeps the log line when the correlation observer throws', () => {
    const app = new EventEmitter()
    const logger = { error: vi.fn(), errorCause: vi.fn(), info: vi.fn() }
    const remove = installDesktopChildProcessLogging(app, logger, () => { throw new Error('observer down') })

    expect(() => {
      app.emit('child-process-gone', {}, { type: 'GPU', reason: 'crashed', exitCode: 0 })
    }).not.toThrow()
    expect(logger.error).toHaveBeenCalledOnce()
    remove()
  })

  it('names an unnamed child process rather than dropping it', () => {
    expect(describeDesktopChildProcess({ type: 'Utility', reason: 'oom', exitCode: 0 })).toBe(
      'Utility/unnamed reason: oom, exitCode: 0 / 0x00000000',
    )
    expect(describeDesktopChildProcess({
      type: 'Utility',
      reason: 'oom',
      exitCode: 0,
      serviceName: 'node.mojom.NodeService',
    })).toContain('Utility/node.mojom.NodeService')
  })

  it('writes to the sink and to stderr', () => {
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)
    logger.error('boom')
    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
    const day = todaySuffix()
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toContain('boom')
  })

  it('writes an informational line to the full log without the error log', () => {
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)

    logger.info('outbound proxy = none (source: none)')

    expect(stderrSpy).toHaveBeenCalled()
    stderrSpy.mockRestore()
    const day = todaySuffix()
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toContain('outbound proxy = none')
    // A startup fact is not a fault. Routing it to the error log would make every healthy start
    // look like it had one, and the error log is where triage looks first.
    expect(existsSync(join(dir, `dsh-error-${day}.log`))).toBe(false)
  })

  it('masks credentials in an informational proxy line', () => {
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)

    logger.info('outbound proxy = http://alice:hunter2@proxy.corp:8080 (source: environment HTTPS_PROXY)')

    stderrSpy.mockRestore()
    const text = readFileSync(join(dir, `dsh-${todaySuffix()}.log`), 'utf8')
    expect(text).not.toContain('hunter2')
    expect(text).toContain('proxy.corp:8080')
  })

  it('renders an unknown cause as a string', () => {
    const { s } = sink()
    const logger = new ElectronStderrLogger(s)
    expect(() => logger.errorCause({ code: 42 })).not.toThrow()
  })

  it('uses the error stack for Error causes', () => {
    const { s, dir } = sink()
    const logger = new ElectronStderrLogger(s)
    logger.errorCause(new Error('crash here'))
    const day = todaySuffix()
    expect(readFileSync(join(dir, `dsh-${day}.log`), 'utf8')).toContain('crash here')
  })

  it('masks secrets in the file and stderr outputs', () => {
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)

    logger.error('request failed with Bearer abc.def.secret')

    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text).toContain('Bearer ****')
    expect(text).not.toContain('abc.def.secret')
    expect(stderrSpy).toHaveBeenCalledWith('request failed with Bearer ****\n')
    stderrSpy.mockRestore()
  })

  it('accepts fail-loud stderr chunks without adding a second newline', () => {
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)

    logger.write('dsh-plugin-desktop: fatal load failure: Bearer abc.def.secret\n')

    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text).toContain('fatal load failure: Bearer ****\n')
    expect(text).not.toContain('abc.def.secret')
    expect(stderrSpy).toHaveBeenCalledWith('dsh-plugin-desktop: fatal load failure: Bearer ****\n')
    stderrSpy.mockRestore()
  })

  it('logs the first uncaught exception and requests a fatal exit', () => {
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)
    const proc = new EventEmitter()
    const exit = vi.fn()

    const remove = installDesktopUncaughtExceptionLogging(proc, logger, exit)
    proc.emit('uncaughtException', new Error('fatal Bearer abc.def.secret'))
    proc.emit('uncaughtException', new Error('second failure'))

    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text).toContain('fatal Bearer ****')
    expect(text).not.toContain('abc.def.secret')
    expect(text).not.toContain('second failure')
    expect(exit).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledWith(1)
    expect(proc.listenerCount('uncaughtException')).toBe(0)
    remove()
    stderrSpy.mockRestore()
  })

  it('reports one uncaught exception once when the runtime fail-loud is installed too', () => {
    // Launch order in main.ts: Desktop's handler first, then the runtime's
    // installFailLoud through the adapter. dsh 0.1.7's fail-loud also takes
    // uncaughtException and must retire Desktop's handler; 0.1.5's does not, and
    // Desktop's handler keeps the event. Either way the crash is logged once.
    const { s, dir } = sink()
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)
    const proc = new EventEmitter()
    const requestQuit = vi.fn()
    const exit = vi.fn()

    const removeDesktop = installDesktopUncaughtExceptionLogging(proc, logger, requestQuit)
    const uninstall = installFailLoud(
      'dsh-plugin-desktop',
      createDesktopFailLoudProcess(proc, logger, exit, removeDesktop),
    )
    proc.emit('uncaughtException', new Error('single crash'))
    proc.emit('uncaughtException', new Error('follow-up crash'))

    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text.match(/single crash/gu)).toHaveLength(1)
    expect(text).not.toContain('follow-up crash')
    expect(requestQuit.mock.calls.length + exit.mock.calls.length).toBe(1)
    uninstall()
    removeDesktop()
    stderrSpy.mockRestore()
  })

  it('claims the uncaught-exception event only when fail-loud subscribes to it', () => {
    const proc = new EventEmitter()
    const claim = vi.fn()
    const adapter = createDesktopFailLoudProcess(proc, { write: () => true }, vi.fn(), claim)
    const handler = vi.fn()

    adapter.on('unhandledRejection', handler)
    expect(claim).not.toHaveBeenCalled()
    expect(proc.listenerCount('unhandledRejection')).toBe(1)
    adapter.on('uncaughtException', handler)
    expect(claim).toHaveBeenCalledOnce()
    adapter.off('unhandledRejection', handler)
    adapter.off('uncaughtException', handler)
    expect(proc.listenerCount('unhandledRejection')).toBe(0)
    expect(proc.listenerCount('uncaughtException')).toBe(0)
  })

  it('falls back to masked stderr when the file sink fails', () => {
    const { s } = sink()
    vi.spyOn(s, 'write').mockImplementation(() => { throw new Error('disk full') })
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
    const logger = new ElectronStderrLogger(s)

    expect(() => { logger.error('failed with Bearer abc.def.secret') }).not.toThrow()
    expect(stderrSpy).toHaveBeenCalledWith('failed with Bearer ****\n')
    stderrSpy.mockRestore()
  })

  it('expands the error cause chain with cause= lines (#952)', () => {
    const { s, dir } = sink()
    const logger = new ElectronStderrLogger(s)
    const root = new Error('cannot resolve active package') as Error & { code?: string }
    root.code = 'REQUEST_EXTENSION'
    const wrapped = new Error('DeepSeek request extension preparation failed', { cause: root })
    logger.errorCause(wrapped)
    const day = todaySuffix()
    const text = readFileSync(join(dir, `dsh-${day}.log`), 'utf8')
    expect(text).toContain('DeepSeek request extension preparation failed')
    expect(text).toContain('cause=')
    expect(text).toContain('cannot resolve active package')
  })

  it('expands AggregateError parts and nested plain causes (#952)', () => {
    expect(formatDesktopErrorDetails(new AggregateError([new Error('fiber-a down'), 'fiber-b down'], 'loader fibers failed')))
      .toMatch(/loader fibers failed.*errors:.*fiber-a down.*fiber-b down/s)
    const plain = new Error('wrapper', { cause: { code: 42 } })
    expect(formatDesktopErrorDetails(plain)).toContain('cause=')
  })
})
