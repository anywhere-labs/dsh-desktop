/**
 * Quit-time inspection of interruptible work and armed scheduled reminders for the Electron shell, as upstream
 * Desktop's Host answers it (`apps/desktop-host/src/quit-inspection.ts` with the active-work rule of its
 * `update-tasks.ts`).
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-schedule'

/** What quitting the Host now would affect. */
export interface DesktopQuitInspection {
  /** Running agents, queued messages and live jobs, by upstream Desktop's update-restart rule. */
  readonly activeTasks: boolean
  /** A loaded session holds a scheduled reminder whose timer is armed in this process. */
  readonly scheduledTasks: boolean
}

/**
 * Whether stopping the Host now would interrupt work: a generating or tool-running
 * agent (including subagents and turns waiting for approval), queued inbox
 * messages, or a running or stopping background job.
 * @param liveAgents - Current agent roster.
 * @param jobs - Job registry queried for the global roster and each agent's own jobs.
 * @returns true when any of those conditions holds.
 */
export function hasDesktopActiveTasks(liveAgents: ReturnType<Context['agents']['list']>, jobs: Context['jobs']): boolean {
  return liveAgents.some(agent => agent.status === 'running'
    || agent.inbox.nextTurn.length > 0 || agent.inbox.nextStep.length > 0)
    || [undefined, ...liveAgents].some(agent => jobs.list(agent?.id)
      .some(job => job.status === 'running' || job.status === 'stopping'))
}

/**
 * Register the quit inspector on the owning Host context.
 * @param ctx - Booted Desktop profile context; disposal makes the inspector reject.
 * @returns Inspector reporting active tasks together with armed reminders of the loaded sessions
 *   (the `schedule` family of `workspace/session-activity`); reminders in sessions that were never
 *   loaded during this run cannot fire and are not counted.
 */
export function installDesktopQuitInspection(ctx: Context): () => Promise<DesktopQuitInspection> {
  let stopped = false
  ctx.effect(() => () => { stopped = true })
  return async () => {
    if (stopped) throw new Error('desktop quit: Host is stopping')
    const agents = ctx.get('agents')
    const jobs = ctx.get('jobs')
    if (agents === undefined || jobs === undefined) throw new Error('desktop quit: task services are unavailable')
    const liveAgents = agents.list()
    const activeTasks = hasDesktopActiveTasks(liveAgents, jobs)
    let scheduledTasks = false
    for (const agent of liveAgents) {
      const activity = await ctx.waterfall('workspace/session-activity', { sessionId: agent.id }, () => Promise.resolve([]))
      if (activity.some(entry => entry.kind === 'schedule')) { scheduledTasks = true; break }
    }
    return { activeTasks, scheduledTasks }
  }
}
