/** Generation-scoped desktop profile discovery and restart-safe selection service. */

import { type Context, Service } from '@deepseek-ai/cordis'
import type { DesktopProfileSummary } from './profile-manager.ts'

/** Profile identity fixed for one running Cordis generation. */
export interface DesktopCurrentProfile {
  /** Name passed to the profile launcher. */
  readonly name: string
  /** Absolute directory backing the active profile. */
  readonly dir: string
}

/** A persisted Profile target whose restart timing belongs to the caller. */
export interface DesktopProfileSelection {
  /** Whether another generation is required to make the selection effective. */
  readonly restartRequired: boolean
  /** Request the one orderly restart associated with this selection. */
  restart(): Promise<void>
}

/** Supported profile-management capability available to Desktop Host plugins. */
export interface DesktopProfiles {
  /** Immutable identity of the profile backing this Cordis generation. */
  readonly current: DesktopCurrentProfile
  /** Create a safe Web profile without selecting or restarting it. */
  create(name: string): DesktopProfileSummary
  /** Re-read the available profile manifests without changing them. */
  list(): readonly DesktopProfileSummary[]
  /** Validate and persist a Profile while leaving restart timing to the caller. */
  prepareSelection(name: string): Promise<DesktopProfileSelection>
  /** Persist a compatible profile and request an orderly application restart. */
  select(name: string): Promise<void>
  /** Whether one inactive user profile can be safely removed now. */
  canDelete(name: string): boolean
  /** Remove one inactive user profile through the launcher boundary. */
  delete(name: string): Promise<void>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Generation-scoped profile identity, discovery, and restart-safe selection. */
    desktopProfiles: DesktopProfiles
  }
}

/** Launcher operations delegated through one service lifetime. */
export interface DesktopProfileServiceBootstrap {
  /** Profile that produced the current Cordis generation. */
  readonly current: DesktopCurrentProfile
  /** Create a safe Web profile without selecting or restarting it. */
  create?: (name: string) => DesktopProfileSummary
  /** Re-read the available profile manifests without changing them. */
  list(): readonly DesktopProfileSummary[]
  /** Persist one validated Profile for the next startup. */
  persistSelection(name: string): void | Promise<void>
  /** Request orderly teardown followed by an Electron relaunch. */
  requestRestart(): void | Promise<void>
  /** Whether one profile passes the synchronous deletion checks. */
  canDelete?: (name: string) => boolean
  /** Remove one profile after re-reading selection and recovery state. */
  delete?: (name: string) => void | Promise<void>
}

interface SelectionOperation {
  readonly name: string
  readonly promise: Promise<DesktopProfileSelection>
}

/**
 * Cordis service that exposes the active profile and owns profile-switch ordering.
 *
 * Selection is serialized for the service lifetime. The first selection whose
 * persistence succeeds becomes the committed target; a different concurrent
 * target cannot replace it while restart is pending. A persistence failure
 * releases the slot, while a restart failure retains the committed target so a
 * retry cannot overwrite the persisted selection.
 */
export class DesktopProfileService extends Service implements DesktopProfiles {
  private readonly fixedCurrent: DesktopCurrentProfile
  private disposed = false
  private operation: SelectionOperation | undefined
  private committedName: string | undefined
  private committedSelection: DesktopProfileSelection | undefined
  private restartOperation: Promise<void> | undefined
  private restartCompleted = false
  private readonly immediateSelections = new Map<string, Promise<void>>()

  /**
   * Register the launcher-backed capability as `ctx.desktopProfiles`.
   * @param ctx - Cordis context owning this exact service lifetime.
   * @param bootstrap - generation identity and launcher operations.
   */
  constructor(ctx: Context, private readonly bootstrap: DesktopProfileServiceBootstrap) {
    super(ctx, 'desktopProfiles')
    this.fixedCurrent = Object.freeze({ ...bootstrap.current })
    ctx.effect(
      () => () => { this.disposed = true },
      'dsh-plugin-desktop: profile service lifetime',
    )
  }

  /** Active profile identity for this generation. */
  get current(): DesktopCurrentProfile {
    this.assertActive()
    return this.fixedCurrent
  }

  /** Create a profile through the launcher-owned implementation. */
  create(name: string): DesktopProfileSummary {
    this.assertActive()
    if (this.bootstrap.create === undefined) {
      throw new Error('dsh-plugin-desktop: profile creation is unavailable')
    }
    return this.bootstrap.create(name)
  }

  /** Re-read profile discovery through the launcher-owned implementation. */
  list(): readonly DesktopProfileSummary[] {
    this.assertActive()
    return this.bootstrap.list()
  }

  /** Persist another Profile and return a handle that controls restart timing. */
  prepareSelection(name: string): Promise<DesktopProfileSelection> {
    try {
      this.assertActive()
      if (name === this.fixedCurrent.name) {
        return Promise.resolve(Object.freeze({
          restartRequired: false,
          restart: async () => {},
        }))
      }

      const running = this.operation
      if (running !== undefined) {
        if (running.name === name) return running.promise
        return running.promise.then(
          () => this.prepareSelection(name),
          () => this.prepareSelection(name),
        )
      }

      if (this.committedName !== undefined) {
        if (name !== this.committedName) return Promise.reject(this.committedSelectionError(name))
        if (this.committedSelection === undefined) {
          return Promise.reject(new Error('dsh-plugin-desktop: committed Profile selection is unavailable'))
        }
        return Promise.resolve(this.committedSelection)
      }

      return this.runExclusive(name, async () => {
        await this.bootstrap.persistSelection(name)
        this.committedName = name
        this.committedSelection = Object.freeze({
          restartRequired: true,
          restart: () => this.restartSelection(name),
        })
        this.assertActive()
        return this.committedSelection
      })
    } catch (cause) {
      return Promise.reject(cause)
    }
  }

  /** Persist another Profile and request restart immediately after persistence. */
  select(name: string): Promise<void> {
    try {
      this.assertActive()
      const running = this.immediateSelections.get(name)
      if (running !== undefined) return running
      const promise = this.committedName === name && this.committedSelection !== undefined
        ? this.committedSelection.restart()
        : this.prepareSelection(name).then(selection => selection.restart())
      this.immediateSelections.set(name, promise)
      const release = (): void => {
        if (this.immediateSelections.get(name) === promise) this.immediateSelections.delete(name)
      }
      void promise.then(release, release)
      return promise
    } catch (cause) {
      return Promise.reject(cause)
    }
  }

  canDelete(name: string): boolean {
    this.assertActive()
    if (this.isSelectionTarget(name)) return false
    if (this.bootstrap.canDelete === undefined) return false
    return this.bootstrap.canDelete(name)
  }

  async delete(name: string): Promise<void> {
    this.assertActive()
    if (this.isSelectionTarget(name)) {
      throw new Error(`dsh-plugin-desktop: selected profile ${JSON.stringify(name)} cannot be deleted`)
    }
    if (this.bootstrap.delete === undefined) {
      throw new Error('dsh-plugin-desktop: profile deletion is unavailable')
    }
    await this.bootstrap.delete(name)
    this.assertActive()
  }

  /** Run one target transition while retaining exact promise identity for duplicate callers. */
  private runExclusive(
    name: string,
    invoke: () => Promise<DesktopProfileSelection>,
  ): Promise<DesktopProfileSelection> {
    const promise = invoke()
    const operation = { name, promise }
    this.operation = operation
    const release = (): void => {
      if (this.operation === operation) this.operation = undefined
    }
    void promise.then(release, release)
    return promise
  }

  /** Request or join the restart for the committed Profile target. */
  private restartSelection(name: string): Promise<void> {
    try {
      this.assertActive()
      if (name !== this.committedName) return Promise.reject(this.committedSelectionError(name))
      if (this.restartCompleted) return Promise.resolve()
      if (this.restartOperation !== undefined) return this.restartOperation
      const promise = Promise.resolve(this.bootstrap.requestRestart()).then(() => {
        this.restartCompleted = true
      })
      this.restartOperation = promise
      const release = (): void => {
        if (this.restartOperation === promise) this.restartOperation = undefined
      }
      void promise.then(release, release)
      return promise
    } catch (cause) {
      return Promise.reject(cause)
    }
  }

  /** Protect both an in-flight persistence target and the committed target. */
  private isSelectionTarget(name: string): boolean {
    return this.operation?.name === name || this.committedName === name
  }

  /** Reject a target that would overwrite the Profile already selected for restart. */
  private committedSelectionError(name: string): Error {
    return new Error(
      `dsh-plugin-desktop: profile ${JSON.stringify(this.committedName)} is already selected for restart; `
      + `cannot select ${JSON.stringify(name)} before restart`,
    )
  }

  /** Reject calls through a retained reference after the owning fiber unloads. */
  private assertActive(): void {
    if (this.disposed) throw new Error('dsh-plugin-desktop: desktopProfiles service disposed')
  }
}

export default DesktopProfileService
