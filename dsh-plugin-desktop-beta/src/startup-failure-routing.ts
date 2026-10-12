/** Headless decision table for failures raised while Electron main is starting. */

import type { DesktopStartupFailureStage } from './startup-recovery-window.ts'

export type DesktopStartupFailureRoute = 'stderr-only' | 'startup-recovery'

export interface DesktopStartupFailureContext {
  readonly appReady: boolean
  readonly stage: DesktopStartupFailureStage
}

/**
 * Route one startup exception without inspecting its message. Error strings are
 * diagnostics, never authority for deciding whether Desktop may mutate state.
 */
export function routeDesktopStartupFailure(
  context: DesktopStartupFailureContext,
): DesktopStartupFailureRoute {
  if (!context.appReady) return 'stderr-only'
  return 'startup-recovery'
}
