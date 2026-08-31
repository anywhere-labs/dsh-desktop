import { watch } from 'chokidar'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'

/**
 * Desktop-owned live patch-layer watcher.
 *
 * `dsh web` re-applies `<profile>/cordis.patch.yml` through `watchUserPatches`,
 * which rides on the Cordis HMR service. The packaged desktop host keeps
 * `loader.internal` cleared and ships the HMR row disabled, so it cannot use
 * that path. This module watches the same files with chokidar and re-applies
 * the full patch list through the loader's own transactional entry update —
 * the root include entry re-applies its patches over the empty root, exactly
 * like boot composition, with rollback when the new composition fails.
 */

/** The slice of the Cordis context the watcher depends on. */
export interface DesktopPatchWatchHost {
  loader: {
    resolve(id: string): RootIncludeEntry | undefined
  }
  logger: {
    info(message: string): void
    error(message: string): void
  }
}

/** The root include entry surface used for re-application. */
export interface RootIncludeEntry {
  options: { config?: unknown }
  update(options: { config: RootIncludeConfig }): Promise<unknown>
}

/** The root include entry config shape installed by `mountRootInclude`. */
export interface RootIncludeConfig {
  path: string
  patches?: PatchOptions[]
}

export interface DesktopPatchWatcherOptions {
  /** Diagnostic prefix used in log lines. */
  binName: string
  /** Absolute paths of the patch files to watch (add/change/unlink). */
  filenames: string[]
  /** Recompute the complete ordered patch list for the current generation. */
  compose: () => PatchOptions[]
  /** Coalescing window for editor save-replace bursts, in milliseconds. */
  debounceMs?: number
}

function describeCause(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Watch the desktop patch layer and transactionally re-apply it on change.
 *
 * The returned disposer closes the watcher and waits for any in-flight
 * re-apply; wire it through `ctx.effect()` so generation teardown disposes it.
 * A malformed patch file or a composition failure is logged loudly while the
 * previous generation stays mounted (the loader entry update rolls back).
 */
export async function watchDesktopPatchLayer(
  host: DesktopPatchWatchHost,
  options: DesktopPatchWatcherOptions,
): Promise<() => Promise<void>> {
  const { binName, filenames, compose, debounceMs = 150 } = options
  const include = host.loader.resolve('include')
  const includeConfig = include?.options.config as RootIncludeConfig | undefined
  if (include === undefined || typeof includeConfig?.path !== 'string') {
    throw new Error(`${binName}: root include entry is unavailable for patch-layer watching`)
  }

  let pending: ReturnType<typeof setTimeout> | undefined
  let refreshing: Promise<void> = Promise.resolve()

  const refresh = async (): Promise<void> => {
    const patches = compose()
    const current = include.options.config as RootIncludeConfig
    await include.update({
      config: {
        ...current,
        patches,
      },
    })
    host.logger.info(`${binName}: re-applied desktop patch layer (${patches.length} entries)`)
  }

  const schedule = (): void => {
    if (pending !== undefined) clearTimeout(pending)
    pending = setTimeout(() => {
      pending = undefined
      refreshing = refreshing.then(
        async () => {
          try {
            await refresh()
          } catch (cause) {
            host.logger.error(
              `${binName}: failed to re-apply desktop patch layer, keeping previous generation: ${describeCause(cause)}`,
            )
          }
        },
        async () => {},
      )
    }, debounceMs)
  }

  const watcher = watch(filenames, { ignoreInitial: true })
  watcher.on('add', schedule)
  watcher.on('change', schedule)
  watcher.on('unlink', schedule)
  await new Promise<void>((resolve, reject) => {
    watcher.once('ready', () => { resolve() })
    watcher.once('error', (cause) => { reject(cause instanceof Error ? cause : new Error(String(cause))) })
  })
  // Chokidar can attribute same-tick writes to the initial scan; settle one
  // tick so the first real edit is always observed as a change.
  await new Promise(resolve => setImmediate(resolve))
  host.logger.info(`${binName}: watching desktop patch layer (${filenames.join(', ')})`)

  return async () => {
    if (pending !== undefined) clearTimeout(pending)
    pending = undefined
    await watcher.close()
    await refreshing
  }
}
