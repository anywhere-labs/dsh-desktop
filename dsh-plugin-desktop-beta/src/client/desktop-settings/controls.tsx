/** Controls of the Desktop settings page that other Desktop pages reuse: choice cards, selects and toggle rows. */

import { type ReactNode, useId, useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@deepseek-ai/dsh-client-ui-primitives'

export function Choice({
  title,
  body,
  aside,
  selected,
  reselectable,
  disabled,
  action,
  status,
  badge,
}: {
  title: ReactNode
  body: ReactNode
  aside?: ReactNode
  selected: boolean
  reselectable?: boolean
  disabled?: boolean
  action: () => void
  status?: ReactNode
  badge?: ReactNode
}) {
  const actionable = disabled !== true && (!selected || reselectable === true)
  const choose = (): void => {
    if (actionable) action()
  }
  return (
    <div
      role="radio"
      className="dshDesktopSettingsChoice"
      data-selected={selected ? 'true' : undefined}
      data-actionable={actionable ? 'true' : undefined}
      aria-checked={selected}
      aria-disabled={disabled === true ? 'true' : undefined}
      tabIndex={disabled === true ? -1 : 0}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        choose()
      }}
    >
      <span className="dshDesktopSettingsChoiceCopy">
        <span className="dshDesktopSettingsChoiceTitle">
          {title}
          {badge !== undefined && <span className="dshDesktopSettingsBadge">{badge}</span>}
          {status !== undefined && <span className="dshDesktopSettingsBadge">{status}</span>}
        </span>
        <span className="dshDesktopSettingsChoiceBody">{body}</span>
      </span>
      {aside}
    </div>
  )
}

export interface DesktopSettingsToggleExpander {
  readonly open: boolean
  readonly controls: string
  readonly label: string
  readonly onToggle: () => void
}

export function DesktopSettingsSelect<T extends string>({
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
          className="dshDesktopSettingsSelect"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(current => !current) }}
        >
          <span>{selected?.label ?? value}</span>
          <IconChevronDownOutlineRegular className="dshDesktopSettingsSelectChevron" />
        </button>
      )}
    />
  )
}

export function DesktopSettingsToggleRow({
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
  expander?: DesktopSettingsToggleExpander
}) {
  const generatedId = useId()
  const labelId = titleId ?? generatedId
  return (
    <div className="dshDesktopSettingsToggleRow">
      <span className="dshDesktopSettingsToggleCopy">
        <span className="dshDesktopSettingsToggleLabel" id={labelId}>
          {label}
          {badge !== undefined && <span className="dshDesktopSettingsBadge">{badge}</span>}
        </span>
        {description !== undefined && (
          <span className="dshDesktopSettingsToggleDescription">{description}</span>
        )}
      </span>
      <div className="dshDesktopSettingsToggleControl">
        <button
          type="button"
          role="switch"
          className="dshDesktopSettingsToggle"
          aria-checked={checked}
          aria-labelledby={labelId}
          disabled={disabled}
          onClick={() => { onChange(!checked) }}
        >
          <span className="dshDesktopSettingsToggleKnob" aria-hidden="true" />
        </button>
        {expander !== undefined && (
          <button
            type="button"
            className="dshDesktopSettingsExpander"
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
