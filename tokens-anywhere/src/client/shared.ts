/** What the account page shares: Host calls, wording of failures, number formats. */
import type { AnywhereAccountSnapshot, AnywhereMoneyDisplay, AnywherePlacementState, AnywhereProblem } from '../account.ts'

export type Copy = (zh: string, en: string) => string

/** Where the account shows besides Settings, as the plugin's configuration keeps it. */
export type AnywherePlacementView = AnywherePlacementState

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
      case 'failed': return t('操作没有完成，请重试。', 'That did not finish. Try again.')
    }
  })()
  return problem.code === 'rejected' && problem.detail !== undefined ? `${text}（${problem.detail}）` : text
}

export function intlLocale(language: string): string {
  return language.startsWith('zh') ? 'zh-CN' : 'en-US'
}

/**
 * How the page writes money, in one currency: US dollars, as Tokens Anywhere bills, or for a Chinese reader with local
 * currency on, yuan at the day's rate instead, rounded as the console rounds them (web/lib/local-currency.ts). English
 * has no currency of its own, so it stays in dollars.
 */
export interface MoneyFormat {
  readonly locale: string
  /** Yuan per dollar while yuan are shown; undefined shows dollars only. */
  readonly yuanRate: number | undefined
}

export function moneyFormat(money: AnywhereMoneyDisplay | undefined, language: string): MoneyFormat {
  const shown = language.startsWith('zh') && money?.localCurrency === true ? money.cnyRate : undefined
  return { locale: intlLocale(language), yuanRate: shown }
}

/** Dollars as the console writes them: at least two decimals, at most six. */
export function formatUsd(usd: string, locale: string): string {
  // Intl reads the decimal string itself, so six decimals never pass through a float.
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'USD', currencyDisplay: 'narrowSymbol', minimumFractionDigits: 2, maximumFractionDigits: 6,
  }).format(usd as unknown as number)
}

/** A dollar amount in yuan at `rate`, for reading rather than paying: three significant digits, whole yuan from a thousand up. */
export function formatYuanOf(usd: string, rate: number, locale: string): string {
  const value = Number(usd) * rate
  return new Intl.NumberFormat(locale, {
    style: 'currency', currency: 'CNY', currencyDisplay: 'narrowSymbol',
    ...(Math.abs(value) >= 1000 ? { maximumFractionDigits: 0 } : { maximumSignificantDigits: 3 }),
  }).format(value)
}

/** An amount in one currency: yuan while they are shown, otherwise the dollars. */
export function formatMoney(usd: string, format: MoneyFormat): string {
  return format.yuanRate === undefined ? formatUsd(usd, format.locale) : formatYuanOf(usd, format.yuanRate, format.locale)
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

/** Clean y-axis ticks for an amount up to at least `max`, starting at zero, never finer than a cent or a fen. */
export function usageTicks(max: number): number[] {
  if (max <= 0) return [0]
  const rough = max / 3
  const power = 10 ** Math.floor(Math.log10(rough))
  const step = Math.max(0.01, [1, 2, 5, 10].map(factor => factor * power).find(candidate => candidate >= rough) ?? power * 10)
  const ticks: number[] = []
  for (let index = 0; ticks.length === 0 || ticks[ticks.length - 1]! < max; index++) ticks.push(Number((index * step).toPrecision(12)))
  return ticks
}
