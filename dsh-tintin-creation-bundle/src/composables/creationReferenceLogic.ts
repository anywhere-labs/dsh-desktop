// ═══════════════════════════════════════════════════════════════
// creationReferenceLogic — 创作模式·上传引用池纯函数层（2026-10-17）
//
// 用户裁决（2026-10-17）：@ 双线路——工具栏 @ 按钮=选择产品（产品库）；
// 输入框输 @=从上传引用选择（＋创建主体 + 已上传文件，选中把 @文件名 插入
// 输入上下文）；左侧上传块=多文件引用池（缩略图块 + ×移除 + 小 ＋ 续传）。
// 本模块承载无 vue/IPC 依赖的部分：引用条目形状、预览 URL、类型判定、
// @ 过滤词/引用名解析、池合并与上下文附注组包。
//
// 预览链路：openFiles 选择即登记（media:unlock），缩略图经宿主
// `/tintin/media?path=` 同源代理流式取回（file:// 直出已废，2026-09-24）。
// ═══════════════════════════════════════════════════════════════

export interface CreationReference {
  name: string
  path: string
}

/** 宿主文件对话框的参考文件过滤（openFiles filters 契约） */
export const REFERENCE_DIALOG_FILTERS: ReadonlyArray<{ name: string; extensions: readonly string[] }> = [
  { name: '参考文件', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'pdf'] },
] as const

/** 引用预览 URL：unlock 已由选择器触发，经宿主 /tintin/media 同源代理取回
 *  （ImitationFxPackPanel 2026-09-24 同款裁决，file:// 直出已废） */
export function referenceUrl(path: string): string {
  return `/tintin/media?path=${encodeURIComponent(path)}`
}

export function extOf(nameOrPath: string): string {
  const m = /\.([a-z0-9]+)$/iu.exec(nameOrPath)
  return (m?.[1] ?? '').toLowerCase()
}

export function isImageRef(nameOrPath: string): boolean {
  return ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(extOf(nameOrPath))
}

export function isVideoRef(nameOrPath: string): boolean {
  return ['mp4', 'mov'].includes(extOf(nameOrPath))
}

/** 池合并：按 path 去重（已存在的不重复加入），返回新数组 */
export function mergeReferencePaths(
  pool: readonly CreationReference[],
  paths: readonly string[],
): CreationReference[] {
  const out = [...pool]
  for (const p of paths) {
    if (out.some((r) => r.path === p)) continue
    out.push({ path: p, name: p.split(/[\\/]/).pop() || p })
  }
  return out
}

/** 输入框 @ 过滤词解析：取最后一个 @ 之后的词（到空白或 / 为止）；
 *  无 @ 返回 null，@ 后空白=空串（打开未过滤的引用菜单） */
export function atQueryFrom(text: string): string | null {
  const s = String(text ?? '')
  const idx = s.lastIndexOf('@')
  if (idx < 0) return null
  return s.slice(idx + 1).split(/[\s/]/u)[0] ?? ''
}

/** 输入文本中出现的 @ 引用名（去重，按出现顺序）——发送时与上传池求交集 */
export function atReferencesIn(text: string): string[] {
  const out: string[] = []
  for (const m of String(text ?? '').matchAll(/@([^\s@/]+)/gu)) {
    const name = (m[1] ?? '').trim()
    if (name && !out.includes(name)) out.push(name)
  }
  return out
}

/** 引用过滤：文件名包含即命中（大小写不敏感；空串=全部） */
export function filterReferences(
  refs: readonly CreationReference[],
  query: string,
): CreationReference[] {
  const q = String(query ?? '').trim().toLowerCase()
  if (!q) return [...refs]
  return refs.filter((r) => r.name.toLowerCase().includes(q))
}

/** 上下文附注组包：非空 → `\n（附参考文件：a、b）`，空 → '' */
export function referencesBlock(names: readonly string[]): string {
  const clean = names.map((n) => String(n ?? '').trim()).filter(Boolean)
  return clean.length > 0 ? `\n（附参考文件：${clean.join('、')}）` : ''
}
