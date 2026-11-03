/** What the Anywhere account page's parts share: Host calls, wording of failures and thinking levels, number formats. */
import type { AnywhereAccountSnapshot, AnywhereProblem } from '../anywhere-account.ts'

export type Copy = (zh: string, en: string) => string

/** Where the account shows besides Settings, as the Desktop preferences keep it. */
export interface AnywherePlacementView {
  /** An entry in the left sidebar. */
  readonly sidebar: boolean
  /** A View tab beside every conversation. */
  readonly conversation: boolean
  /** False in Safe Mode, whose preferences are fixed. */
  readonly writable: boolean
}

/** The placement as a store the page reads and writes. */
export interface AnywherePlacement {
  getSnapshot(): AnywherePlacementView | undefined
  subscribe(listener: () => void): () => void
  set(change: { sidebar?: boolean; conversation?: boolean }): Promise<void>
}

export interface RouteReply<T = unknown> {
  readonly state?: AnywhereAccountSnapshot
  readonly result?: T
  readonly error?: AnywhereProblem
}

/**
 * Call a Host route of the account: GET without a body, POST with one.
 * @throws when the Host cannot be reached.
 */
export async function callHost<T = unknown>(path: string, body?: object): Promise<RouteReply<T>> {
  const response = await fetch(path, body === undefined
    ? { cache: 'no-store' }
    : { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return await response.json() as RouteReply<T>
}

/** A failure in the page's language, with Tokens Anywhere's own wording where it says more. */
export function problemText(problem: AnywhereProblem, t: Copy): string {
  const text = (() => {
    switch (problem.code) {
      case 'network': return t('无法连接 Tokens Anywhere，请检查网络后重试。', 'Couldn\'t reach Tokens Anywhere. Check your connection and try again.')
      case 'server': return t('Tokens Anywhere 暂时出错了，请稍后重试。', 'Tokens Anywhere had a problem. Try again shortly.')
      case 'rejected': return t('Tokens Anywhere 拒绝了这次请求。', 'Tokens Anywhere refused this request.')
      case 'session-ended': return t('登录已失效，请重新登录。', 'Your sign-in has ended. Sign in again.')
      case 'denied': return t('你取消了这次授权。', 'You cancelled the authorization.')
      case 'cancelled': return t('已取消登录。', 'Sign-in cancelled.')
      case 'expired': return t('登录超时了，请重新登录。', 'Sign-in timed out. Try again.')
      case 'busy': return t('正在完成上一次登录，请稍候。', 'The last sign-in is still finishing.')
      case 'no-models': return t('这个账户暂时没有可用的模型。', 'This account has no models available yet.')
      case 'no-catalog': return t('还没有读到模型列表，请先刷新。', 'The model list has not loaded yet. Refresh it first.')
      case 'unknown-model': return t('这个模型不在 Tokens Anywhere 的列表里。', 'This model is not in the Tokens Anywhere list.')
      case 'unsupported-thinking': return t('这个模型不支持所选的思考等级。', 'This model does not offer that thinking level.')
      case 'last-model': return t('至少要保留一个模型。不再使用的话，可以退出登录。', 'Keep at least one model on. To stop using them, sign out.')
      case 'failed': return t('操作没有完成，请重试。', 'That did not finish. Try again.')
    }
  })()
  return problem.code === 'rejected' && problem.detail !== undefined ? `${text}（${problem.detail}）` : text
}

/** A thinking level's name. */
export function thinkingLabel(level: string, t: Copy): string {
  switch (level) {
    case 'off': return t('关闭', 'Off')
    case 'minimal': return t('最低', 'Minimal')
    case 'low': return t('低', 'Low')
    case 'medium': return t('中', 'Medium')
    case 'high': return t('高', 'High')
    case 'xhigh': return t('超高', 'Extra high')
    case 'max': return t('最高', 'Max')
    default: return level
  }
}

/**
 * The thinking level to use on a model: the current one if it offers it, else High, else its strongest; thinking
 * stays on by default.
 * @param levels - the model's levels, weakest first; empty for a model that does not think.
 */
export function preferredThinking(levels: readonly string[], current: string | undefined): string | undefined {
  if (current !== undefined && levels.includes(current)) return current
  if (levels.includes('high')) return 'high'
  const strongest = levels[levels.length - 1]
  return strongest === 'off' ? undefined : strongest
}

export function intlLocale(language: string): string {
  return language.startsWith('zh') ? 'zh-CN' : 'en-US'
}

/** An amount in yuan with two decimals, rounded half up. */
export function formatYuan(amount: string, language: string): string {
  const match = /^(-)?(\d+)(?:\.(\d+))?$/u.exec(amount.trim())
  if (match === null) return `¥${amount}`
  // In fen, from the decimal digits, so the rounding is exact: the third decimal decides.
  const digits = (match[3] ?? '').padEnd(3, '0')
  const fen = Number(match[2]) * 100 + Number(digits.slice(0, 2)) + (Number(digits[2]) >= 5 ? 1 : 0)
  const whole = new Intl.NumberFormat(intlLocale(language)).format(Math.floor(fen / 100))
  return `${match[1] !== undefined && fen > 0 ? '-' : ''}¥${whole}.${String(fen % 100).padStart(2, '0')}`
}

/** A count, compact from ten thousand up in Chinese and a thousand up otherwise. */
export function formatCount(value: number, language: string): string {
  const locale = intlLocale(language)
  if (value < (language.startsWith('zh') ? 10_000 : 1_000)) return new Intl.NumberFormat(locale).format(value)
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

/** A token limit the way models are talked about: 200K, 1M. */
export function formatTokenLimit(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`
  if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`
  return String(value)
}

/** Clean y-axis ticks for an amount in yuan up to at least `max`, starting at zero, never finer than a fen. */
export function usageTicks(max: number): number[] {
  if (max <= 0) return [0]
  const rough = max / 3
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(0.01, [1, 2, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough) ?? power * 10)
  const ticks: number[] = []
  for (let index = 0; ticks.length === 0 || ticks[ticks.length - 1]! < max; index++) ticks.push(Number((index * step).toPrecision(12)))
  return ticks
}
