/** Generation-scoped ownership for update polling, prompts, downloads, and disposal. */

import { open } from 'node:fs/promises'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {
  DesktopLocale,
  DesktopNotification,
  DesktopTrayItem,
  DesktopTrayItemRegistration,
  DesktopUpdateAdapter,
} from './runtime.ts'
import { desktopTrayLabel } from './tray-locale.ts'
import {
  checkForStableUpdate,
  parseSemVer,
  type UpdateCheckResult,
} from './update-checker.ts'

const MAX_STATE_BYTES = 4 * 1024

/** Validated scheduling and request policy for one update lifecycle. */
export interface DesktopUpdatePolicy {
  readonly enabled: boolean
  readonly initialDelayMs: number
  readonly intervalMs: number
  readonly requestTimeoutMs: number
}

/** Native capabilities supplied when one Host generation mounts update handling. */
export interface DesktopUpdateLifecycleOptions {
  readonly adapter: DesktopUpdateAdapter
  readonly policy: DesktopUpdatePolicy
  readonly locale: () => DesktopLocale
  readonly registerTrayItem: (item: DesktopTrayItem) => DesktopTrayItemRegistration
}

/** Lifecycle handle for one generation's update operations. */
export interface DesktopUpdateLifecycle {
  /** Run the same interactive update flow exposed by the native tray. */
  checkNow(): Promise<void>
  dispose(): Promise<void>
}

interface UpdateStateV3 {
  readonly version: 3
  readonly lastNotifiedVersion?: string
}

interface ParsedUpdateState {
  readonly state: UpdateStateV3
  readonly migrated: boolean
}

const EMPTY_STATE: UpdateStateV3 = { version: 3 }

/** Start one update lifecycle whose mutable state and work are released together. */
export function startDesktopUpdateLifecycle(
  options: DesktopUpdateLifecycleOptions,
): DesktopUpdateLifecycle {
  return new DesktopUpdateLifecycleOwner(options)
}

class DesktopUpdateLifecycleOwner implements DesktopUpdateLifecycle {
  private disposed = false
  private disposeTask: Promise<void> | undefined
  private checking = false
  private availableVersion: string | undefined
  private downloadingVersion: string | undefined
  private state: UpdateStateV3 = EMPTY_STATE
  private pollTimer: ReturnType<typeof setTimeout> | undefined
  private requestTimer: ReturnType<typeof setTimeout> | undefined
  private requestController: AbortController | undefined
  private downloadController: AbortController | undefined
  private checkTask: Promise<UpdateCheckResult | null> | undefined
  private manualTask: Promise<void> | undefined
  private downloadTask: Promise<void> | undefined
  private readonly stateReady: Promise<void>
  private readonly registration: DesktopTrayItemRegistration

  constructor(private readonly options: DesktopUpdateLifecycleOptions) {
    this.stateReady = this.loadState()
    this.registration = options.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => this.trayLabel(),
      invoke: () => this.checkNow(),
    })
    if (options.adapter.isPackaged && options.policy.enabled) {
      this.scheduleBackgroundCheck(options.policy.initialDelayMs)
    }
  }

  dispose(): Promise<void> {
    if (this.disposeTask !== undefined) return this.disposeTask
    this.disposed = true
    if (this.pollTimer !== undefined) clearTimeout(this.pollTimer)
    if (this.requestTimer !== undefined) clearTimeout(this.requestTimer)
    this.requestController?.abort()
    this.downloadController?.abort()
    this.registration.dispose()
    // Native dialogs are not cancellable. Await only file state and the abortable version request.
    const pending: Promise<unknown>[] = [this.stateReady]
    if (this.checkTask !== undefined) pending.push(this.checkTask)
    this.disposeTask = Promise.allSettled(pending).then(() => {})
    return this.disposeTask
  }

  checkNow(): Promise<void> {
    return this.runManualCheck()
  }

  private async loadState(): Promise<void> {
    try {
      const parsed = parseState(await readState(this.options.adapter.statePath))
      this.state = parsed.state
      if (parsed.migrated && !this.disposed) await this.persistState()
    } catch (cause) {
      if (isEnoent(cause)) return
      this.state = EMPTY_STATE
      if (!this.disposed) await this.persistState()
    }
  }

  private async persistState(): Promise<void> {
    try {
      await writeFileAtomic(this.options.adapter.statePath, renderState(this.state), {
        mode: 0o600,
        dirMode: 0o700,
      })
    } catch {
      // Update state is optional; failures must not affect application startup or user activity.
    }
  }

  private async announceBackgroundUpdate(version: string): Promise<void> {
    await this.stateReady
    if (this.disposed || this.state.lastNotifiedVersion === version) return
    this.state = { version: 3, lastNotifiedVersion: version }
    await this.persistState()
    if (!this.disposed) this.options.adapter.notify(updateAvailableNotification(this.options.locale(), version))
  }

  private startCheck(): Promise<UpdateCheckResult | null> {
    if (this.checkTask !== undefined) return this.checkTask
    this.checking = true
    this.registration.refresh()
    const controller = new AbortController()
    this.requestController = controller

    const task = (async () => {
      this.requestTimer = setTimeout(() => {
        controller.abort()
      }, this.options.policy.requestTimeoutMs)
      try {
        return await checkForStableUpdate({
          currentVersion: this.options.adapter.currentVersion,
          ...(this.options.adapter.installationId === undefined
            ? {}
            : { installationId: this.options.adapter.installationId }),
          signal: controller.signal,
          request: this.options.adapter.request,
        })
      } catch {
        return null
      }
    })().finally(() => {
      if (this.requestTimer !== undefined) clearTimeout(this.requestTimer)
      this.requestTimer = undefined
      if (this.requestController === controller) this.requestController = undefined
      this.checkTask = undefined
      this.checking = false
      this.registration.refresh()
    })
    this.checkTask = task
    return task
  }

  private observeResult(result: UpdateCheckResult | null): string | undefined {
    if (this.disposed || result === null) return undefined
    this.availableVersion = result.status === 'update-available' && this.options.adapter.canDownload
      ? result.latestVersion
      : undefined
    this.registration.refresh()
    return this.availableVersion
  }

  private startDownload(version: string): Promise<void> {
    if (this.downloadTask !== undefined) return this.downloadTask
    const task = (async () => {
      let confirmed: boolean
      try {
        confirmed = await this.options.adapter.confirmDownload(version)
      } catch {
        return
      }
      if (!confirmed || this.disposed) return

      const confirmedVersion = this.observeResult(await this.startCheck())
      if (confirmedVersion !== version || this.disposed) return

      const controller = new AbortController()
      this.downloadController = controller
      this.downloadingVersion = version
      this.registration.refresh()
      try {
        await this.options.adapter.downloadAndOpen(version, controller.signal)
      } catch {
        // Network, filesystem, and installer-opening failures are deliberately silent.
      } finally {
        if (this.downloadController === controller) this.downloadController = undefined
        this.downloadingVersion = undefined
        this.registration.refresh()
      }
    })().finally(() => {
      if (this.downloadTask === task) this.downloadTask = undefined
    })
    this.downloadTask = task
    return task
  }

  private async offerDownload(version: string): Promise<void> {
    if (this.disposed || !this.options.adapter.canDownload) return
    await this.startDownload(version)
  }

  private runManualCheck(): Promise<void> {
    this.manualTask ??= (async () => {
      if (this.availableVersion !== undefined) {
        await this.offerDownload(this.availableVersion)
        return
      }
      const result = await this.startCheck()
      if (this.disposed) return
      const version = this.observeResult(result)
      if (version !== undefined) {
        await this.offerDownload(version)
        return
      }
      await this.options.adapter.showManualCheckResult(result)
    })().catch(() => undefined).finally(() => {
      this.manualTask = undefined
    })
    return this.manualTask
  }

  private async runBackgroundCheck(): Promise<void> {
    if (this.checkTask !== undefined || this.disposed) return
    try {
      const version = this.observeResult(await this.startCheck())
      if (version !== undefined) await this.announceBackgroundUpdate(version)
    } catch {
      // Scheduled checks never surface failures to the user or the application log.
    }
  }

  private scheduleBackgroundCheck(delayMs: number): void {
    this.pollTimer = setTimeout(() => {
      this.pollTimer = undefined
      void this.runBackgroundCheck().finally(() => {
        if (!this.disposed) this.scheduleBackgroundCheck(this.options.policy.intervalMs)
      })
    }, delayMs)
  }

  private trayLabel(): string {
    if (this.downloadingVersion !== undefined) {
      return desktopTrayLabel(this.options.locale(), 'downloadingUpdate', this.downloadingVersion)
    }
    if (this.availableVersion !== undefined) {
      return desktopTrayLabel(this.options.locale(), 'updateAvailable', this.availableVersion)
    }
    return desktopTrayLabel(this.options.locale(), this.checking ? 'checkingForUpdates' : 'checkForUpdates')
  }
}

function parseState(text: string): ParsedUpdateState {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)) throw new Error('invalid update state')
  if (value.version === 3
    && (value.lastNotifiedVersion === undefined || isStableVersion(value.lastNotifiedVersion))
    && Object.keys(value).every(key => ['version', 'lastNotifiedVersion'].includes(key))) {
    return {
      state: value.lastNotifiedVersion === undefined
        ? EMPTY_STATE
        : { version: 3, lastNotifiedVersion: value.lastNotifiedVersion },
      migrated: false,
    }
  }
  if (value.version === 2
    && (value.lastPromptedVersion === undefined || isStableVersion(value.lastPromptedVersion))
    && Object.keys(value).every(key => ['version', 'lastPromptedVersion'].includes(key))) {
    return {
      state: value.lastPromptedVersion === undefined
        ? EMPTY_STATE
        : { version: 3, lastNotifiedVersion: value.lastPromptedVersion },
      migrated: true,
    }
  }
  throw new Error('invalid update state')
}

function updateAvailableNotification(locale: DesktopLocale, version: string): DesktopNotification {
  return locale === 'zh'
    ? { title: 'DSH Desktop 有可用更新', body: `版本 ${version} 已可下载。打开 DSH Desktop 即可继续。` }
    : { title: 'DSH Desktop Update Available', body: `Version ${version} is ready to download. Open DSH Desktop to continue.` }
}

async function readState(filename: string): Promise<string> {
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_STATE_BYTES) throw new Error(`update state exceeds ${MAX_STATE_BYTES} bytes`)
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function renderState(state: UpdateStateV3): string {
  return `${JSON.stringify(state, null, 2)}\n`
}

function isStableVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = parseSemVer(value)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoent(value: unknown): boolean {
  return isRecord(value) && value.code === 'ENOENT'
}
