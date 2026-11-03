/** Headless owner of the Host, desktop preferences, Profiles and recovery. */
import { randomBytes } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { cleanupDisposableTree } from '../../dsh-plugin-desktop/src/disposable-tree.ts'
import { dirname, join } from 'node:path'
import type { PlatformSession } from '@deepseek-ai/dsh-deepseek-account'
import { DesktopBackendController } from './backend-controller.ts'
import { DesktopHostExitError, DesktopHostFatalError, DesktopHostProcess, type DesktopAnywhereBridge, type DesktopPlatformLoginRequest } from './host-process.ts'
import { DesktopPreferenceStore, parsePreferences } from './desktop-preferences.ts'
import { DEFAULT_FEATURES, NextProfiles } from './profiles.ts'
import { setTokensAnywhere } from './profile-tokens-anywhere.ts'
import { DEFAULT_PREFERENCES, DEFAULT_PROFILE, SAFE_MODE_PREFERENCES, type DesktopBrowserLinks, type DesktopFailureReport, type DesktopPreferences, type DesktopState, type DesktopNotification } from './desktop-contract.ts'
import { DesktopDiagnostics } from './diagnostics.ts'
import type { DesktopHostExit } from './exit-code.ts'
import { appendFailureReport, renderFailureReport, rendererFailureSection, writeFailureReport, type FailureReportInput } from './failure-report.ts'
import { DEFAULT_HOST_STARTUP_TIMEOUT, DesktopHostStartupTimeoutError, HOST_STARTUP_NOTICE_MS, isHostStartupTimeout, startupEntriesSummary,
  type DesktopStartupEntry, type DesktopStartupNotice, type DesktopStartupTimeoutFailure, type HostStartupTimeout } from './host-startup-limit.ts'
import { collectRendererDiagnostics, rendererDiagnosticsFields, RENDERER_FAILURE_SAMPLE_MS, RENDERER_FAILURE_TIMEOUT_MS, type RendererDiagnostics, type RendererDiagnosticsTarget, type RendererEvidence } from './renderer-diagnostics.ts'
import { DesktopMemoryMonitor, type DesktopMemoryProbe } from './memory-monitor.ts'
import { NextRecovery } from './recovery.ts'
import { maskSecrets } from './mask-secrets.ts'
import { privateDirectory } from './private-files.ts'
import { authenticateWebHost } from './web-document.ts'
import { DesktopLanHttpsRuntime } from './lan-https-runtime.ts'
import type { DesktopLanHttpsCertificate } from './lan-https-certificate.ts'
import type { DesktopPermission, DesktopPermissionAction, DesktopPermissionSnapshot } from './permissions.ts'
import { SYSTEM_PROXY_ENV, type DesktopSystemProxyProbe } from './system-proxy.ts'
import { createOperationHistory } from './upstream-family.ts'
import type { DesktopFailureStage } from '../../dsh-plugin-desktop/src/recovery-copy.ts'

interface RuntimeOptions {
  home: string
  /** Disposable desktop settings; recovery continues to address the original home. */
  stateHome?: string
  root: string
  /** Bundled interpreter payload for this CPU; a development tree without one runs without Office skills. */
  primaryRuntime?: string
  executable: string
  addresses(): string[]
  /** Finish login-shell and system-proxy discovery before a Host child captures `process.env`. */
  prepareEnvironment?(): Promise<void>
  /** The system proxy main probed at startup; the Host decides whether it applies. */
  systemProxy?(): DesktopSystemProxyProbe
  /** Electron process and system memory readings for memory evidence; omitted where Electron is absent. */
  memoryProbe?: DesktopMemoryProbe
  certificate(addresses: readonly string[]): Promise<DesktopLanHttpsCertificate>
  onFailure(): void
  onChange(): void
  onRestart(): void
  onTerminal(): void
  onNotification(notification: DesktopNotification): void
  /** Tell the user once that a Host start allowed more than a minute is still going; the result withdraws the notice. */
  onStartupSlow?(notice: DesktopStartupNotice): () => void
  onPermission?(action: DesktopPermissionAction, permission: DesktopPermission): Promise<DesktopPermissionSnapshot>
  /** The main window's page, sampled when a failure report is written; undefined until that window exists. */
  renderer?(): RendererDiagnosticsTarget | undefined
  /** The last sample of the page that answered earlier, for a report written after it stopped answering. */
  rendererEvidence?(): RendererEvidence | undefined
  /** The current Host's account grant for the embedded Platform page, or null once it has none. */
  onPlatformSession?(session: PlatformSession | null): void
  onPlatformLogin?(request: DesktopPlatformLoginRequest): void
  /** The Anywhere account's sign-in window and secret sealing. */
  anywhere?: DesktopAnywhereBridge
}

export class NextDesktopRuntime {
  readonly profiles: NextProfiles
  readonly recovery: NextRecovery
  readonly settings: DesktopPreferenceStore
  readonly diagnostics: DesktopDiagnostics
  /** Memory trend ring and incident snapshots; the main process starts sampling once Electron is ready. */
  readonly memory: DesktopMemoryMonitor
  readonly backend: DesktopBackendController<{ start(): Promise<void>; stop(): Promise<void> }>
  preferences: DesktopPreferences = { ...DEFAULT_PREFERENCES }
  selected: string = DEFAULT_PROFILE
  safeMode = false
  recoveryMode = false
  busy = false
  closing = false
  failure = ''
  failureStage: DesktopFailureStage | undefined
  failureExit: DesktopHostExit | undefined
  failureTimeout: DesktopStartupTimeoutFailure | undefined
  /** A Desktop action that failed while `failure` is shown; the next action clears it. */
  actionFailure = ''
  startup: Promise<void> = Promise.resolve()
  /** Main-process transport only; never copied into a DesktopState. */
  auth: { url: string; cookie: string; token: string; injections: readonly unknown[] } | undefined
  lan: DesktopLanHttpsRuntime | undefined
  private safeHome: string | undefined
  private hostProcess: DesktopHostProcess | undefined
  /** The Host startup limit saved for the original environment, which recovery shows and changes even in Safe Mode. */
  private savedStartupTimeout: HostStartupTimeout = DEFAULT_HOST_STARTUP_TIMEOUT
  private readonly preferenceWarning = (message: string): void => { this.diagnostics.append(message, 'warn') }
  /** Where a backend failure stops the Desktop: preparation, Host startup, or a Host that was running. */
  private hostStage: DesktopFailureStage = 'host-boot'
  private failureContext: string | undefined
  private failureReport: DesktopFailureReport | undefined
  /** Settles once the current report is saved or has failed; never rejects. */
  private failureReportWrite: Promise<void> = Promise.resolve()
  /** Evidence appended after a saved report; awaited on close so a quitting Desktop still writes it. */
  private failureEvidenceWrite: Promise<void> = Promise.resolve()
  /** Plugin operations journaled for failure reports, where the followed DSH release reports them. */
  private readonly operationHistory: ReturnType<NonNullable<typeof createOperationHistory>> | undefined

  constructor(readonly options: RuntimeOptions) {
    this.profiles = new NextProfiles(options.home)
    this.recovery = new NextRecovery(this.profiles)
    this.settings = new DesktopPreferenceStore(options.stateHome ?? options.home, this.preferenceWarning)
    this.diagnostics = new DesktopDiagnostics(options.home)
    this.operationHistory = createOperationHistory?.(join(dirname(this.diagnostics.file), 'plugin-operations'))
    this.memory = new DesktopMemoryMonitor({ probe: options.memoryProbe,
      record: input => { this.diagnostics.record(input) }, flush: () => { this.diagnostics.flush() } })
    this.backend = new DesktopBackendController(onFailure => this.createHost(onFailure), state => {
      this.diagnostics.record({ source: 'desktop.backend', event: 'phase', fields: { phase: state.phase } })
      if (state.phase === 'error' && !this.closing) {
        this.report(state.failure ?? state.message, this.hostStage)
        // The Host now ships its complete inspected error with `fatal`. Recovery
        // shows only the message; the stack, properties and cause chain go to the
        // diagnostics log so a startup failure stays diagnosable after the fact.
        const failure = state.failure
        if (failure instanceof DesktopHostFatalError && failure.diagnostic !== undefined) {
          this.diagnostics.append(maskSecrets(failure.diagnostic), 'error')
        }
      }
      this.options.onChange()
    })
  }

  initialize(): void {
    try { this.selected = this.profiles.active } catch (error) {
      if (this.safeMode) this.diagnostics.append(`Original Profile selection is unavailable: ${String(error)}`, 'warn')
      else this.report(error, 'profile-selection')
    }
    let read = false
    if (this.safeMode) this.preferences = { ...SAFE_MODE_PREFERENCES }
    else try { this.preferences = this.settings.read(); read = true } catch (error) { this.report(error, 'runtime-bootstrap') }
    // Safe Mode and an unreadable preference file still show recovery the limit saved apart from it.
    this.savedStartupTimeout = read ? this.preferences.hostStartupTimeout
      : new DesktopPreferenceStore(this.options.home, this.preferenceWarning).readExtra().hostStartupTimeout
    this.diagnostics.level = this.preferences.logLevel
    this.diagnostics.developer = this.preferences.developerLogging
  }

  /**
   * Enter the failed state shown by the recovery assistant and save a report of it. The failure that
   * opened recovery stays its reason: a Desktop action failing afterwards becomes `actionFailure`, and a
   * later failure of another stage is only logged. A failure of the Desktop itself replaces a failed
   * action as the reason.
   * @param error - The failure; a Host exit also keeps its code and last stderr for display.
   * @param stage - Where the failure stopped the Desktop; failed Desktop actions by default.
   */
  report(error: unknown, stage: DesktopFailureStage = 'desktop-runtime'): void {
    if (this.closing) return
    const message = maskSecrets(error instanceof Error ? error.message : String(error))
    if (this.failure && (stage === 'desktop-runtime' || this.failureStage !== 'desktop-runtime')) {
      this.diagnostics.record({ source: 'desktop', event: 'runtime.failed', level: 'error', error, fields: { stage, recoveryReason: this.failureStage } })
      if (stage === 'desktop-runtime') this.actionFailure = message
      this.options.onChange()
      return
    }
    this.failure = message
    this.failureStage = stage
    this.failureExit = error instanceof DesktopHostExitError
      ? { code: error.exitCode, signal: error.signal, output: maskSecrets(error.output),
        ...(error.fatal === undefined ? {} : { fatal: maskSecrets(error.fatal) }) } : undefined
    this.failureTimeout = error instanceof DesktopHostStartupTimeoutError
      ? { seconds: error.seconds, ...(error.pending === undefined ? {} : { pending: error.pending }),
        ...(error.unanswered === undefined ? {} : { unanswered: maskSecrets(error.unanswered) }) } : undefined
    this.actionFailure = ''
    this.diagnostics.record({ source: 'desktop', event: 'runtime.failed', level: 'error', error, fields: { stage } })
    // A pending memory snapshot lands before recovery mode stops the Host and closes the main window.
    this.memory.settle()
    this.saveFailureReport(error, stage)
    this.options.onFailure()
    this.options.onChange()
  }

  /**
   * Wait for the report of the failure the recovery assistant shows.
   * @returns Its file, or undefined when none was saved.
   */
  async failureReportFile(): Promise<string | undefined> {
    await this.failureReportWrite
    return this.failureReport?.status === 'saved' ? this.failureReport.file : undefined
  }

  start(): Promise<void> {
    this.recoveryMode = false
    this.failure = ''
    this.failureStage = undefined
    this.failureExit = undefined
    this.failureTimeout = undefined
    this.failureReport = undefined
    this.failureContext = undefined
    this.actionFailure = ''
    this.startup = this.backend.start(async () => {
      this.hostStage = 'shell-environment'
      await this.options.prepareEnvironment?.()
      this.hostStage = 'profile-composition'
      if (this.safeMode && !this.safeHome) {
        privateDirectory(this.recovery.directory)
        this.safeHome = mkdtempSync(join(this.recovery.directory, 'safe-runtime-'))
        const safe = new NextProfiles(this.safeHome)
        safe.ensure(DEFAULT_PROFILE)
        safe.setFeatures(DEFAULT_PROFILE, { remoteControl: false, market: false })
        // Next's own optional plugin stays off too, like Remote Control and the market.
        setTokensAnywhere(join(safe.directory(DEFAULT_PROFILE), 'cordis.patch.yml'), false)
      }
      if (this.safeMode) this.preferences = { ...SAFE_MODE_PREFERENCES }
      if (!this.safeMode) this.profiles.ensure(this.selected)
      this.hostStage = 'host-boot'
    })
    // The backend publishes failures after owned process cleanup.
    void this.startup.catch(() => {})
    return this.startup
  }

  async restart(change: () => void | Promise<void> = () => {}): Promise<void> {
    await this.backend.stop()
    if (this.closing) return
    const wasSafe = this.safeMode
    await change()
    if (!this.safeMode) {
      this.cleanupSafeHome()
      if (wasSafe) this.preferences = new DesktopPreferenceStore(this.options.home, this.preferenceWarning).read()
    }
    await this.start()
  }

  /** Native repair tools target the original Profile; app tools follow the running environment. */
  terminalTarget(repair = false): { homeDir: string; profileDir: string; profileName: string; mode: 'normal' | 'safe' | 'recovery' } {
    if (this.closing) throw new Error('Next is shutting down')
    const safe = this.safeMode && !repair
    if (safe && !this.safeHome) throw new Error('Safe mode environment is not ready')
    const homeDir = safe ? this.safeHome! : this.options.home
    const profileName = safe ? DEFAULT_PROFILE : this.selected
    return { homeDir, profileName, profileDir: new NextProfiles(homeDir).directory(profileName),
      mode: safe ? 'safe' : repair || this.recoveryMode ? 'recovery' : 'normal' }
  }

  writePreferences(value: unknown): void {
    if (this.safeMode) throw new Error('Desktop preferences are fixed in Safe Mode')
    this.preferences = this.settings.write(parsePreferences(value))
    this.savedStartupTimeout = this.preferences.hostStartupTimeout
    this.diagnostics.level = this.preferences.logLevel
    this.diagnostics.developer = this.preferences.developerLogging
    this.options.onChange()
  }

  /**
   * Save the original environment's Host startup limit from the recovery assistant, in Safe Mode too. Only
   * the extra preference file changes, so an unreadable desktop-preferences.json is not replaced by defaults.
   * @param value - Seconds, or `'none'`; the next Host start of the original environment applies it.
   */
  saveStartupTimeout(value: HostStartupTimeout): void {
    if (!isHostStartupTimeout(value)) throw new Error('Invalid Host startup limit')
    new DesktopPreferenceStore(this.options.home, this.preferenceWarning).writeExtra({ hostStartupTimeout: value })
    this.savedStartupTimeout = value
    if (!this.safeMode) this.preferences = { ...this.preferences, hostStartupTimeout: value }
    this.options.onChange()
  }

  /**
   * Boot rows for a document that is loading now.
   * @returns The Host's current Web boot table, or the table captured at startup when the running
   * Host cannot answer. dsh 0.1.7 addresses boot bundles by revision and republishes the table
   * whenever a plugin registers, so replaying the startup table breaks every reload that follows
   * a plugin installation.
   */
  async injections(): Promise<readonly unknown[]> {
    const auth = this.auth
    if (!auth) throw new Error('Next Host is unavailable')
    try { return await (this.hostProcess?.collectInjections() ?? Promise.resolve(auth.injections)) }
    catch (error) {
      this.diagnostics.append(`Web boot injections: ${String(error)}`, 'warn')
      return auth.injections
    }
  }

  /**
   * Ask the running Host to authorize a Session's workspace file for a native file drag.
   * @param address - Session-scoped file reference the application window supplied.
   * @param signal - Cancels the Host's read.
   * @returns The file's path and content identity, or null when the file cannot be borrowed. Rejects while no Host runs
   * or where the followed DSH release drags no files natively.
   */
  dragResource(address: string, signal: AbortSignal): Promise<{ readonly path: string; readonly sha256: string; readonly size: number } | null> {
    const resources = this.backend.host === undefined ? undefined : this.hostProcess?.dragResources
    return resources === undefined ? Promise.reject(new Error('File drag Host unavailable')) : resources.resolve(address, signal)
  }

  /** Apply access toggles without stopping conversations or changing the renderer capability. */
  async applyPreferences(value: unknown): Promise<void> {
    const next = parsePreferences(value)
    // A Host already being spawned has captured its boot policy. Apply after
    // readiness instead of only saving a value that the running Host never sees.
    if (this.backend.state.phase === 'starting' && !this.recoveryMode && !this.safeMode) await this.startup.catch(() => {})
    if (this.closing) throw new Error('Next is shutting down')
    const previous = this.preferences
    const host = this.hostProcess
    const lan = this.lan
    if (!host || !lan || !this.auth || this.safeMode || this.backend.state.phase !== 'ready') {
      this.writePreferences(next); return
    }
    const loggingChanged = next.developerLogging !== previous.developerLogging || next.logLevel !== previous.logLevel
    const changed = next.browserAccess !== previous.browserAccess || next.networkExposure !== previous.networkExposure
    try {
      if (loggingChanged) await host.setLogging(next)
      if (!changed) { this.writePreferences(next); return }
      await host.setBrowserAccess(next.browserAccess)
      const edge = await lan.setEnabled(next.browserAccess && next.networkExposure === 'lan')
      if (this.closing) throw new Error('Next is shutting down')
      this.writePreferences(next)
      if (edge.state === 'failed') this.diagnostics.append(`LAN HTTPS: ${edge.errorCode}`, 'warn')
    } catch (error) {
      if (!this.closing) {
        try {
          if (loggingChanged) await host.setLogging(previous)
          await host.setBrowserAccess(previous.browserAccess)
          await lan.setEnabled(previous.browserAccess && previous.networkExposure === 'lan')
        } catch {
          // An unacknowledged access policy must never remain publicly reachable.
          await this.backend.stop()
        }
      }
      throw error
    }
  }

  state(): Pick<DesktopState, 'selected' | 'profiles' | 'unavailableProfiles' | 'features' | 'preferences' | 'phase' | 'busy' | 'failure' | 'failureStage' | 'failureExit' | 'failureTimeout' | 'failureReport' | 'failureContext' | 'actionFailure' | 'safeMode' | 'hostStartupTimeout' | 'home' | 'browserUrl' | 'lan' | 'checkpoint' | 'logs'> {
    let features = { ...DEFAULT_FEATURES }
    let profiles: string[] = []
    let checkpoint: DesktopState['checkpoint'] = null
    let failure = this.failure
    let failureStage = this.failureStage
    const unreadable = (error: unknown): void => {
      if (failure) return
      failure = maskSecrets(String(error))
      failureStage = 'profile-selection'
    }
    try { profiles = this.profiles.list() } catch (error) { unreadable(error) }
    if (!this.safeMode) try { features = this.profiles.features(this.selected) } catch (error) { unreadable(error) }
    try { const saved = this.recovery.latest(this.selected); if (saved) checkpoint = { created: saved.created } } catch { /* Recovery remains usable without backups. */ }
    return { selected: this.selected, profiles, unavailableProfiles: profiles.filter(name => !this.profiles.selectable(name)), features, preferences: { ...this.preferences }, phase: this.recoveryMode ? 'recovery' : !this.auth && failure ? 'error' : this.backend.state.phase,
      busy: this.busy, failure, ...(failureStage === undefined ? {} : { failureStage }), ...(this.failureExit === undefined ? {} : { failureExit: this.failureExit }),
      ...(this.failureTimeout === undefined ? {} : { failureTimeout: this.failureTimeout }),
      ...(this.failureContext === undefined ? {} : { failureContext: this.failureContext }),
      ...(this.failureReport === undefined ? {} : { failureReport: this.failureReport }), ...(this.actionFailure ? { actionFailure: this.actionFailure } : {}),
      safeMode: this.safeMode, hostStartupTimeout: this.savedStartupTimeout, home: this.options.home,
      browserUrl: this.auth && this.preferences.browserAccess && !this.safeMode ? new URL(this.auth.url).origin : null,
      lan: this.lan?.snapshot() ?? null, checkpoint, logs: this.diagnostics.snapshot() }
  }

  /** Tell the running Host that the user closed the Tokens Anywhere sign-in window. */
  anywhereLoginClosed(): void {
    this.hostProcess?.anywhereLoginClosed()
  }

  /** Tell the running Host that Tokens Anywhere's link opened DSH. */
  anywhereLoginRequested(): void {
    this.hostProcess?.anywhereLoginRequested()
  }

  browserLinks(): DesktopBrowserLinks {
    if (!this.auth || this.closing || this.recoveryMode || this.backend.state.phase !== 'ready' || !this.preferences.browserAccess || this.safeMode) return { localUrl: null, lanUrls: [] }
    const localUrl = new URL(this.auth.url).href
    const edge = this.lan?.snapshot()
    const lanUrls = this.preferences.networkExposure === 'lan' && edge?.state === 'ready' && edge.actualPort
      ? edge.addresses.map(address => {
        const url = new URL(localUrl)
        url.protocol = 'https:'; url.hostname = address; url.port = String(edge.actualPort)
        return url.href
      }) : []
    return { localUrl, lanUrls }
  }

  browserLink(lan = false): string {
    const links = this.browserLinks()
    const url = lan ? links.lanUrls[0] : links.localUrl
    if (!url) throw new Error(lan ? 'LAN HTTPS is unavailable' : 'Browser access is unavailable')
    return url
  }

  resolveBrowserLink(value: unknown): string {
    const links = this.browserLinks()
    if (typeof value !== 'string' || !value || (value !== links.localUrl && !links.lanUrls.includes(value))) throw new Error('Browser address is unavailable')
    return value
  }

  async close(): Promise<void> {
    this.closing = true
    // Before the Host stops: a Host that dies of OOM while stopping is still recorded.
    this.memory.stop()
    const end = this.diagnostics.operation('desktop', 'backend.close')
    try { await this.backend.close(); end() } catch (error) { end(error); throw error }
    this.cleanupSafeHome()
    // A report started just before quitting is completed, not left partially written.
    await this.failureReportWrite
    await this.failureEvidenceWrite
    await this.operationHistory?.close()
    this.diagnostics.flush()
  }

  /** Save what opened recovery as one attachable file; recovery remains usable when it cannot be saved. */
  private saveFailureReport(error: unknown, stage: DesktopFailureStage): void {
    const report: DesktopFailureReport = { status: 'pending' }
    this.failureReport = report
    // Sample at report time, which is as close to the failure as the window allows; the evidence
    // follows the written report so the basic file never waits for it.
    const sampling = this.sampleRenderer()
    const launch = Object.entries(this.diagnostics.launch ?? {}).flatMap(([name, value]) => value === undefined ? [] : [[name, String(value)] as const])
    // A Host failure names the run whose plugin operation records the appended history shows.
    const hostRun = stage === 'host-boot' || stage === 'host-runtime' ? this.operationHistory?.runId : undefined
    const input: FailureReportInput = {
      time: new Date(), stage, failure: this.failure,
      facts: [['run', this.diagnostics.runId], ...(hostRun === undefined ? [] : [['host run', hostRun] as const]), ...launch, ['arch', process.arch], ['profile', this.selected]],
      hostDiagnostic: error instanceof DesktopHostFatalError ? error.diagnostic : undefined,
      // The Host's own diagnostic, or its exit code and stderr tail, describe a Host failure; a shell error adds its stack.
      error: error instanceof Error && !(error instanceof DesktopHostFatalError) && !(error instanceof DesktopHostExitError)
        && !(error instanceof DesktopHostStartupTimeoutError) ? error : undefined,
      startup: this.failureTimeout,
      log: this.diagnostics.snapshot(true),
      auxiliary: this.operationHistory?.reportNote,
    }
    this.failureContext = renderFailureReport(input)
    this.failureReportWrite = writeFailureReport(dirname(this.diagnostics.file), input).then((file) => {
      if (this.failureReport === report) this.failureReport = { status: 'saved', file }
      this.diagnostics.record({ source: 'desktop', event: 'failure-report.saved', fields: { stage, file } })
      // Recent plugin operations follow the basic report, which stays complete without them.
      this.operationHistory?.append(file)
      this.failureEvidenceWrite = this.appendRendererEvidence(file, sampling)
    }, (cause: unknown) => {
      if (this.failureReport === report) this.failureReport = { status: 'failed' }
      this.diagnostics.record({ source: 'desktop', event: 'failure-report.failed', level: 'warn', error: cause, fields: { stage } })
      this.failureEvidenceWrite = this.appendRendererEvidence(undefined, sampling)
    })
  }

  /** Take the renderer sample a failure report appends; never rejects. */
  private sampleRenderer(): Promise<RendererDiagnostics> {
    let target: RendererDiagnosticsTarget | undefined
    try { target = this.options.renderer?.() } catch { target = undefined }
    return collectRendererDiagnostics(target, { sampleMs: RENDERER_FAILURE_SAMPLE_MS, timeoutMs: RENDERER_FAILURE_TIMEOUT_MS })
  }

  /**
   * Append the renderer evidence to a saved report. The sample can be missing or unavailable, which
   * the report states instead; losing it only costs that section.
   * @param file - the saved report, or undefined when it could not be written.
   * @param sampling - the sample taken when the report was written.
   */
  private async appendRendererEvidence(file: string | undefined, sampling: Promise<RendererDiagnostics>): Promise<void> {
    try {
      const renderer = await sampling
      const lastKnown = this.options.rendererEvidence?.()
      // The log keeps the sample even when no file could receive the section.
      this.diagnostics.record({ source: 'renderer', event: 'failure.snapshot',
        fields: { ...rendererDiagnosticsFields(renderer), lastKnownAgeMs: lastKnown?.ageMs ?? null } })
      const section = rendererFailureSection(renderer, lastKnown)
      if (section === '' || file === undefined) return
      await appendFailureReport(file, section)
    } catch (cause) {
      this.diagnostics.record({ source: 'desktop', event: 'failure-report.evidence-failed', level: 'warn', error: cause, fields: { section: 'renderer' } })
    }
  }

  private cleanupSafeHome(): void {
    const home = this.safeHome
    if (!home) return
    this.safeHome = undefined
    try {
      // Share Stable/Beta's explicit junction unlinking and bounded retries.
      cleanupDisposableTree(home)
    } catch (error) {
      // Temporary files must not prevent relaunch or returning to the original Profile.
      this.diagnostics.append(`Safe mode temporary directory cleanup failed (${home}): ${String(error)}`, 'warn')
    }
  }

  /**
   * Watch one Host start against its limit. A start allowed more than a minute, or no limit, tells the user
   * once after a minute where recovery is; at the limit the start fails, naming what the Host still loads.
   * @param host - The starting Host, asked which Loader entries hold it.
   * @param limit - Seconds, or `'none'` to wait for the Host like upstream Desktop.
   * @returns `expired`, which rejects at the limit and never settles without one, and `settle`, which ends the watch.
   */
  private watchStartup(host: DesktopHostProcess, limit: HostStartupTimeout): { expired: Promise<never>; settle(): void } {
    const timers: ReturnType<typeof setTimeout>[] = []
    let settled = false
    let withdraw: (() => void) | undefined
    const after = (delay: number, act: () => Promise<void>): void => {
      const timer = setTimeout(() => { void act() }, delay)
      timer.unref()
      timers.push(timer)
    }
    const pending = async (event: string, level: 'warn' | 'error'): Promise<{ entries?: readonly DesktopStartupEntry[]; unanswered?: string }> => {
      let answer: { entries?: readonly DesktopStartupEntry[]; unanswered?: string }
      try { answer = { entries: await host.startupEntries() } } catch (error) {
        answer = { unanswered: error instanceof Error ? error.message : String(error) }
      }
      if (!settled) {
        this.diagnostics.record({ source: 'desktop', event, level, message: startupEntriesSummary(answer.entries, answer.unanswered),
          fields: { limit, pending: answer.entries?.length ?? null }, data: { entries: answer.entries ?? null } })
      }
      return answer
    }
    if (limit === 'none' || limit * 1000 > HOST_STARTUP_NOTICE_MS) {
      after(HOST_STARTUP_NOTICE_MS, async () => {
        const { entries } = await pending('host.start.slow', 'warn')
        if (settled) return
        try { withdraw = this.options.onStartupSlow?.({ limit, pending: entries }) } catch (error) {
          this.diagnostics.append(`Startup notice: ${String(error)}`, 'warn')
        }
      })
    }
    const expired = new Promise<never>((_resolve, reject) => {
      if (limit === 'none') return
      after(limit * 1000, async () => {
        const { entries, unanswered } = await pending('host.start.pending', 'error')
        if (!settled) reject(new DesktopHostStartupTimeoutError(limit, entries, unanswered))
      })
    })
    // A start that settles while the Host is being asked leaves this rejection to nobody.
    expired.catch(() => {})
    return { expired, settle: () => {
      settled = true
      for (const timer of timers) clearTimeout(timer)
      withdraw?.()
    } }
  }

  private createHost(onFailure: (error: Error) => void) {
    const { options } = this
    const actualHome = this.safeMode ? this.safeHome! : options.home
    const profile = this.safeMode ? DEFAULT_PROFILE : this.selected
    const effective = this.safeMode ? { ...SAFE_MODE_PREFERENCES } : this.preferences
    const addresses = options.addresses()
    const token = randomBytes(32).toString('base64url')
    const lan = new DesktopLanHttpsRuntime({ addresses, requestedPort: effective.lanPort,
      prepareCertificate: async () => ({ certificate: await options.certificate(addresses) }) })
    this.lan = lan
    let stopped = false
    const host = new DesktopHostProcess(options.executable, options.root, new NextProfiles(actualHome).directory(profile), undefined,
      { ...process.env, DSH_HOME: actualHome, DSH_NEXT_NATIVE_TOKEN: token,
        DSH_NEXT_PREFERENCES: JSON.stringify(effective), DSH_NEXT_TRUSTED_HOSTS: JSON.stringify(addresses),
        [SYSTEM_PROXY_ENV]: JSON.stringify(options.systemProxy?.() ?? {}),
        ...(this.safeMode ? { DSH_TELEMETRY_DISABLED: '1' } : {}) },
      onFailure, options.primaryRuntime, undefined, join(options.root, 'lib', 'host.js'), options.onRestart, options.onNotification,
      (chunk, stream, pid) => this.diagnostics.hostChunk(chunk, stream, pid), options.onTerminal, options.onPermission, options.onPlatformSession, options.onPlatformLogin,
      input => { if (input.event === 'exit') this.diagnostics.hostClosed(input.pid); this.diagnostics.record(input) },
      { memory: (usage, pid) => { this.memory.hostMemory(usage, pid) }, exited: (exit, pid) => { this.memory.hostExited(exit, pid) },
        ...(this.operationHistory === undefined ? {} : { operation: this.operationHistory.host() }) }, options.anywhere)
    this.hostProcess = host
    return {
      start: async (): Promise<void> => {
        const limit = effective.hostStartupTimeout
        const started = this.diagnostics.operation('desktop', 'host.start', { profile, safeMode: this.safeMode, limit })
        const watch = this.watchStartup(host, limit)
        try {
          const ready = await Promise.race([host.start(), watch.expired]).finally(() => { watch.settle() })
          const url = new URL(ready.url)
          if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1') throw new Error('Next Host must use loopback HTTP')
          if (!ready.injections) throw new Error('Next Host omitted Web boot injections')
          const cookie = await authenticateWebHost(ready.url, token)
          if (stopped) { started(); return }
          this.auth = { url: ready.url, cookie, token, injections: ready.injections }
          lan.attach(Number(url.port))
          if (effective.browserAccess && effective.networkExposure === 'lan') {
            const edge = await lan.setEnabled(true)
            if (stopped) { await lan.stop(); started(); return }
            // The optional LAN edge must not turn a ready loopback Host into recovery mode.
            if (edge.state === 'failed') this.diagnostics.append(`LAN HTTPS: ${edge.errorCode}`, 'warn')
          }
          if (!this.safeMode) {
            try { this.recovery.checkpoint(this.selected) } catch (error) { this.diagnostics.append(`Recovery checkpoint: ${String(error)}`, 'warn') }
          }
          started()
          // From here a Host failure stops a running Desktop rather than its startup.
          this.hostStage = 'host-runtime'
          this.diagnostics.append(`Host ready: ${profile}${this.safeMode ? ' (safe mode)' : ''}`)
        } catch (error) { started(error); throw error }
      },
      stop: async (): Promise<void> => {
        stopped = true
        this.auth = undefined
        const edgeStopped = this.diagnostics.operation('desktop', 'lan.stop')
        try { await lan.stop(); edgeStopped() } catch (error) { edgeStopped(error); throw error }
        const hostStopped = this.diagnostics.operation('desktop', 'host.stop')
        try { await host.stop(); hostStopped() } catch (error) { hostStopped(error); throw error }
        if (this.hostProcess === host) this.hostProcess = undefined
        if (this.lan === lan) this.lan = undefined
      },
    }
  }
}
