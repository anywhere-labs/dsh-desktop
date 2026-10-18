/**
 * Retire the rc.2 Scheduled Tasks bundle while keeping the user's row choices.
 *
 * rc.2 offered the three Scheduled Tasks rows as an optional bundle. The 0.2.1
 * Web composition mounts `time-context`, `schedule` and `ui-schedule` in every
 * Web profile, so the bundle is gone and the rows have to be turned off
 * explicitly where the user had left them off.
 */
import { isMap, isScalar, isSeq, parseDocument } from 'yaml'

/** Bundle name 0.2.1 retired; stored manifests and patches may still carry it. */
export const RETIRED_SCHEDULE_BUNDLE = '@deepseek-ai/dsh-experimental-schedule-bundle'
const ROWS: Readonly<Record<string, string>> = {
  'time-context': '@deepseek-ai/dsh-time-context',
  schedule: '@deepseek-ai/dsh-schedule',
  'ui-schedule': '@deepseek-ai/dsh-client-ui-schedule',
}

/**
 * Rewrite a Profile patch written against the rc.2 Web rows. Returns undefined
 * when it carries no such row. Every row the user effectively left off is
 * written back as an explicit `disabled: true` entry because the 0.2.1 Web
 * composition mounts all three rows itself; rows left on need no entry.
 */
export function legacySchedulePatch(text: string): { text: string } | undefined {
  // Same comment-preserving dialect as the official manager; !!js is never evaluated here.
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors[0]) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  const items = document.contents.items
  const legacy: number[] = []
  const enabled = new Set<string>()
  items.forEach((item, index) => {
    if (!isMap(item) || item.has('insert')) return
    const id = document.getIn([index, 'id'])
    if (typeof id !== 'string' || !Object.hasOwn(ROWS, id)) return
    const name = document.getIn([index, 'name'])
    if (name && name !== ROWS[id]) return
    legacy.push(index)
    // Later entries override earlier ones; anything but a literal `false` leaves the row off.
    if (item.has('disabled')) {
      if (document.getIn([index, 'disabled']) === false) enabled.add(id)
      else enabled.delete(id)
    }
  })
  if (!legacy.length) return undefined
  for (const index of legacy.reverse()) {
    const item = items[index]
    if (!isMap(item)) continue
    item.delete('disabled')
    // Keep user configuration for the same row; drop entries that only toggled it.
    if (item.items.every(pair => ['id', 'name'].includes(String(isScalar(pair.key) ? pair.key.value : pair.key)))) items.splice(index, 1)
  }
  for (const id of Object.keys(ROWS)) if (!enabled.has(id)) document.add({ id, disabled: true })
  return { text: String(document) }
}
