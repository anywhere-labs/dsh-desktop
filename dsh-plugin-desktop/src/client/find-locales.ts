/** Desktop find-bar copy, owned by the Desktop client plugin. */

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Desktop-only find-bar copy. */
    'desktop.find': DesktopFindLocaleKey
  }
}

export const zh = {
  label: '在页面中查找',
  placeholder: '查找',
  previous: '上一个匹配',
  next: '下一个匹配',
  matchCase: '区分大小写',
  close: '关闭查找',
  noResults: '无结果',
  matchCount: '{active}/{total}',
  matchCountTruncated: '{active}/{total}+',
  truncatedHint: '内容较多，仅显示前 {total} 个匹配。',
}

/** Key union of the find-bar dictionary; the English table must match it exactly. */
export type DesktopFindLocaleKey = keyof typeof zh

export const en: Record<DesktopFindLocaleKey, string> = {
  label: 'Find in page',
  placeholder: 'Find',
  previous: 'Previous match',
  next: 'Next match',
  matchCase: 'Match case',
  close: 'Close find bar',
  noResults: 'No results',
  matchCount: '{active}/{total}',
  matchCountTruncated: '{active}/{total}+',
  truncatedHint: 'This page is large; showing the first {total} matches.',
}
