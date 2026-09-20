/** Desktop-owned response verbosity preference (issue #442). */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'

/** Stable Cordis plugin name. */
export const name = 'desktop-response-verbosity'

/** Standard settings namespace carrying the response verbosity preference. */
export const DESKTOP_RESPONSE_VERBOSITY_SETTINGS_NAMESPACE = 'dsh-desktop-response-verbosity'

/** User-facing response verbosity levels. `standard` preserves current behavior. */
export type DesktopResponseVerbosity = 'concise' | 'standard' | 'detailed'

/** Ordered verbosity levels accepted at settings boundaries. */
export const DESKTOP_RESPONSE_VERBOSITY_LEVELS = Object.freeze([
  'concise',
  'standard',
  'detailed',
] as const)

/** Durable response verbosity section shared by the Host schema and browser scope. */
export interface DesktopResponseVerbositySettings {
  /** Preferred response verbosity; defaults to `standard` (current behavior). */
  readonly verbosity: DesktopResponseVerbosity
}

export const DesktopResponseVerbositySettingsSchema: z<DesktopResponseVerbositySettings> = z.object({
  verbosity: z.union(['concise', 'standard', 'detailed'] as const).default('standard'),
})

const DEFAULT_SETTINGS = DesktopResponseVerbositySettingsSchema({} as DesktopResponseVerbositySettings)

/** Prompt section name owned by the Desktop verbosity preference. */
export const DESKTOP_RESPONSE_VERBOSITY_SECTION = 'desktop:response-verbosity'

/**
 * Parse the stored verbosity preference and reject values the schema cannot express.
 * @param value - untrusted stored verbosity value.
 * @returns the supported verbosity level, defaulting to `standard`.
 */
export function parseDesktopResponseVerbosity(value: unknown): DesktopResponseVerbosity {
  if (value === undefined) return 'standard'
  if (value === 'concise' || value === 'standard' || value === 'detailed') return value
  throw new Error('dsh-plugin-desktop: dsh-desktop-response-verbosity.verbosity must be "concise", "standard", or "detailed"')
}

/**
 * Render the model-facing verbosity guidance for one stored preference.
 * `standard` contributes nothing so existing behavior is byte-identical.
 * @param verbosity - resolved verbosity preference.
 * @returns section text, or an empty string when the preference is standard.
 */
export function desktopResponseVerbositySectionText(verbosity: DesktopResponseVerbosity): string {
  switch (verbosity) {
    case 'concise':
      return 'Prefer concise responses: answer briefly by default and keep process exposition minimal unless the user asks for detail.'
    case 'detailed':
      return 'Prefer detailed responses: explain the reasoning and relevant process detail without being asked.'
    case 'standard':
      return ''
  }
}

/** Register the live verbosity settings namespace plus its model-facing prompt section. */
export function apply(ctx: Context): void {
  let settings = DEFAULT_SETTINGS

  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(() => {
      const scope = settingsCtx.settings.register(
        DESKTOP_RESPONSE_VERBOSITY_SETTINGS_NAMESPACE,
        DesktopResponseVerbositySettingsSchema,
        { applies: 'live' },
      )
      settings = scope.get()
      const stopWatching = scope.watch((next) => { settings = next })
      return () => {
        stopWatching()
        settings = DEFAULT_SETTINGS
      }
    }, 'dsh-plugin-desktop: response verbosity settings')
  })

  ctx.inject(['systemPrompt'], (promptCtx) => {
    promptCtx.effect(() => promptCtx.systemPrompt.section({
      name: DESKTOP_RESPONSE_VERBOSITY_SECTION,
      order: promptCtx.systemPrompt.getSectionOrder('TEAM_POLICY'),
      text: () => desktopResponseVerbositySectionText(settings.verbosity),
    }), 'dsh-plugin-desktop: response verbosity prompt section')
  })
}
