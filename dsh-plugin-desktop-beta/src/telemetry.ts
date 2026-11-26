/**
 * Per-turn context and performance telemetry for DSH Desktop.
 *
 * The plugin is the live sink for {@link TurnFolder}: it folds the public
 * `session/event` stream and appends one JSONL record per finished turn to the
 * harness home. The record is the baseline a context change is judged against
 * — input/cache/output token surfaces, cache reuse, model and tool latency,
 * tool failures, and provider retries — so a fold, prune, or prompt-layout
 * change has to move a number rather than a feeling.
 *
 * Telemetry is local-only. It never leaves the machine and is never uploaded;
 * the upstream product-analytics rows stay disabled.
 *
 * @module dsh-plugin-desktop-beta/telemetry
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import z from '@deepseek-ai/schemastery'
import type { Session } from '@deepseek-ai/dsh-session'
import { TurnFolder, type TelemetryTurn } from './telemetry-fold.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-telemetry'

/** Telemetry destination and retention policy. */
export interface Config {
  /** Collect and persist turn records. When false the plugin does not subscribe. */
  enabled: boolean
  /** JSONL destination; empty resolves to `<dsh home>/logs/desktop-telemetry.jsonl`. */
  path: string
}

/** Validated telemetry destination and retention policy. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  path: z.string().default(''),
})

/**
 * Install the per-turn fold and the JSONL sink.
 * @param ctx - host context whose `session/event` stream carries the measurements.
 * @param config - validated destination and enablement values.
 */
export async function apply(ctx: Context, config: Config): Promise<void> {
  if (!config.enabled) return

  const file = config.path === ''
    ? dshHomePath('logs', 'desktop-telemetry.jsonl')
    : resolve(config.path)
  const folder = new TurnFolder()
  let writeFailed = false

  const persist = (turn: TelemetryTurn): void => {
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${JSON.stringify(turn)}\n`, 'utf8')
    } catch (error) {
      if (writeFailed) return
      writeFailed = true
      const message = error instanceof Error ? error.message : String(error)
      ctx.logger.warn(`desktop-telemetry: cannot append ${file}: ${message}`)
    }
  }

  ctx.on('session/event', (session: Session, event) => {
    const turn = folder.feed(String(session.id), event)
    if (turn !== undefined) persist(turn)
  })
}
