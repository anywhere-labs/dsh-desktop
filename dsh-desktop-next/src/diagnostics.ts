/** Bounded local diagnostics; no recursive home, session, or credential export. */
import { join } from 'node:path'
import { atomicText, readPrivateFile } from './private-files.ts'
import { maskSecrets } from './mask-secrets.ts'
import type { DesktopPreferences, DesktopState } from './desktop-contract.ts'

const LIMIT = 128 * 1024
const LEVELS = ['debug', 'info', 'warn', 'error'] as const
export class DesktopDiagnostics {
  readonly file: string
  private text = ''
  private partial = ''
  private timer: ReturnType<typeof setTimeout> | undefined
  level: DesktopPreferences['logLevel'] = 'info'
  constructor(home: string) {
    this.file = join(home, 'logs', 'desktop-next.log')
    try { this.text = readPrivateFile(this.file, LIMIT * 4)?.slice(-LIMIT) ?? '' } catch { /* Logging cannot prevent recovery. */ }
  }
  append(message: string, level: DesktopPreferences['logLevel'] = 'info'): void {
    if (LEVELS.indexOf(level) < LEVELS.indexOf(this.level)) return
    this.text = (this.text + `${new Date().toISOString()} [${level}] ${maskSecrets(message)}\n`).slice(-LIMIT)
    this.timer ??= setTimeout(() => this.flush(), 200)
    this.timer.unref()
  }
  /** Redact whole lines, including secrets split across process output chunks. */
  hostChunk(chunk: string): void {
    this.partial += chunk
    const lines = this.partial.split(/\r?\n/u)
    this.partial = lines.pop() ?? ''
    for (const line of lines) this.append(line, /\b(error|fatal)\b/iu.test(line) ? 'error' : /\bwarn/iu.test(line) ? 'warn' : /\bdebug\b/iu.test(line) ? 'debug' : 'info')
    if (this.partial.length > LIMIT) this.partial = '[oversized incomplete log line omitted]'
  }
  snapshot(): string { return maskSecrets(this.text + (this.partial ? `\n${this.partial}` : '')).slice(-LIMIT) }
  flush(): void {
    clearTimeout(this.timer); this.timer = undefined
    try { atomicText(this.file, this.snapshot()) } catch (error) { console.error('Next diagnostic log write failed', error) }
  }
  export(state: DesktopState): string {
    // Explicit projection: never serialize the runtime object or its authentication URL.
    return JSON.stringify({ format: 'dsh-desktop-next-diagnostics', version: 1, created: new Date().toISOString(),
      application: { version: state.version, platform: state.platform, versions: process.versions },
      runtime: { profile: state.selected, profiles: state.profiles, phase: state.phase, safeMode: state.safeMode,
        failure: maskSecrets(state.failure), features: state.features, preferences: state.preferences,
        trayAvailable: state.trayAvailable, browserUrl: state.browserUrl, lan: state.lan },
      log: this.snapshot(),
    }, null, 2) + '\n'
  }
}
