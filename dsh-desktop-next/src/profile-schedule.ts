/** Normalise the rc.2 Scheduled Tasks patch after v0.2.1-rc.5 retired the bundle. */
import { isMap, isSeq, parseDocument } from 'yaml'

/** Optional bundle the rc.2 shell selected; v0.2.1-rc.5 retired it and the Web composition mounts Schedule itself. */
export const SCHEDULE_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'

/** Rows the release removed from the Web composition; an override on one matches nothing and only warns. */
const RETIRED_ROWS: Readonly<Record<string, string>> = {
  // The clock reading belongs to the `standard`, `cordis`, and `ptc` presets.
  'time-context': '@deepseek-ai/dsh-time-context',
}

/**
 * Drop the entries a Profile patch carries for rows that no longer exist, and
 * return undefined when it carries none. Overrides on `schedule` and
 * `ui-schedule` are left as written: the Web composition still mounts both
 * rows, so `disabled: true` keeps a row the user turned off switched off.
 */
export function legacySchedulePatch(text: string): string | undefined {
  // Same comment-preserving dialect as the official manager; !!js is never evaluated here.
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors[0]) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  const items = document.contents.items
  const retired: number[] = []
  items.forEach((item, index) => {
    if (!isMap(item) || item.has('insert')) return
    const id = document.getIn([index, 'id'])
    if (typeof id !== 'string' || !Object.hasOwn(RETIRED_ROWS, id)) return
    const name = document.getIn([index, 'name'])
    if (name && name !== RETIRED_ROWS[id]) return
    retired.push(index)
  })
  if (!retired.length) return undefined
  for (const index of retired.reverse()) items.splice(index, 1)
  return String(document)
}
