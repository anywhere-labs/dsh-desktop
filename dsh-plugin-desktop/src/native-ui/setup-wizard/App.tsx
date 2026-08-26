import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  SkipForward,
} from 'lucide-react'
import {
  desktopSetupWizardRequiresLanAcknowledgement,
  isDesktopSetupWizardInput,
  type DesktopSetupWizardInput,
  type DesktopSetupWizardMacosMaterial,
  type DesktopSetupWizardMarket,
  type DesktopSetupWizardMode,
  type DesktopSetupWizardNetworkExposure,
  type DesktopSetupWizardNotifications,
  type DesktopSetupWizardSelection,
  type DesktopSetupWizardWindowsMaterial,
} from '../../setup-wizard-contract.ts'
import { desktopSetupWizardCopy, type DesktopSetupWizardCopy } from '../../setup-wizard-copy.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent } from '../components/ui/card.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog.tsx'
import { Label } from '../components/ui/label.tsx'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { DesktopFrame } from '../shared/DesktopFrame.tsx'

const SCHEME = 'dsh-setup-wizard:'
const MAX_STATE_CHARACTERS = 32 * 1024

type Locale = 'en' | 'zh'

export type DesktopSetupWizardStep =
  | 'welcome'
  | 'mode'
  | 'material'
  | 'market'
  | 'notifications'
  | 'browser'
  | 'success'

export const DESKTOP_SETUP_WIZARD_STEPS = Object.freeze([
  'welcome',
  'mode',
  'material',
  'market',
  'notifications',
  'browser',
  'success',
] as const satisfies readonly DesktopSetupWizardStep[])

export function previousDesktopSetupWizardStep(
  step: DesktopSetupWizardStep,
): DesktopSetupWizardStep | undefined {
  const index = DESKTOP_SETUP_WIZARD_STEPS.indexOf(step)
  return index > 0 ? DESKTOP_SETUP_WIZARD_STEPS[index - 1] : undefined
}

export function nextDesktopSetupWizardStep(
  step: DesktopSetupWizardStep,
): DesktopSetupWizardStep | undefined {
  const index = DESKTOP_SETUP_WIZARD_STEPS.indexOf(step)
  return index >= 0 && index < DESKTOP_SETUP_WIZARD_STEPS.length - 1
    ? DESKTOP_SETUP_WIZARD_STEPS[index + 1]
    : undefined
}

function localLocale(search: string): Locale {
  return new URLSearchParams(search).get('locale') === 'zh' ? 'zh' : 'en'
}

function decodeBase64Url(value: string): string | undefined {
  if (value.length === 0 || value.length > MAX_STATE_CHARACTERS || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return undefined
  }
  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(standard.length + (4 - standard.length % 4) % 4, '=')
  try {
    const binary = window.atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Decode only the exact state/query tuple emitted by DesktopSetupWizardWindow. */
export function decodeDesktopSetupWizardInput(search: string): DesktopSetupWizardInput | undefined {
  const query = new URLSearchParams(search)
  const expected = ['locale', 'state', 'platform', 'frame']
  const keys = [...query.keys()]
  if (keys.length !== expected.length
    || keys.some(key => !expected.includes(key))
    || expected.some(key => query.getAll(key).length !== 1)) return undefined
  const locale = query.get('locale')
  const frame = query.get('frame')
  if ((locale !== 'en' && locale !== 'zh') || (frame !== 'true' && frame !== 'false')) return undefined
  const state = query.get('state')
  if (state === null) return undefined
  const decoded = decodeBase64Url(state)
  if (decoded === undefined) return undefined
  let value: unknown
  try { value = JSON.parse(decoded) as unknown } catch { return undefined }
  if (!isDesktopSetupWizardInput(value) || query.get('platform') !== value.platform) return undefined
  return value
}

function normalizedSelection(input: DesktopSetupWizardInput): DesktopSetupWizardSelection {
  const mode = input.platform === 'linux' ? 'compatibility' : input.mode
  const browserAccess = mode === 'compatibility' && (input.openBrowser || input.networkExposure === 'lan')
  return {
    mode,
    macosMaterial: input.macosMaterial,
    windowsMaterial: input.platform === 'win32' && input.windowsMaterial === 'mica' && !input.micaSupported
      ? 'acrylic'
      : input.windowsMaterial,
    openBrowser: browserAccess,
    networkExposure: browserAccess ? input.networkExposure : 'loopback',
    market: input.market,
    notifications: { ...input.notifications },
  }
}

function finish(selection: DesktopSetupWizardSelection): void {
  const browserAccess = selection.mode === 'compatibility' && selection.openBrowser
  const url = new URL(`${SCHEME}//complete`)
  url.searchParams.set('mode', selection.mode)
  url.searchParams.set('macosMaterial', selection.macosMaterial)
  url.searchParams.set('windowsMaterial', selection.windowsMaterial)
  url.searchParams.set('openBrowser', String(browserAccess))
  url.searchParams.set('networkExposure', browserAccess ? selection.networkExposure : 'loopback')
  url.searchParams.set('market', selection.market)
  url.searchParams.set('notificationsEnabled', String(selection.notifications.enabled))
  url.searchParams.set('notifyOnTurnCompletion', String(selection.notifications.notifyOnTurnCompletion))
  url.searchParams.set('notifyOnTurnFailure', String(selection.notifications.notifyOnTurnFailure))
  url.searchParams.set('notifyOnJobCompletion', String(selection.notifications.notifyOnJobCompletion))
  url.searchParams.set('notifyOnJobFailure', String(selection.notifications.notifyOnJobFailure))
  window.location.assign(url.href)
}

function Choice({
  id,
  value,
  title,
  body,
  selected,
  disabled = false,
  badge,
}: {
  readonly id: string
  readonly value: string
  readonly title: string
  readonly body: string
  readonly selected: boolean
  readonly disabled?: boolean
  readonly badge?: string
}): JSX.Element {
  return <Label
    className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left leading-normal outline-none transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${selected ? 'border-primary bg-muted/70' : 'hover:bg-muted/40'}`}
    htmlFor={id}
  >
    <RadioGroupItem className="mt-0.5" disabled={disabled} id={id} value={value} />
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span>{title}</span>
        {badge === undefined ? null : <Badge variant="secondary">{badge}</Badge>}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{body}</span>
    </span>
  </Label>
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}): JSX.Element {
  return <div className="flex items-center justify-between gap-5 rounded-xl border p-4">
    <div className="min-w-0 space-y-1">
      <Label className="block text-sm font-medium" htmlFor={id}>{label}</Label>
      {description === undefined ? null : <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      id={id}
      onCheckedChange={onChange}
    />
  </div>
}

function Page({
  step,
  title,
  subtitle,
  children,
}: {
  readonly step: DesktopSetupWizardStep
  readonly title: string
  readonly subtitle: string
  readonly children: ReactNode
}): JSX.Element {
  return <div className="mx-auto flex w-full max-w-2xl flex-col py-5" data-orientation="vertical" data-setup-step={step}>
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
    </header>
    <Card><CardContent className="space-y-3 p-4 sm:p-5">{children}</CardContent></Card>
  </div>
}

function ModeOptions({
  copy,
  input,
  selection,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly input: DesktopSetupWizardInput
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
}): JSX.Element {
  const modes: readonly { readonly value: DesktopSetupWizardMode; readonly title: string; readonly body: string }[] = [
    { value: 'compatibility', title: copy.compatibilityMode, body: copy.compatibilityModeBody },
    { value: 'extended', title: copy.extendedMode, body: input.platform === 'linux' ? copy.unavailableOnLinux : copy.extendedModeBody },
    { value: 'advanced', title: copy.advancedMode, body: input.platform === 'linux' ? copy.unavailableOnLinux : copy.advancedModeBody },
  ]
  return <RadioGroup
    aria-label={copy.presentationTitle}
    aria-orientation="vertical"
    name="setup-window-mode"
    onValueChange={value => {
      if (value === 'compatibility' || value === 'extended' || value === 'advanced') {
        update({
          ...selection,
          mode: value,
          openBrowser: value === 'compatibility' ? selection.openBrowser : false,
          networkExposure: value === 'compatibility' ? selection.networkExposure : 'loopback',
        })
      }
    }}
    value={selection.mode}
  >{modes.map(option => <Choice
    body={option.body}
    disabled={input.platform === 'linux' && option.value !== 'compatibility'}
    id={`setup-window-mode-${option.value}`}
    key={option.value}
    selected={selection.mode === option.value}
    title={option.title}
    value={option.value}
  />)}</RadioGroup>
}

type MaterialOption = {
  readonly value: DesktopSetupWizardMacosMaterial | DesktopSetupWizardWindowsMaterial
  readonly title: string
  readonly body: string
}

function MaterialOptions({
  copy,
  input,
  selection,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly input: DesktopSetupWizardInput
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
}): JSX.Element {
  const options: readonly MaterialOption[] = input.platform === 'darwin' ? [
    { value: 'off', title: copy.materialOff, body: copy.materialOffBody },
    { value: 'transparent', title: copy.materialTransparent, body: copy.materialTransparentBody },
  ] : input.platform === 'win32' ? [
    { value: 'off', title: copy.materialOff, body: copy.materialOffBody },
    { value: 'acrylic', title: copy.materialAcrylic, body: copy.materialAcrylicBody },
    ...(input.micaSupported ? [{ value: 'mica' as const, title: copy.materialMica, body: copy.materialMicaBody }] : []),
  ] : [
    { value: 'off', title: copy.materialOff, body: copy.unavailableOnLinux },
  ]
  const selected = input.platform === 'darwin' ? selection.macosMaterial
    : input.platform === 'win32' ? selection.windowsMaterial : 'off'
  const choose = (value: MaterialOption['value']): void => {
    if (input.platform === 'darwin' && (value === 'off' || value === 'transparent')) {
      update({ ...selection, macosMaterial: value })
    } else if (input.platform === 'win32' && (value === 'off' || value === 'acrylic' || value === 'mica')) {
      update({ ...selection, windowsMaterial: value })
    }
  }
  return <RadioGroup
    aria-label={copy.windowMaterial}
    aria-orientation="vertical"
    name="setup-window-material"
    onValueChange={value => {
      if (value === 'off' || value === 'transparent' || value === 'acrylic' || value === 'mica') choose(value)
    }}
    value={selected}
  >{options.map(option => <Choice
    body={option.body}
    disabled={input.platform === 'linux'}
    id={`setup-window-material-${option.value}`}
    key={option.value}
    selected={selected === option.value}
    title={option.title}
    value={option.value}
  />)}</RadioGroup>
}

function MarketOptions({
  copy,
  selection,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
}): JSX.Element {
  const markets: readonly { readonly value: DesktopSetupWizardMarket; readonly title: string; readonly body: string }[] = [
    { value: 'disabled', title: copy.marketDisabled, body: copy.marketDisabledBody },
    { value: 'community-market', title: copy.communityMarket, body: copy.communityMarketBody },
    { value: 'dsh-market', title: copy.dshMarket, body: copy.dshMarketBody },
  ]
  return <RadioGroup
    aria-label={copy.marketTitle}
    aria-orientation="vertical"
    name="setup-plugin-market"
    onValueChange={value => {
      if (value === 'disabled' || value === 'community-market' || value === 'dsh-market') {
        update({ ...selection, market: value })
      }
    }}
    value={selection.market}
  >{markets.map(option => <Choice
    {...(option.value === 'community-market' ? { badge: copy.beta } : {})}
    body={option.body}
    id={`setup-plugin-market-${option.value}`}
    key={option.value}
    selected={selection.market === option.value}
    title={option.title}
    value={option.value}
  />)}</RadioGroup>
}

function NotificationOptions({
  copy,
  notifications,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly notifications: DesktopSetupWizardNotifications
  readonly update: (notifications: DesktopSetupWizardNotifications) => void
}): JSX.Element {
  const set = (key: keyof DesktopSetupWizardNotifications, checked: boolean): void => {
    update({ ...notifications, [key]: checked })
  }
  return <div className="space-y-3" data-orientation="vertical">
    <ToggleRow checked={notifications.enabled} id="setup-notifications-enabled" label={copy.notificationsEnabled} onChange={checked => { set('enabled', checked) }} />
    <div className="space-y-3 border-l pl-4">
      <ToggleRow checked={notifications.notifyOnTurnCompletion} disabled={!notifications.enabled} id="setup-turn-completion" label={copy.turnCompletion} onChange={checked => { set('notifyOnTurnCompletion', checked) }} />
      <ToggleRow checked={notifications.notifyOnTurnFailure} disabled={!notifications.enabled} id="setup-turn-failure" label={copy.turnFailure} onChange={checked => { set('notifyOnTurnFailure', checked) }} />
      <ToggleRow checked={notifications.notifyOnJobCompletion} disabled={!notifications.enabled} id="setup-job-completion" label={copy.jobCompletion} onChange={checked => { set('notifyOnJobCompletion', checked) }} />
      <ToggleRow checked={notifications.notifyOnJobFailure} disabled={!notifications.enabled} id="setup-job-failure" label={copy.jobFailure} onChange={checked => { set('notifyOnJobFailure', checked) }} />
    </div>
  </div>
}

function BrowserOptions({
  copy,
  selection,
  requestBrowserAccess,
  requestExposure,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly selection: DesktopSetupWizardSelection
  readonly requestBrowserAccess: (enabled: boolean) => void
  readonly requestExposure: (exposure: DesktopSetupWizardNetworkExposure) => void
}): JSX.Element {
  return <div className="space-y-5">
    <ToggleRow
      checked={selection.mode === 'compatibility' && selection.openBrowser}
      description={copy.browserCompatibilityNotice}
      id="setup-open-browser"
      label={copy.openBrowser}
      onChange={requestBrowserAccess}
    />
    <section>
      <h2 className="text-sm font-semibold">{copy.networkExposure}</h2>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{copy.networkExposureBody}</p>
      <RadioGroup
        aria-label={copy.networkExposure}
        aria-orientation="vertical"
        className="mt-3"
        name="setup-network-exposure"
        onValueChange={value => {
          if (value === 'loopback'
            || (value === 'lan' && selection.mode === 'compatibility' && selection.openBrowser)) requestExposure(value)
        }}
        value={selection.networkExposure}
      >
        <Choice body={copy.loopbackBody} id="setup-network-exposure-loopback" selected={selection.networkExposure === 'loopback'} title={copy.loopback} value="loopback" />
        <Choice badge={copy.beta} body={copy.lanBody} disabled={selection.mode !== 'compatibility' || !selection.openBrowser} id="setup-network-exposure-lan" selected={selection.networkExposure === 'lan'} title={copy.lan} value="lan" />
      </RadioGroup>
    </section>
  </div>
}

export function SetupWizardStepPage({
  step,
  copy,
  input,
  selection,
  update,
  requestBrowserAccess,
  requestExposure,
}: {
  readonly step: DesktopSetupWizardStep
  readonly copy: DesktopSetupWizardCopy
  readonly input: DesktopSetupWizardInput
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
  readonly requestBrowserAccess: (enabled: boolean) => void
  readonly requestExposure: (exposure: DesktopSetupWizardNetworkExposure) => void
}): JSX.Element {
  if (step === 'mode') return <Page step={step} subtitle={copy.presentationBody} title={copy.presentationTitle}><ModeOptions copy={copy} input={input} selection={selection} update={update} /></Page>
  if (step === 'material') return <Page step={step} subtitle={copy.windowMaterialBody} title={copy.windowMaterial}><MaterialOptions copy={copy} input={input} selection={selection} update={update} /></Page>
  if (step === 'market') return <Page step={step} subtitle={copy.marketBody} title={copy.marketTitle}><MarketOptions copy={copy} selection={selection} update={update} /></Page>
  if (step === 'notifications') return <Page step={step} subtitle={copy.notificationsBody} title={copy.notificationsTitle}><NotificationOptions copy={copy} notifications={selection.notifications} update={notifications => { update({ ...selection, notifications }) }} /></Page>
  if (step === 'browser') return <Page step={step} subtitle={copy.browserBody} title={copy.browserTitle}><BrowserOptions copy={copy} requestBrowserAccess={requestBrowserAccess} requestExposure={requestExposure} selection={selection} /></Page>
  return <div data-setup-step={step} />
}

function SetupWizardSkipDialog({
  copy,
  onSkip,
  outlined = false,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly onSkip: () => void
  readonly outlined?: boolean
}): JSX.Element {
  return <Dialog>
    <DialogTrigger render={<Button type="button" variant={outlined ? 'outline' : 'ghost'} />}><SkipForward />{copy.skip}</DialogTrigger>
    <DialogContent aria-describedby="skip-warning-body" aria-labelledby="skip-warning-title" aria-modal="true" role="alertdialog" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle id="skip-warning-title">{copy.skipDialogTitle}</DialogTitle>
        <DialogDescription id="skip-warning-body">{copy.skipDialogBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button autoFocus type="button" variant="outline" />}>{copy.cancelSkip}</DialogClose>
        <Button onClick={onSkip} type="button">{copy.confirmSkip}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export function SetupWizardWelcome({
  copy,
  profileName,
  onStart,
  onSkip,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly profileName: string
  readonly onStart: () => void
  readonly onSkip: () => void
}): JSX.Element {
  return <div className="flex flex-1 items-center justify-center py-5" data-align="center" data-setup-step="welcome">
    <div className="flex w-full max-w-xl flex-col items-stretch text-left">
      <h1 className="text-2xl font-semibold tracking-tight">{copy.welcomeTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.welcomeBody}</p>
      <Card className="mt-7 w-full text-left">
        <CardContent className="space-y-3 p-5">
          <div>
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.profile}</span>
            <span className="mt-1 block break-all text-base font-semibold">{profileName}</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.firstProfileSetup}</p>
        </CardContent>
      </Card>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <SetupWizardSkipDialog copy={copy} onSkip={onSkip} outlined />
        <Button onClick={onStart} size="lg" type="button">{copy.startSetup}</Button>
      </div>
    </div>
  </div>
}

export function SetupWizardNavigation({
  copy,
  step,
  onBack,
  onNext,
  onSkip,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly step: DesktopSetupWizardStep
  readonly onBack: () => void
  readonly onNext: () => void
  readonly onSkip: () => void
}): JSX.Element | null {
  if (step === 'welcome' || step === 'success') return null
  return <footer className="flex shrink-0 items-center justify-between gap-3 border-t pt-4">
    <SetupWizardSkipDialog copy={copy} onSkip={onSkip} />
    <div className="flex items-center gap-2">
      <Button aria-label={copy.back} disabled={previousDesktopSetupWizardStep(step) === undefined} onClick={onBack} size="icon" title={copy.back} type="button" variant="outline"><ArrowLeft /></Button>
      <Button aria-label={copy.next} onClick={onNext} size="icon" title={copy.next} type="button"><ArrowRight /></Button>
    </div>
  </footer>
}

export function SetupWizardSuccess({
  copy,
  onStart,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly onStart: () => void
}): JSX.Element {
  return <div className="flex flex-1 items-center justify-center" data-align="center" data-setup-step="success">
    <div className="flex max-w-md flex-col items-center text-center">
      <span className="mb-5 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground"><CheckCircle2 className="size-8" /></span>
      <h1 className="text-2xl font-semibold tracking-tight">{copy.successTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.successBody}</p>
      <Button className="mt-8" onClick={onStart} size="lg" type="button">{copy.startUsing}</Button>
    </div>
  </div>
}

export function SetupWizardLanConfirmation({ copy, confirm, cancel }: {
  readonly copy: DesktopSetupWizardCopy
  readonly confirm: () => void
  readonly cancel: () => void
}): JSX.Element {
  return <Dialog onOpenChange={open => { if (!open) cancel() }} open>
    <DialogContent aria-describedby="lan-warning-body" aria-labelledby="lan-warning-title" aria-modal="true" role="alertdialog" showCloseButton={false}>
      <DialogHeader>
        <div className="flex gap-3">
          <AlertTriangle aria-hidden="true" className="size-6 shrink-0 text-destructive" />
          <div>
            <DialogTitle id="lan-warning-title">{copy.lanWarningTitle}</DialogTitle>
            <DialogDescription className="mt-2 text-foreground" id="lan-warning-body">{copy.lanWarningBody}</DialogDescription>
          </div>
        </div>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button autoFocus type="button" variant="outline" />}>{copy.cancelLan}</DialogClose>
        <Button onClick={confirm} type="button" variant="destructive"><AlertTriangle />{copy.confirmLan}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export function SetupWizardBrowserCompatibilityConfirmation({ copy, confirm, cancel }: {
  readonly copy: DesktopSetupWizardCopy
  readonly confirm: () => void
  readonly cancel: () => void
}): JSX.Element {
  return <Dialog onOpenChange={open => { if (!open) cancel() }} open>
    <DialogContent aria-describedby="browser-compatibility-body" aria-labelledby="browser-compatibility-title" aria-modal="true" role="alertdialog" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle id="browser-compatibility-title">{copy.browserCompatibilityDialogTitle}</DialogTitle>
        <DialogDescription className="mt-2 text-foreground" id="browser-compatibility-body">{copy.browserCompatibilityDialogBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button autoFocus type="button" variant="outline" />}>{copy.cancelBrowserCompatibility}</DialogClose>
        <Button onClick={confirm} type="button">{copy.confirmBrowserCompatibility}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export function resolveDesktopSetupWizardBrowserAccessRequest(
  selection: DesktopSetupWizardSelection,
  enabled: boolean,
): { readonly action: 'confirm-compatibility' } | {
  readonly action: 'update'
  readonly selection: DesktopSetupWizardSelection
} {
  if (enabled && selection.mode !== 'compatibility') {
    return Object.freeze({ action: 'confirm-compatibility' as const })
  }
  return Object.freeze({
    action: 'update' as const,
    selection: {
      ...selection,
      openBrowser: enabled,
      networkExposure: enabled ? selection.networkExposure : 'loopback',
    },
  })
}

export function confirmDesktopSetupWizardBrowserCompatibility(
  selection: DesktopSetupWizardSelection,
): DesktopSetupWizardSelection {
  return {
    ...selection,
    mode: 'compatibility',
    openBrowser: true,
    networkExposure: 'loopback',
  }
}

type LanConfirmationReason = 'select' | 'advance' | 'start' | 'skip'

export function desktopSetupWizardSkipRequiresLanAcknowledgement(
  selection: DesktopSetupWizardSelection,
  acknowledged: boolean,
): boolean {
  return desktopSetupWizardRequiresLanAcknowledgement(
    selection.networkExposure,
    selection.networkExposure,
    acknowledged,
  )
}

export function SetupWizardApp(): JSX.Element {
  const locale = localLocale(window.location.search)
  const copy = desktopSetupWizardCopy(locale)
  const input = decodeDesktopSetupWizardInput(window.location.search)
  const [selection, setSelection] = useState<DesktopSetupWizardSelection | undefined>(() => input === undefined ? undefined : normalizedSelection(input))
  const [step, setStep] = useState<DesktopSetupWizardStep>('welcome')
  const [lanAcknowledged, setLanAcknowledged] = useState(false)
  const [confirmLan, setConfirmLan] = useState<LanConfirmationReason>()
  const [confirmBrowserCompatibility, setConfirmBrowserCompatibility] = useState(false)
  if (input === undefined || selection === undefined) {
    return <><DesktopFrame /><main className="dshNativeContent flex h-screen items-center justify-center p-6"><div className="w-full max-w-lg space-y-4"><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.title}</AlertTitle><AlertDescription>{copy.invalidState}</AlertDescription></Alert><div className="flex justify-end"><SetupWizardSkipDialog copy={copy} onSkip={() => { window.location.assign(`${SCHEME}//skip`) }} outlined /></div></div></main></>
  }

  const requestExposure = (requested: DesktopSetupWizardNetworkExposure): void => {
    if (requested === 'lan' && (selection.mode !== 'compatibility' || !selection.openBrowser)) return
    if (desktopSetupWizardRequiresLanAcknowledgement(
      selection.networkExposure,
      requested,
      lanAcknowledged,
    )) {
      setConfirmLan('select')
      return
    }
    if (requested === 'loopback') setLanAcknowledged(false)
    setSelection({ ...selection, networkExposure: requested })
  }

  const requestBrowserAccess = (enabled: boolean): void => {
    const result = resolveDesktopSetupWizardBrowserAccessRequest(selection, enabled)
    if (result.action === 'confirm-compatibility') {
      setConfirmBrowserCompatibility(true)
      return
    }
    if (!enabled) setLanAcknowledged(false)
    setSelection(result.selection)
  }

  const skip = (): void => {
    if (desktopSetupWizardSkipRequiresLanAcknowledgement(selection, lanAcknowledged)) {
      setConfirmLan('skip')
      return
    }
    window.location.assign(`${SCHEME}//skip`)
  }

  const advance = (): void => {
    const next = nextDesktopSetupWizardStep(step)
    if (next === undefined) return
    if (step === 'browser' && desktopSetupWizardRequiresLanAcknowledgement(
      selection.networkExposure,
      selection.networkExposure,
      lanAcknowledged,
    )) {
      setConfirmLan('advance')
      return
    }
    setStep(next)
  }

  const startUsing = (): void => {
    if (desktopSetupWizardRequiresLanAcknowledgement(
      selection.networkExposure,
      selection.networkExposure,
      lanAcknowledged,
    )) {
      setConfirmLan('start')
      return
    }
    finish(selection)
  }

  return <><DesktopFrame /><main className="dshNativeContent h-screen overflow-hidden p-5 sm:p-6"><section className="mx-auto flex h-full w-full max-w-3xl flex-col">
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      {step === 'welcome'
        ? <SetupWizardWelcome
          copy={copy}
          onSkip={skip}
          onStart={() => { setStep('mode') }}
          profileName={input.profileName}
        />
        : step === 'success'
          ? <SetupWizardSuccess copy={copy} onStart={startUsing} />
          : <SetupWizardStepPage copy={copy} input={input} requestBrowserAccess={requestBrowserAccess} requestExposure={requestExposure} selection={selection} step={step} update={setSelection} />}
    </div>
    <SetupWizardNavigation
      copy={copy}
      onBack={() => {
        const previous = previousDesktopSetupWizardStep(step)
        if (previous !== undefined) setStep(previous)
      }}
      onNext={advance}
      onSkip={skip}
      step={step}
    />
  </section></main>
  {confirmLan === undefined ? null : <SetupWizardLanConfirmation
    cancel={() => { setConfirmLan(undefined) }}
    confirm={() => {
      const next = { ...selection, networkExposure: 'lan' as const }
      const reason = confirmLan
      setSelection(next)
      setLanAcknowledged(true)
      setConfirmLan(undefined)
      if (reason === 'advance') setStep('success')
      if (reason === 'start') finish(next)
      if (reason === 'skip') window.location.assign(`${SCHEME}//skip`)
    }}
    copy={copy}
  />}
  {confirmBrowserCompatibility ? <SetupWizardBrowserCompatibilityConfirmation
    cancel={() => { setConfirmBrowserCompatibility(false) }}
    confirm={() => {
      setSelection(confirmDesktopSetupWizardBrowserCompatibility(selection))
      setLanAcknowledged(false)
      setConfirmBrowserCompatibility(false)
    }}
    copy={copy}
  /> : null}</>
}
