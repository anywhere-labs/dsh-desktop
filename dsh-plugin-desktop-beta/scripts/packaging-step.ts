/** Optional phase journal, following upstream Desktop's packaging-step.mjs event format. */
import { randomUUID } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { join } from 'node:path'

interface Phase {
  readonly directory: string
  readonly stage: string
  readonly stageId: string
  readonly started: number
}

function record(phase: Phase, event: object): void {
  appendFileSync(join(phase.directory, 'events.jsonl'), `${JSON.stringify({
    time: new Date().toISOString(), pid: process.pid, stage: phase.stage, stageId: phase.stageId, ...event,
  })}\n`, { flush: true })
}

function start(stage: string): Phase | undefined {
  const directory = process.env.DSH_DESKTOP_PACKAGING_RUN_DIR
  if (directory === undefined) return undefined
  const phase = { directory, stage, stageId: randomUUID(), started: performance.now() }
  record(phase, { type: 'stage-start' })
  return phase
}

function end(phase: Phase, success: boolean): void {
  // Keep the journal credential-free: labels and outcomes only, never arguments, environments or errors.
  record(phase, { type: 'stage-end', elapsedMs: performance.now() - phase.started, success })
}

/** Measure synchronous work without changing the caller's return value or failure. */
export function packagingStepSync<T>(stage: string, action: () => T): T {
  const phase = start(stage)
  if (phase === undefined) return action()
  let result: T
  try { result = action() } catch (error) { end(phase, false); throw error }
  end(phase, true)
  return result
}

/** Measure asynchronous work through settlement; nested phases keep independent identifiers. */
export async function packagingStep<T>(stage: string, action: () => Promise<T>): Promise<T> {
  const phase = start(stage)
  if (phase === undefined) return action()
  let result: T
  try { result = await action() } catch (error) { end(phase, false); throw error }
  end(phase, true)
  return result
}
