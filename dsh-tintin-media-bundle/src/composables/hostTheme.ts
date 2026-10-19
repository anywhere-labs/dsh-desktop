// ═══════════════════════════════════════════════════════════════
// hostTheme — 宿主（原生 DSH web）主题判定（2026-10-18 报障修正）
//
// 原生挂载点（harness ui-theme boot-theme.ts）：应用内偏好 dark/light/system
// 写 html[data-ds-theme-source]，有效暗色 toggle body[data-ds-dark-theme]。
// 原生从不给 <html> 加 .dark 类——旧链 classList.contains('dark') 恒 false，
// 视图实际永远在用系统偏好猜；应用内偏好≠系统偏好时与原生深浅相反（本次
// 报障「三视图深色不统一、与原生不一样」的判定根因）。
//
// 判定链：body[data-ds-dark-theme] → html[data-ds-theme-source] → html.dark
// → 系统偏好（自查浏览器 harness 无原生信号时兜底）。并观察 body 属性变化，
// 原生运行时翻主题即跟随；同页多视图判定恒一致。
// （媒体/运营/创作三包各持同口径副本，包间不互引。）
// ═══════════════════════════════════════════════════════════════
import { onMounted, onUnmounted, ref, type Ref } from 'vue'

export function resolveHostDark(): boolean {
  if (document.body?.hasAttribute('data-ds-dark-theme')) return true
  const source = document.documentElement?.dataset?.dsThemeSource
  if (source === 'dark' || source === 'light') return source === 'dark'
  if (document.documentElement?.classList?.contains('dark')) return true
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

export function useHostDark(): Ref<boolean> {
  const isDark = ref(resolveHostDark())
  let observer: MutationObserver | undefined
  onMounted(() => {
    observer = new MutationObserver(() => { isDark.value = resolveHostDark() })
    observer.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
  })
  onUnmounted(() => observer?.disconnect())
  return isDark
}
