/** First-phase server owner; later phases add shared GUI ownership and Web onboarding. */
import { existsSync, mkdirSync, rmdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { NextDesktopRuntime } from '../desktop-runtime.ts'
import { NEXT_PACKAGE } from '../profiles.ts'
import { DEFAULT_PREFERENCES } from '../desktop-contract.ts'
import type { HeadlessOptions } from './options.ts'

export async function runHeadless(options: HeadlessOptions): Promise<void> {
  const root = dirname(NEXT_PACKAGE)
  // Refuse a desktop data tree until the shared GUI/server ownership protocol lands.
  const marker = join(options.home, 'headless-server.json')
  if (existsSync(join(options.home, 'profiles')) && !existsSync(marker)) {
    throw new Error('Use a dedicated server data directory; existing Desktop data is not supported yet')
  }
  mkdirSync(options.home, { recursive: true, mode: 0o700 })
  const lock = join(options.home, '.headless-running')
  try { mkdirSync(lock, { mode: 0o700 }) } catch { throw new Error(`Server directory is already locked: ${lock}. After an abnormal exit, verify no server is running before removing this empty lock directory.`) }
  let runtime: NextDesktopRuntime | undefined
  let stopped = false
  let finish!: () => void
  const finished = new Promise<void>(resolve => { finish = resolve })
  let closing: Promise<void> | undefined
  const close = (): Promise<void> => closing ??= (async () => {
    stopped = true
    try { await runtime?.close() } finally { finish() }
  })()
  const stop = (): void => { void close().catch(error => { console.error(error); process.exitCode = 1 }) }
  const fail = (): void => { process.exitCode = 1; stop() }
  process.once('SIGINT', stop)
  process.once('SIGTERM', stop)
  try {
    if (!existsSync(marker)) writeFileSync(marker, '{"version":1}\n', { flag: 'wx', mode: 0o600 })
    const primaryRuntime = join(root.endsWith('.asar') ? join(dirname(root), 'runtime') : join(root, '.desktop-build', 'runtime'), process.arch, 'primary-runtime')
    runtime = new NextDesktopRuntime({ home: options.home, root, executable: process.execPath,
      ...(existsSync(primaryRuntime) ? { primaryRuntime } : {}),
      addresses: () => [], certificate: async () => { throw new Error('Headless LAN access is not available') },
      onFailure: fail, onChange: () => {}, onRestart: () => { process.stderr.write('Restart requested; stop and restart the server.\n'); stop() },
      onTerminal: () => { process.stderr.write('Native terminal windows are unavailable in headless mode.\n') },
      onNotification: () => {},
      onPermission: async (_action, permission) => ({ permission, status: 'restricted', canRequest: false, canOpenSettings: false }),
    })
    // Invocation-local policy does not overwrite desktop preferences or mark onboarding complete.
    runtime.selected = options.profile
    runtime.preferences = { ...DEFAULT_PREFERENCES, browserAccess: true, networkExposure: 'loopback', port: options.port }
    if (!stopped) await runtime.start()
    if (!stopped) {
      const url = runtime.browserLinks().localUrl
      if (!url) throw new Error('Host did not publish its browser address')
      process.stdout.write(`DSH NEXT headless ready: ${url}\nProfile: ${options.profile}\n`)
      await finished
    }
  } finally {
    try { await close() } finally {
      process.removeListener('SIGINT', stop)
      process.removeListener('SIGTERM', stop)
      rmdirSync(lock)
    }
  }
}
