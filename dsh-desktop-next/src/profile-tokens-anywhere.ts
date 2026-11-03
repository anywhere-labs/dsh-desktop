/** Switch Next's own tokens-anywhere row in a Profile patch, before a Host exists, as the official plugin manager would. */
import { isMap, isSeq, parseDocument } from 'yaml'
import { atomicText, readPrivateFile } from './private-files.ts'

const ID = 'tokens-anywhere'

/**
 * @param text - the Profile patch.
 * @param enabled - whether the row loads.
 * @returns the patch with the row's last override set, comments and everything else kept.
 */
export function tokensAnywherePatch(text: string, enabled: boolean): string {
  // !!js stays an expression in the file; this native path never evaluates it.
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors[0]) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  const target = document.contents.items.findLastIndex((item, index) => isMap(item) && !item.has('insert') && document.getIn([index, 'id']) === ID)
  if (target >= 0) document.setIn([target, 'disabled'], !enabled)
  else document.add({ id: ID, disabled: !enabled })
  return String(document)
}

/** Switch the row in the Profile patch at `path`, which may not exist yet. */
export function setTokensAnywhere(path: string, enabled: boolean): void {
  atomicText(path, tokensAnywherePatch(readPrivateFile(path) ?? '[]\n', enabled))
}
