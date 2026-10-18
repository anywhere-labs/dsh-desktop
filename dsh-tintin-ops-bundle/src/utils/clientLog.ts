// ═══════════════════════════════════════════════════════════════
// clientLog.ts — 渲染层统一日志上报（2026-09-06 用户要求「统一封装」）
// 目的：任何业务失败都可调 clientError(tag, message, err)，避免「只弹提示不落日志」：
//   · 经 window.tintin.env.log → 主进程 env:log → logger.logError（electron-log error 级）
//     → C-6 hooks 自动上报服务端 /api/logs/upload 合并
//   · 预览/无桥环境退化 console.*（同样被 spyRendererConsole 桥接落盘 + 上报）
// 用法：clientError('voice-clone', '试听样本失败', err)
// ═══════════════════════════════════════════════════════════════
import { getTintin } from '../composables/useSettingsConfig'

function describe(v: unknown): string {
  if (v === null || v === undefined) return ''
  if (v instanceof Error) return v.message || String(v)
  if (typeof v === 'object') { try { return JSON.stringify(v) } catch (_) { return String(v) } }
  return String(v)
}

function send(level: 'error' | 'warn' | 'info', tag: string, message: unknown, err?: unknown): void {
  const stack = err instanceof Error ? err.stack : undefined
  const text =
    [message === undefined || message === null ? '' : describe(message), err && err !== message ? describe(err) : '']
      .filter(Boolean)
      .join(' ') || 'empty'
  const t = getTintin()
  // 主进程 env:log 通道：error 级 → logError → hooks 自动上报（首选取，可带 stack）
  try {
    if (t?.env?.log) { void t.env.log({ level, tag, message: text, stack }); return }
  } catch (_) { /* 无桥继续退化 */ }
  // 无 IPC（预览/其他壳）→ 退化 console.*；error 级经 spyRendererConsole 桥接同样落盘+上报
  try { (console[level] as (...a: unknown[]) => void)(`[${tag}] ${text}`, stack || '') } catch (_) {}
}

/** 错误级（落盘 main.log + 自动上报服务端合并）——业务失败处统一调此 */
export function clientError(tag: string, message: unknown, err?: unknown): void {
  send('error', tag, message, err)
}

/** 警告级（落盘，不上报） */
export function clientWarn(tag: string, message: unknown, err?: unknown): void {
  send('warn', tag, message, err)
}

/** 信息级（落盘，不上报） */
export function clientInfo(tag: string, message: unknown): void {
  send('info', tag, message)
}
