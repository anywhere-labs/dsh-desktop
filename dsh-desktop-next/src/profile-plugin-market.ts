/** Preconfigure the official plugin market index source in the Profile patch before a Host exists. */
import { isMap, isSeq, parseDocument } from 'yaml'

const ID = 'plugin-market'
const PROVIDER = '@deepseek-ai/dsh-plugin-market'
export const DEFAULT_OFFICIAL_MARKET_INDEX_URL = 'https://cdn.jsdelivr.net/gh/realguan/dsh-plugin-market@dist/dsh-index.json'

export function pluginMarketPatch(text: string, configureDefaultSource?: boolean): { text: string } {
  const document = parseDocument(text, { customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: (value: string) => value }] })
  if (document.errors[0]) throw document.errors[0]
  if (!isSeq(document.contents)) throw new Error('Profile patch must be a YAML sequence')
  if (!configureDefaultSource) return { text }
  const targets = document.contents.items.flatMap((item, index) => isMap(item) && document.getIn([index, 'id']) === ID
    && !item.has('insert') && (!document.getIn([index, 'name']) || document.getIn([index, 'name']) === PROVIDER) ? [index] : [])
  const target = targets.at(-1) ?? -1
  const lastIndexes = targets.findLast(index => document.hasIn([index, 'config', 'indexes']))
  const rawIndexes = lastIndexes === undefined ? undefined : document.getIn([lastIndexes, 'config', 'indexes'], true)
  const existing = isSeq(rawIndexes)
    ? rawIndexes.items.map((_, i) => document.getIn([lastIndexes!, 'config', 'indexes', i]))
      .filter((url): url is string => typeof url === 'string' && url.trim().length > 0)
    : []
  if (target >= 0 && lastIndexes === target && existing.includes(DEFAULT_OFFICIAL_MARKET_INDEX_URL)) return { text }
  const indexes = [DEFAULT_OFFICIAL_MARKET_INDEX_URL, ...existing.filter(url => url !== DEFAULT_OFFICIAL_MARKET_INDEX_URL)]
  if (target >= 0) {
    if (isMap(document.getIn([target, 'config'], true))) document.setIn([target, 'config', 'indexes'], indexes)
    else document.setIn([target, 'config'], { indexes })
  } else {
    document.add({ id: ID, name: PROVIDER, config: { indexes } })
  }
  return { text: String(document) }
}
