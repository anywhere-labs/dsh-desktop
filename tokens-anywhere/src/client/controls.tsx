/**
 * The page's dropdown and switch rows, in the look of the Desktop settings sections (dsh-desktop-next
 * src/client/DesktopSettingsSection.tsx) under class names of this plugin, so they render the same wherever it loads;
 * and its large amounts, as the Tokens Anywhere console's `Price` shows them.
 */
import { useId, useState, type ReactNode } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatUsd, formatYuanOf, type MoneyFormat } from './shared.ts'

/** A large amount: yuan with the dollars small beside them while yuan are shown, otherwise the dollars. */
export function MoneyAmount({ usd, format }: { usd: string; format: MoneyFormat }) {
  const dollars = formatUsd(usd, format.locale)
  if (format.yuanRate === undefined) return <>{dollars}</>
  return <>{formatYuanOf(usd, format.yuanRate, format.locale)}<span className="dshAnywhereMoneyUsd">{dollars}</span></>
}

export interface ToggleExpander {
  readonly open: boolean
  readonly controls: string
  readonly label: string
  readonly onToggle: () => void
}

export function Select<T extends string>({
  value,
  options,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: T
  options: readonly { readonly value: T; readonly label: ReactNode }[]
  disabled?: boolean
  ariaLabel?: string
  onChange: (value: T) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = options.find(option => option.value === value) ?? options[0]
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={options.map(option => ({ id: option.value, label: option.label }))}
      selectedId={value}
      onSelect={(id) => {
        setOpen(false)
        if (id !== value) onChange(id as T)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className="dshAnywhereSelect"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span>{selected?.label ?? value}</span>
          <IconChevronDownOutlineRegular className="dshAnywhereSelectChevron" />
        </button>
      )}
    />
  )
}

export function ToggleRow({
  label,
  description,
  titleId,
  badge,
  checked,
  disabled,
  onChange,
  expander,
}: {
  label: ReactNode
  description?: ReactNode
  titleId?: string
  badge?: ReactNode
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
  expander?: ToggleExpander
}) {
  const generatedId = useId()
  const labelId = titleId ?? generatedId
  return (
    <div className="dshAnywhereToggleRow">
      <span className="dshAnywhereToggleCopy">
        <span className="dshAnywhereToggleLabel" id={labelId}>
          {label}
          {badge !== undefined && <span className="dshAnywhereBadge">{badge}</span>}
        </span>
        {description !== undefined && (
          <span className="dshAnywhereToggleDescription">{description}</span>
        )}
      </span>
      <div className="dshAnywhereToggleControl">
        <button
          type="button"
          role="switch"
          className="dshAnywhereToggle"
          aria-checked={checked}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={() => { onChange(!checked) }}
        >
          <span className="dshAnywhereToggleKnob" aria-hidden="true" />
        </button>
        {expander !== undefined && (
          <button
            type="button"
            className="dshAnywhereExpander"
            aria-label={expander.label}
            title={expander.label}
            aria-expanded={expander.open}
            aria-controls={expander.controls}
            onClick={expander.onToggle}
          >
            <IconChevronDownOutlineRegular size={12} />
          </button>
        )}
      </div>
    </div>
  )
}
