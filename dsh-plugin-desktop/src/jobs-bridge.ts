/**
 * Edition-local adapter between the shared Desktop sources and the core job
 * registry's completion stream.
 *
 * Stable rides dsh 0.1.5-rc.2, whose registry exposes a dedicated
 * `onJobDone(listener)` seam handing out a terminal `JobSnapshot`. The Beta
 * channel's 0.1.7 core replaced both with one filtered event stream,
 * so the seam is edition-local while the narrowed outcome Desktop notifies on
 * stays identical.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-jobs'

/** Terminal state of one background job, narrowed to what Desktop notifies on. */
export type DesktopJobOutcome = 'completed' | 'failed' | 'other'

/** Narrow a core job status to the outcomes Desktop raises attention for. */
function desktopJobOutcome(status: string): DesktopJobOutcome {
  if (status === 'completed' || status === 'failed') return status
  return 'other'
}

/**
 * Observe the settlements of every job composed under this context's scope.
 * @param ctx - a context with the `jobs` service injected.
 * @param listener - receives each settled job's narrowed outcome.
 * @returns the disposer unregistering the observer.
 */
export function observeDesktopJobOutcomes(
  ctx: Context,
  listener: (outcome: DesktopJobOutcome) => void,
): () => void {
  return ctx.jobs.onJobDone((snapshot) => {
    listener(desktopJobOutcome(snapshot.status))
  })
}
