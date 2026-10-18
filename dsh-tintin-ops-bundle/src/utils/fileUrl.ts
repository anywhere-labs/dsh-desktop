/**
 * 本地文件路径 → 可播放 URL。
 *
 * 移植版（DSH Desktop，2026-09-24）：页面经 http://127.0.0.1 提供，http 页面
 * 引用 file:/// 子资源被 Chromium 禁止——原客户端（file:// 页面）不受限的
 * 行为在移植版失效，批量克隆后声音无法播放即此因。检测到 TinTin polyfill
 * 时，本地媒体统一改经宿主受信路由 /tintin/media 流式供给（同源回环 GET，
 * Range 支持进度条拖动）；非移植环境保留 file:/// 兜底（原客户端口径）。
 */
export function toFileUrl(p: string): string {
  if (!p) return ''
  if (/^(https?|blob|data|file):/i.test(p)) return p
  if (typeof window !== 'undefined' && (window as any).tintin?.__dshPolyfill) {
    return `/tintin/media?path=${encodeURIComponent(p)}`
  }
  const normalized = p.replace(/\\/g, '/')
  const encoded = normalized
    .split('/')
    .filter((seg) => seg !== '')
    .map((seg) => encodeURIComponent(seg).replace(/%3A/gi, ':'))
    .join('/')
  return `file:///${encoded}`
}

/**
 * 拖拽/文件选择得到的 File → 本地绝对路径。
 *
 * 2026-09-24（用户报障：选择素材无法拖入）：Electron 43 移除了 File.path，
 * 拖拽与 input 选择的 File 对象不再携带路径——所有拖入/选择静默失效，需经
 * preload 桥解析。桥有两个名字：源仓 fork 的 dshDesktopFilePath.forFile，与
 * 本仓库通道 preload 实际暴露的上游契约 __DSH_DESKTOP_FILE_PATH__.getPathForFile
 * （3946b200ad 迁移只带来了消费方，暴露层用的是后者），两个都试；旧 File.path
 * 仅作降级兜底。取不到路径返回空串，调用方按取消或错误处理。
 */
export function filePathOf(f: File): string {
  if (!f) return ''
  try {
    const viaBridge = (window as any).dshDesktopFilePath?.forFile?.(f)
      || (window as any).__DSH_DESKTOP_FILE_PATH__?.getPathForFile?.(f)
    if (typeof viaBridge === 'string' && viaBridge) return viaBridge
  } catch { /* 桥缺失/异常走降级 */ }
  const legacy = (f as File & { path?: string }).path
  return typeof legacy === 'string' ? legacy : ''
}

/**
 * dragover 接受态修正（2026-09-29 实测根因修复）：Windows 标准用户会话下拖入
 * 文件时 dataTransfer.dropEffect 进来即为 'none'（effectAllowed='all' 亦然），
 * 仅 preventDefault 而不重设 dropEffect 时，Chromium 持续显示禁止光标且 drop
 * 事件永不触发——实测 dragover 27 次 / drop 0 次，管理员会话机器不复现。
 * dragover 中显式置 'copy' 后实测恢复（打包版注入探针 A/B 验证，用户确认）。
 * 所有文件拖放点的 dragover 统一经此修正。
 */
export function acceptFileDragOver(e: DragEvent): void {
  if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
    e.dataTransfer.dropEffect = 'copy'
  }
}
