/**
 * Fixed launch-argument choices Desktop offers for rows of an official bundle. The Host applies a choice through the
 * official configuration editor, and the Plugins page shows the choices on the row's configuration page. Shared by
 * the Host and the renderer, so this module imports nothing.
 */

/** Copy in the two languages Desktop's own pages use. */
export interface BilingualText {
  readonly zh: string
  readonly en: string
}

/** One choice: the complete `launchArgs` the row starts with. */
export interface LaunchPreset {
  readonly id: string
  readonly title: BilingualText
  readonly description: BilingualText
  readonly launchArgs: readonly string[]
  /** The bundle ships the row with this choice. */
  readonly shipped?: boolean
  /** The native agent runs without restriction; the page warns about it. */
  readonly unrestricted?: boolean
}

/** A row, by the id its bundle's patch declares, whose launch arguments Desktop sets from fixed choices. */
export interface LaunchPresetRow {
  readonly id: string
  /** Short name of what the row runs, tagged beside the row's title where the bundle's rows share one. */
  readonly tag: string
  readonly title: BilingualText
  readonly presets: readonly LaunchPreset[]
}

/** The official bundle whose rows offer launch choices. */
export interface LaunchPresetBundle {
  readonly bundle: string
  readonly rows: readonly LaunchPresetRow[]
}

/** Host route reading (GET) and applying (POST `{ row, preset }`) the launch choices. */
export const LAUNCH_PRESETS_ROUTE = '/api/desktop-next/launch-presets'

/** One row as the route reports it. */
export interface LaunchPresetState {
  readonly row: string
  /** Whether the row runs, so the configuration editor can change it. */
  readonly active: boolean
  /** The choice matching the row's current arguments; null when it runs with other arguments or not at all. */
  readonly preset: string | null
  /** Ids of the row's choices, in the order the page lists them. */
  readonly choices: readonly string[]
}

/**
 * Find the choice matching a row's current launch arguments.
 * @param row - the row's choices.
 * @param launchArgs - the `launchArgs` value of the row's current configuration.
 * @returns the matching choice, or undefined when the row runs with other arguments.
 */
export function matchLaunchPreset(row: LaunchPresetRow, launchArgs: unknown): LaunchPreset | undefined {
  if (!Array.isArray(launchArgs)) return undefined
  return row.presets.find(preset => preset.launchArgs.length === launchArgs.length
    && preset.launchArgs.every((arg, index) => arg === launchArgs[index]))
}
