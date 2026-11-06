/**
 * The Anywhere account's usage board: spend, requests and tokens from Tokens Anywhere, per Beijing day as it bills. One
 * filter row scopes everything below it; a reload holds the last render at reduced opacity, and choosing a model only
 * sums up what was read, like the console's report. The daily chart stacks each day's spend by model in the console's
 * series colors, the five costliest models of the range in their own color and the rest as Other, named in a legend
 * beneath it; a table view carries the daily values without hovering.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Button, IconRefreshOutlineRegular, SegmentedTabs } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  ANYWHERE_ACCOUNT_ROUTES, summarizeAnywhereUsage,
  type AnywhereModelView, type AnywhereProblem, type AnywhereUsage, type AnywhereUsageRange, type AnywhereUsageRows, type AnywhereUsageTotals,
} from '../account.ts'
import { Select } from './controls.tsx'
import { callHost, formatCount, formatYuan, intlLocale, problemText, usageTicks, type Copy } from './shared.ts'

/** The model filter's value for every model; `''` is taken by rows without a model. */
const ALL_MODELS = 'all'
/** Models drawn in their own color, as the console's report draws them; the rest share Other. */
const MAX_SERIES = 5
/** Other's key, which no model id takes. */
const OTHER = '\u0000other'
const PLOT_HEIGHT = 132
/** Room above the tallest column for its value. */
const PLOT_TOP = 18
const AXIS_BAND = 22
const AXIS_GAP = 8
const MAX_BAR_WIDTH = 24
const BAR_GAP = 2
const BAR_RADIUS = 4
/** Surface left between the segments of a stack. */
const SEGMENT_GAP = 2
/** What an x-axis date takes, so labels skip days rather than touch. */
const DATE_LABEL_WIDTH = 40

/** One color of the chart: a model, or Other. */
interface Series {
  readonly key: string
  readonly label: string
  readonly color: string
}

type Day = AnywhereUsage['daily'][number]

/** Ten-thousandths of a yuan, as Tokens Anywhere bills, so sums stay exact. */
function units(amount: string): number {
  return Math.round(Number(amount) * 10_000)
}

function yuan(value: number): string {
  return (value / 10_000).toFixed(4)
}

function tokensOf(totals: AnywhereUsageTotals): number {
  return totals.inputTokens + totals.outputTokens + totals.cacheTokens
}

function tickLabel(value: number): string {
  return `¥${Number(value.toPrecision(3))}`
}

/** A column with a rounded data end, square at its foot. */
function columnPath(x: number, width: number, top: number, foot: number): string {
  const radius = Math.min(BAR_RADIUS, width / 2, foot - top)
  return `M${x},${foot}V${top + radius}Q${x},${top} ${x + radius},${top}H${x + width - radius}Q${x + width},${top} ${x + width},${top + radius}V${foot}Z`
}

/** A day's stack from the baseline up: the colored models in their order, then Other; parts without spend left out. */
function stackOf(day: Day, series: readonly Series[], other: Series): { series: Series; units: number }[] {
  const colored = series.map(item => ({ series: item, units: units(day.byModel[item.key] ?? '0') }))
  const rest = Object.entries(day.byModel)
    .reduce((sum, [model, amount]) => series.some(item => item.key === model) ? sum : sum + units(amount), 0)
  return [...colored, { series: other, units: rest }].filter(part => part.units > 0)
}

function DailyChart({ daily, series, other, t, language }: {
  daily: AnywhereUsage['daily']
  series: readonly Series[]
  other: Series
  t: Copy
  language: string
}) {
  const frame = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [active, setActive] = useState<number>()
  const [focusable, setFocusable] = useState(daily.length - 1)
  const marks = useRef<(SVGRectElement | null)[]>([])

  useEffect(() => {
    const element = frame.current
    if (element === null) return
    const observer = new ResizeObserver(() => { setWidth(element.clientWidth) })
    observer.observe(element)
    setWidth(element.clientWidth)
    return () => { observer.disconnect() }
  }, [])

  const values = daily.map(day => Number(day.amount))
  const max = Math.max(0, ...values)
  const ticks = usageTicks(max)
  const top = ticks[ticks.length - 1] ?? 0
  const axisWidth = Math.max(...ticks.map(tick => tickLabel(tick).length)) * 7 + AXIS_GAP
  const plotWidth = Math.max(0, width - axisWidth)
  const slot = daily.length === 0 ? 0 : plotWidth / daily.length
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, slot - BAR_GAP))
  const baseline = PLOT_TOP + PLOT_HEIGHT
  const y = (value: number): number => baseline - (top === 0 ? 0 : value / top) * PLOT_HEIGHT
  const center = (index: number): number => axisWidth + slot * (index + 0.5)
  const every = Math.max(1, Math.ceil(DATE_LABEL_WIDTH / (slot || 1)))
  const peak = values.indexOf(max)
  const date = (value: string): string => `${Number(value.slice(5, 7))}/${Number(value.slice(8, 10))}`
  const spoken = (index: number): string => {
    const day = daily[index]!
    const parts = stackOf(day, series, other).map(part => `${part.series.label} ${formatYuan(yuan(part.units), language)}`).join(t('，', ', '))
    return t(
      `${date(day.date)}，花费 ${formatYuan(day.amount, language)}（${parts}），${formatCount(day.requests, language)} 次请求，${formatCount(tokensOf(day), language)} Tokens`,
      `${date(day.date)}: ${formatYuan(day.amount, language)} (${parts}), ${formatCount(day.requests, language)} requests, ${formatCount(tokensOf(day), language)} tokens`,
    )
  }

  const keys = (event: KeyboardEvent<SVGRectElement>, index: number): void => {
    const next = event.key === 'ArrowLeft' ? index - 1 : event.key === 'ArrowRight' ? index + 1
      : event.key === 'Home' ? 0 : event.key === 'End' ? daily.length - 1 : undefined
    if (next === undefined || next < 0 || next >= daily.length) return
    event.preventDefault()
    setFocusable(next)
    marks.current[next]?.focus()
  }

  const shown = active === undefined ? undefined : daily[active]
  // Beside the column, on the side with room, so it stays in the plot and covers neither its column nor the controls.
  const tipBefore = active !== undefined && center(active) > axisWidth + plotWidth / 2

  return (
    <div className="dshAnywhereChart" ref={frame} style={{ height: PLOT_TOP + PLOT_HEIGHT + AXIS_BAND }}>
      {width > 0 && (
        <svg width={width} height={PLOT_TOP + PLOT_HEIGHT + AXIS_BAND} role="group" aria-label={t('每日花费', 'Daily spend')}>
          {ticks.map(tick => (
            <g key={tick}>
              <line className="dshAnywhereGrid" x1={axisWidth} x2={width} y1={y(tick) + 0.5} y2={y(tick) + 0.5} />
              <text className="dshAnywhereTick" x={axisWidth - AXIS_GAP} y={y(tick) + 4} textAnchor="end">{tickLabel(tick)}</text>
            </g>
          ))}
          {daily.map((day, index) => {
            const value = values[index]!
            const parts = stackOf(day, series, other)
            const total = parts.reduce((sum, part) => sum + part.units, 0)
            // A day with any use stays visible, however small beside the tallest.
            const stackTop = value > 0 ? Math.min(y(value), baseline - 2) : baseline
            const scale = total === 0 ? 0 : (baseline - stackTop) / total
            const x = center(index) - barWidth / 2
            let below = 0
            return (
              <g key={day.date}>
                {total > 0 && (
                  <g className="dshAnywhereStack" data-active={active === index ? '' : undefined}>
                    {parts.map((part, order) => {
                      // Every part above the first gives up its foot to the surface gap; one too thin for it is left to the tooltip.
                      const foot = baseline - below * scale - (order === 0 ? 0 : SEGMENT_GAP)
                      below += part.units
                      const head = baseline - below * scale
                      if (foot - head < 1) return null
                      return order === parts.length - 1
                        ? <path key={part.series.key} className="dshAnywhereBar" style={{ fill: part.series.color }} d={columnPath(x, barWidth, head, foot)} />
                        : <rect key={part.series.key} className="dshAnywhereBar" style={{ fill: part.series.color }} x={x} y={head} width={barWidth} height={foot - head} />
                    })}
                  </g>
                )}
                {(daily.length - 1 - index) % every === 0 && (
                  <text className="dshAnywhereTick" x={center(index)} y={baseline + 16} textAnchor="middle">{date(day.date)}</text>
                )}
                <rect ref={(element) => { marks.current[index] = element }} className="dshAnywhereHit"
                  x={axisWidth + slot * index} y={0} width={slot} height={baseline} fill="transparent"
                  role="img" aria-label={spoken(index)} tabIndex={index === focusable ? 0 : -1}
                  onPointerEnter={() => { setActive(index) }} onPointerLeave={() => { setActive(undefined) }}
                  onFocus={() => { setActive(index); setFocusable(index) }} onBlur={() => { setActive(undefined) }}
                  onKeyDown={(event) => { keys(event, index) }} />
              </g>
            )
          })}
          {max > 0 && active === undefined && (
            <text className="dshAnywherePeak" x={center(peak)} y={y(max) - 6}
              textAnchor={center(peak) < 40 ? 'start' : center(peak) > width - 40 ? 'end' : 'middle'}>{formatYuan(daily[peak]!.amount, language)}</text>
          )}
        </svg>
      )}
      {shown !== undefined && active !== undefined && (
        <div className="dshAnywhereTooltip" data-before={tipBefore ? '' : undefined} role="presentation"
          style={{ left: center(active) + (tipBefore ? -1 : 1) * (barWidth / 2 + 8), top: PLOT_TOP }}>
          <strong>{formatYuan(shown.amount, language)}</strong>
          {stackOf(shown, series, other).map(part => (
            <span key={part.series.key} className="dshAnywhereTooltipRow">
              <span className="dshAnywhereSwatch" style={{ background: part.series.color }} />
              <span className="dshAnywhereTooltipName">{part.series.label}</span>
              <span className="dshAnywhereTooltipValue">{formatYuan(yuan(part.units), language)}</span>
            </span>
          ))}
          <span>{formatCount(shown.requests, language)} {t('次请求', 'requests')}</span>
          <span className="dshAnywhereTooltipDate">{shown.date}</span>
        </div>
      )}
    </div>
  )
}

/** The chart's colors named, with what each cost in the range, beneath the chart as in the console. */
function Legend({ items, language }: { items: readonly (Series & { amount: string })[]; language: string }) {
  return (
    <ul className="dshAnywhereLegend">
      {items.map(item => (
        <li key={item.key}>
          <span className="dshAnywhereSwatch" style={{ background: item.color }} aria-hidden="true" />
          <span className="dshAnywhereLegendName" title={item.key === OTHER ? undefined : item.key}>{item.label}</span>
          <span className="dshAnywhereLegendValue">{formatYuan(item.amount, language)}</span>
        </li>
      ))}
    </ul>
  )
}

/** The chart's values without hovering. */
function DailyTable({ daily, t, language }: { daily: AnywhereUsage['daily']; t: Copy; language: string }) {
  return (
    <div className="dshAnywhereTableFrame">
      <table className="dshAnywhereTable">
        <thead>
          <tr>
            <th scope="col">{t('日期', 'Date')}</th>
            <th scope="col">{t('花费', 'Spend')}</th>
            <th scope="col">{t('请求', 'Requests')}</th>
            <th scope="col">Tokens</th>
          </tr>
        </thead>
        <tbody>
          {[...daily].reverse().map(day => (
            <tr key={day.date}>
              <th scope="row">{day.date}</th>
              <td>{formatYuan(day.amount, language)}</td>
              <td>{formatCount(day.requests, language)}</td>
              <td>{formatCount(tokensOf(day), language)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="dshAnywhereStat">
      <span className="dshAnywhereSecondary">{label}</span>
      <span className="dshAnywhereStatValue">{value}</span>
      {detail !== undefined && <span className="dshAnywhereSecondary dshAnywhereStatDetail">{detail}</span>}
    </div>
  )
}

export function AnywhereUsageBoard({ t, language, models }: {
  t: Copy
  language: string
  /** Named in the per-model table where the catalog knows them. */
  models: readonly AnywhereModelView[] | undefined
}) {
  const id = useId()
  const [days, setDays] = useState<AnywhereUsageRange>(30)
  const [model, setModel] = useState(ALL_MODELS)
  const [read, setRead] = useState<AnywhereUsageRows>()
  const [loading, setLoading] = useState(true)
  const [problem, setProblem] = useState<AnywhereProblem>()
  const [view, setView] = useState<'chart' | 'table'>('chart')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let current = true
    setLoading(true)
    const query = new URLSearchParams({ days: String(days) })
    callHost<AnywhereUsageRows>(`${ANYWHERE_ACCOUNT_ROUTES.usage}?${query.toString()}`).then((reply) => {
      if (!current) return
      if (reply.error !== undefined) setProblem(reply.error)
      else if (reply.result !== undefined) { setRead(reply.result); setProblem(undefined) }
    }, () => {
      if (current) setProblem({ code: 'failed' })
    }).finally(() => {
      if (current) setLoading(false)
    })
    return () => { current = false }
  }, [days, attempt])

  const all = useMemo(() => read === undefined ? undefined : summarizeAnywhereUsage(read), [read])
  const usage = useMemo(() => read === undefined || model === ALL_MODELS ? all : summarizeAnywhereUsage(read, model), [all, model, read])
  const name = (id: string): string => id === '' ? t('未知模型', 'Unknown model') : models?.find(item => item.id === id)?.name ?? id
  const used = all?.models.map(row => row.model) ?? []
  // A chosen model stays on offer in a range without its use, so the filter keeps saying what the numbers show.
  const choices = model === ALL_MODELS || used.includes(model) ? used : [...used, model]
  // Colors are given on every model's usage in the range, so a filter never repaints the models that stay.
  const colored: Series[] = used.slice(0, MAX_SERIES).map((key, index) => ({ key, label: name(key), color: `var(--dsh-anywhere-series-${index + 1})` }))
  const other: Series = { key: OTHER, label: t('其他', 'Other'), color: 'var(--dsh-anywhere-series-other)' }
  // A model of Other shown alone keeps Other's color, under its own name.
  const series = model === ALL_MODELS || colored.some(item => item.key === model) ? colored : [...colored, { key: model, label: name(model), color: other.color }]
  const rest = usage?.models.filter(row => !series.some(item => item.key === row.model)).reduce((sum, row) => sum + units(row.amount), 0) ?? 0
  const legend = [
    ...series.flatMap((item) => {
      const row = usage?.models.find(entry => entry.model === item.key)
      return row === undefined ? [] : [{ ...item, amount: row.amount }]
    }),
    ...(rest > 0 ? [{ ...other, amount: yuan(rest) }] : []),
  ]
  const totals = usage?.totals
  return (
    <div className="dshAnywherePanel">
      <div className="dshAnywhereFilters">
        {/* The range takes the page's own section tabs, so both rows read as one control family. */}
        <SegmentedTabs label={t('时间范围', 'Date range')} value={String(days) as '7' | '30'}
          items={[
            { value: '7', label: t('近 7 天', 'Last 7 days'), id: `${id}-range-7`, panelId: `${id}-board` },
            { value: '30', label: t('近 30 天', 'Last 30 days'), id: `${id}-range-30`, panelId: `${id}-board` },
          ]}
          onChange={(next) => { setDays(next === '7' ? 7 : 30) }} />
        <Select value={model} disabled={choices.length === 0} ariaLabel={t('按模型筛选', 'Filter by model')}
          options={[{ value: ALL_MODELS, label: t('全部模型', 'All models') }, ...choices.map(choice => ({ value: choice, label: name(choice) }))]}
          onChange={setModel} />
        <Button className="dshAnywhereFiltersEnd" variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={16} />} disabled={loading}
          onClick={() => { setAttempt(value => value + 1) }}>
          {loading ? t('正在刷新…', 'Refreshing…') : t('刷新', 'Refresh')}
        </Button>
      </div>
      {problem !== undefined && (
        <div className="dshAnywhereInlineProblem" role="alert">
          <span>{problemText(problem, t)}</span>
          <Button variant="ghost" size="sm" onClick={() => { setAttempt(value => value + 1) }}>{t('重试', 'Try again')}</Button>
        </div>
      )}
      {usage === undefined && problem === undefined && <p className="dshAnywhereSecondary" role="status">{t('正在读取用量…', 'Reading usage…')}</p>}
      {usage !== undefined && totals !== undefined && (
        <div className="dshAnywhereBoard" id={`${id}-board`} data-loading={loading ? '' : undefined} aria-busy={loading}>
          <div className="dshAnywhereStats">
            <Stat label={t('花费', 'Spend')} value={formatYuan(totals.amount, language)} />
            <Stat label={t('请求', 'Requests')} value={formatCount(totals.requests, language)} />
            <Stat label="Tokens" value={formatCount(tokensOf(totals), language)}
              detail={t(
                `输入 ${formatCount(totals.inputTokens, language)} · 输出 ${formatCount(totals.outputTokens, language)} · 缓存 ${formatCount(totals.cacheTokens, language)}`,
                `In ${formatCount(totals.inputTokens, language)} · Out ${formatCount(totals.outputTokens, language)} · Cache ${formatCount(totals.cacheTokens, language)}`,
              )} />
          </div>
          <figure className="dshAnywhereUsageCard">
            <figcaption className="dshAnywherePanelTitle">
              <span>{t('每日花费', 'Daily spend')}</span>
              {totals.requests > 0 && (
                <Button variant="ghost" size="sm" onClick={() => { setView(view === 'chart' ? 'table' : 'chart') }}>
                  {view === 'chart' ? t('表格', 'Table') : t('图表', 'Chart')}
                </Button>
              )}
            </figcaption>
            {totals.requests === 0 ? (
              <p className="dshAnywhereEmpty">{model === ALL_MODELS
                ? t('这段时间还没有用量。', 'No usage in this period.')
                : t('这段时间这个模型还没有用量。', 'This model has no usage in this period.')}</p>
            ) : view === 'chart' ? (
              <>
                <DailyChart key={usage.days} daily={usage.daily} series={series} other={other} t={t} language={language} />
                {legend.length > 0 && <Legend items={legend} language={language} />}
              </>
            ) : <DailyTable daily={usage.daily} t={t} language={language} />}
          </figure>
          {usage.models.length > 0 && (
            <div className="dshAnywhereUsageCard">
              <div className="dshAnywherePanelTitle"><span>{t('按模型', 'By model')}</span></div>
              <div className="dshAnywhereTableFrame">
                <table className="dshAnywhereTable">
                  <thead>
                    <tr>
                      <th scope="col">{t('模型', 'Model')}</th>
                      <th scope="col">{t('花费', 'Spend')}</th>
                      <th scope="col">{t('请求', 'Requests')}</th>
                      <th scope="col">{t('输入', 'Input')}</th>
                      <th scope="col">{t('输出', 'Output')}</th>
                      <th scope="col">{t('缓存', 'Cache')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.models.map(row => (
                      <tr key={row.model}>
                        <th scope="row" title={row.model}>{name(row.model)}</th>
                        <td>{formatYuan(row.amount, language)}</td>
                        <td>{formatCount(row.requests, language)}</td>
                        <td>{formatCount(row.inputTokens, language)}</td>
                        <td>{formatCount(row.outputTokens, language)}</td>
                        <td>{formatCount(row.cacheTokens, language)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
          <p className="dshAnywhereSecondary dshAnywhereRangeNote">
            {`${new Date(`${usage.from}T00:00:00+08:00`).toLocaleDateString(intlLocale(language), { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })} – ${new Date(`${usage.to}T00:00:00+08:00`).toLocaleDateString(intlLocale(language), { timeZone: 'Asia/Shanghai', month: 'short', day: 'numeric' })}`}
            {t('，按北京时间统计，和 Tokens Anywhere 的账单一致', ', in Beijing days, the same as your Tokens Anywhere bill')}
          </p>
        </div>
      )}
    </div>
  )
}
