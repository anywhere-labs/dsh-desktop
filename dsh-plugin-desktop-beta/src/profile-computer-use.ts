/** Edit the same Profile row as the official plugin manager, before a Host exists. */
import { isMap, isSeq, parseDocument } from 'yaml'

const ID = 'computer-use-cua-driver-native'
const PROVIDER = '@deepseek-ai/dsh-experimental-computer-use-cua-driver-native'

export function computerUsePatch(text: string, enabled?: boolean): { enabled: boolean; text: string } {
  // Match the official manager's comment-preserving patch dialect and last-override semantics.
  // !!js stays an expression in the file; this native setup path never evaluates it.
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors[0]) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  const targets = document.contents.items.flatMap((item, index) => isMap(item) && document.getIn([index, 'id']) === ID
    && !item.has('insert') && (!document.getIn([index, 'name']) || document.getIn([index, 'name']) === PROVIDER) ? [index] : [])
  const target = targets.at(-1) ?? -1
  const lastDisabled = targets.findLast(index => document.hasIn([index, 'disabled']))
  const disabled = target < 0 ? undefined : document.getIn([target, 'disabled'])
  const current = lastDisabled !== undefined && document.getIn([lastDisabled, 'disabled']) === false
  if (enabled === undefined || disabled === !enabled) return { enabled: current, text }
  if (target >= 0) document.setIn([target, 'disabled'], !enabled)
  else document.add({ id: ID, disabled: !enabled })
  return { enabled, text: String(document) }
}
