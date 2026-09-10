import {
  AlertTriangle,
  Archive,
  CircleHelp,
  FilePenLine,
  FolderOpen,
  FolderInput,
  HardDrive,
  History,
  LifeBuoy,
  PackageX,
  Plug,
  Power,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Stethoscope,
  Terminal,
  Trash2,
  Users,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Button } from '../components/ui/button.tsx'
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../components/ui/card.tsx'
import { Input } from '../components/ui/input.tsx'
import { Label } from '../components/ui/label.tsx'
import { ScrollArea } from '../components/ui/scroll-area.tsx'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs.tsx'
import { cn } from '../lib/utils.ts'
import { DesktopFrame, desktopFrameIsVisible } from '../shared/DesktopFrame.tsx'
import { DesktopProfileSelector } from '../shared/ProfileSelector.tsx'
import {
  RecoveryActionFooter,
  RecoveryActionLink,
  RecoveryNoticeSurface,
  type RecoveryActionVariant,
  type RecoveryNotice,
} from '../shared/RecoveryWindowPrimitives.tsx'
import {
  desktopRecoveryCopy,
  type DesktopRecoveryCopy,
  type DesktopRecoveryTab,
  type DesktopStartupFailureStage,
} from '../../recovery-copy.ts'
import type { DesktopLocale } from '../../runtime.ts'

const SCHEME = 'dsh-recovery:'

interface RecoveryBundle {
  readonly bundleId: string
  readonly packageName: string
  readonly status: 'active' | 'disabled'
  readonly owner: 'core' | 'profile' | 'external'
  readonly action: 'uninstall' | null
}
interface RecoveryCheckpoint {
  readonly slotId: 'slot-1' | 'slot-2' | 'slot-3'
  readonly status: 'available' | 'empty'
  readonly capturedAt?: string
  readonly appVersion?: string
  readonly provider?: string
  readonly fileCount?: number
  readonly pluginCount?: number
  readonly totalBytes?: number
}
interface RecoverySnapshot {
  readonly profileName: string
  readonly bundles: readonly RecoveryBundle[]
  readonly checkpoints: readonly RecoveryCheckpoint[]
}
interface RecoveryProfile {
  readonly name: string
  readonly current: boolean
  readonly selectable: boolean
}
interface RecoveryState {
  readonly locale: DesktopLocale
  readonly failureStage: DesktopStartupFailureStage
  readonly failureDetail: string
  readonly requested?: boolean
  readonly snapshot?: RecoverySnapshot
  readonly snapshotError?: string
  readonly diagnostics: { readonly status: 'saving' | 'saved' | 'failed'; readonly filename?: string }
  readonly notice?: RecoveryNotice
  readonly busy: boolean
  readonly restartReady: boolean
  readonly activeTab: DesktopRecoveryTab
  readonly configurationAvailable: boolean
  readonly profileDirectory?: string
  readonly dataDirectory?: {
    readonly currentDirectory: string
    readonly usingDefaultDirectory: boolean
    readonly editing: boolean
    readonly draftDirectory?: string
  }
  readonly profiles?: readonly RecoveryProfile[]
  readonly profileActionToken?: string
  readonly terminalAvailable?: boolean
  readonly profileCreatorAvailable?: boolean
  readonly safeModeAvailable?: boolean
  readonly safeModeActive?: boolean
}

function decodeState(): RecoveryState | undefined {
  const encoded = new URLSearchParams(window.location.search).get('state')
  if (encoded === null || encoded.length > 512_000) return undefined
  try {
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const value: unknown = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(padded), character => character.charCodeAt(0)),
    ))
    if (value !== null && typeof value === 'object') return value as RecoveryState
  } catch { /* Render the bounded fallback below. */ }
  return undefined
}

function fallbackLocale(): DesktopLocale {
  return new URLSearchParams(window.location.search).get('locale') === 'zh' ? 'zh' : 'en'
}

function href(action: string, id?: string, name?: string, path?: string): string {
  const url = new URL(`${SCHEME}//${action}`)
  if (id !== undefined) url.searchParams.set('id', id)
  if (name !== undefined) url.searchParams.set('name', name)
  if (path !== undefined) url.searchParams.set('path', path)
  return url.href
}

function Action({ action, children, className, icon, id, name, path, variant = 'outline' }: {
  readonly action: string
  readonly children: ReactNode
  readonly className?: string
  readonly icon?: ReactNode
  readonly id?: string
  readonly name?: string
  readonly path?: string
  readonly variant?: RecoveryActionVariant
}): JSX.Element {
  return <RecoveryActionLink className={className} href={href(action, id, name, path)} icon={icon} variant={variant}>{children}</RecoveryActionLink>
}

function PanelScroll({ children }: { readonly children: ReactNode }): JSX.Element {
  return <ScrollArea className="h-full pr-3"><div className="space-y-4 pb-2 pt-4">{children}</div></ScrollArea>
}

function formatCheckpointSize(bytes: number, locale: DesktopLocale): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB']
  let value = bytes / 1024
  let unit = units[0]!
  for (let index = 1; value >= 1024 && index < units.length; index += 1) {
    value /= 1024
    unit = units[index]!
  }
  return `${new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 1 }).format(value)} ${unit}`
}

function CheckpointFact({ label, value }: { readonly label: string; readonly value: ReactNode }): JSX.Element {
  return <div className="rounded-lg border bg-muted/30 px-3 py-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="mt-1 truncate text-sm font-medium">{value}</dd></div>
}

function RollbackPanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  if (state.snapshot === undefined) return <PanelScroll><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.checkpoints}</AlertTitle><AlertDescription>{copy.checkpointsUnavailable}</AlertDescription></Alert></PanelScroll>
  const numberLocale = state.locale === 'zh' ? 'zh-CN' : 'en-US'
  return <PanelScroll><div className="grid grid-cols-1 gap-4">{state.snapshot.checkpoints.map(checkpoint => {
    const slotNumber = checkpoint.slotId.slice(-1)
    return <Card key={checkpoint.slotId} className="w-full overflow-hidden"><CardHeader className="gap-3 space-y-0 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0 space-y-1.5"><CardTitle>{state.locale === 'zh' ? `槽位 ${slotNumber}` : `Slot ${slotNumber}`}</CardTitle><CardDescription>{checkpoint.status === 'empty' ? copy.noHealthyStartup : checkpoint.capturedAt === undefined ? copy.rollbackBody : new Date(checkpoint.capturedAt).toLocaleString(numberLocale)}</CardDescription></div><span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground">{checkpoint.status === 'empty' ? copy.emptySlot : copy.availableSlot}</span></CardHeader>{checkpoint.status === 'empty' ? null : <><CardContent><dl className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"><CheckpointFact label={copy.desktopVersion} value={checkpoint.appVersion ?? copy.unknown} />{checkpoint.pluginCount === undefined ? null : <CheckpointFact label={copy.pluginCount} value={state.locale === 'zh' ? `${checkpoint.pluginCount} 个` : checkpoint.pluginCount.toLocaleString(numberLocale)} />}<CheckpointFact label={copy.configurationFileCount} value={state.locale === 'zh' ? `${checkpoint.fileCount ?? 0} 个` : (checkpoint.fileCount ?? 0).toLocaleString(numberLocale)} />{checkpoint.totalBytes === undefined ? null : <CheckpointFact label={copy.checkpointSize} value={formatCheckpointSize(checkpoint.totalBytes, state.locale)} />}</dl></CardContent><CardFooter className="flex-wrap justify-end gap-2 border-t bg-muted/20 px-6 py-4"><Action action="open-checkpoint" icon={<FolderOpen />} id={checkpoint.slotId}>{copy.openCheckpoint}</Action><Action action="preview-checkpoint" icon={<RotateCcw />} id={checkpoint.slotId} variant="default">{copy.rollbackCheckpoint}</Action></CardFooter></>}
    </Card>
  })}</div></PanelScroll>
}

function SafeModePanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2"><ShieldCheck className="size-5" />{copy.safeMode}</CardTitle><CardDescription>{state.safeModeActive === true ? copy.safeModeActiveBody : copy.safeModeBody}</CardDescription></CardHeader>{state.safeModeActive === true || state.safeModeAvailable === true ? null : <CardContent><p className="text-sm text-amber-600 dark:text-amber-400">{copy.safeModeUnavailable}</p></CardContent>}{state.safeModeActive === true || state.safeModeAvailable !== true ? null : <CardFooter className="justify-end"><Action action="enter-safe-mode" icon={<ShieldCheck />} variant="default">{copy.enterSafeMode}</Action></CardFooter>}</Card>
}

function PluginsPanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  if (state.snapshot === undefined) return <PanelScroll><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.plugins}</AlertTitle><AlertDescription>{copy.pluginsUnavailable}</AlertDescription></Alert></PanelScroll>
  return <PanelScroll><Card><CardHeader><CardTitle>{copy.plugins}</CardTitle><CardDescription>{copy.pluginsBody}</CardDescription></CardHeader><CardContent className="divide-y p-0">{state.snapshot.bundles.length === 0 ? <p className="px-6 py-5 text-sm text-muted-foreground">{copy.pluginsEmpty}</p> : state.snapshot.bundles.map(bundle => <div className="flex items-center justify-between gap-4 px-6 py-3" key={bundle.bundleId}><div className="min-w-0"><p className="truncate text-sm font-medium">{bundle.packageName}</p><p className="text-xs text-muted-foreground">{bundle.owner === 'core' ? copy.core : bundle.owner === 'profile' ? copy.profileDependency : copy.external}</p></div><div className="flex shrink-0 items-center gap-2">{bundle.status === 'disabled' ? <span className="rounded-full bg-muted px-2 py-1 text-xs">{copy.disabled}</span> : null}{bundle.action === 'uninstall' ? <Action action="preview-uninstall" icon={<PackageX />} id={bundle.bundleId} variant="destructive">{copy.uninstall}</Action> : null}</div></div>)}</CardContent></Card></PanelScroll>
}

function ProfilesPanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  if (state.profiles === undefined) return <PanelScroll><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.profiles}</AlertTitle><AlertDescription>{copy.profilesUnavailable}</AlertDescription></Alert></PanelScroll>
  return <PanelScroll><DesktopProfileSelector profiles={state.profiles} labels={{ title: copy.profiles, description: copy.profilesBody, current: copy.currentProfile, select: copy.switchProfile, empty: copy.profilesEmpty, create: copy.addProfile }} selectHref={name => state.profileActionToken === undefined ? undefined : href('switch-profile', state.profileActionToken, name)} {...(state.profileCreatorAvailable ? { createHref: href('open-profile-creator') } : {})} /></PanelScroll>
}

function RecoveryGuideCard({ body, icon, title }: {
  readonly body: string
  readonly icon: ReactNode
  readonly title: string
}): JSX.Element {
  return <Card><CardHeader><CardTitle className="flex items-center gap-2">{icon}{title}</CardTitle><CardDescription>{body}</CardDescription></CardHeader></Card>
}

function QuickRecoveryPanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  return <PanelScroll>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><CircleHelp className="size-5" />{copy.quickRecovery}</CardTitle><CardDescription>{copy.quickRecoveryBody}</CardDescription></CardHeader></Card>
    <SafeModePanel copy={copy} state={state} />
    <RecoveryGuideCard body={copy.pluginGuideBody} icon={<Plug className="size-5" />} title={copy.plugins} />
    <RecoveryGuideCard body={copy.rollbackGuideBody} icon={<History className="size-5" />} title={copy.tabs.rollback} />
    <RecoveryGuideCard body={copy.profileSwitchGuideBody} icon={<Users className="size-5" />} title={copy.tabs.profiles} />
    <RecoveryGuideCard body={copy.dataGuideBody} icon={<HardDrive className="size-5" />} title={copy.tabs.data} />
    <RecoveryGuideCard body={copy.diagnosticsGuideBody} icon={<Stethoscope className="size-5" />} title={copy.tabs.diagnostics} />
  </PanelScroll>
}

function DataDirectoryEditor({ copy, state }: {
  readonly copy: DesktopRecoveryCopy
  readonly state: NonNullable<RecoveryState['dataDirectory']>
}): JSX.Element {
  const [directory, setDirectory] = useState(state.draftDirectory ?? '')
  const apply = (): void => {
    const target = directory.trim()
    if (target.length > 0) window.location.assign(href('apply-data-directory', undefined, undefined, target))
  }
  return <div className="space-y-3 border-t px-6 py-5">
    <div className="space-y-2"><Label htmlFor="data-directory-path">{copy.dataDirectoryPath}</Label><div className="flex flex-col gap-2 sm:flex-row"><Input autoFocus id="data-directory-path" maxLength={32_768} onChange={event => { setDirectory(event.target.value) }} onKeyDown={event => { if (event.key === 'Enter') apply() }} placeholder={copy.dataDirectoryPlaceholder} value={directory} /><Button onClick={() => { window.location.assign(href('browse-data-directory')) }} type="button" variant="outline"><FolderOpen />{copy.browse}</Button></div></div>
    <div className="flex flex-wrap justify-end gap-2"><Button onClick={() => { window.location.assign(href('cancel-change-data-directory')) }} type="button" variant="outline">{copy.cancelDataDirectoryChange}</Button><Button disabled={directory.trim().length === 0} onClick={apply} type="button"><FolderInput />{copy.applyDataDirectory}</Button></div>
  </div>
}

function DataManagementPanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  const data = state.dataDirectory
  if (data === undefined) return <PanelScroll><Alert><HardDrive /><AlertTitle>{copy.resetAndDataManagement}</AlertTitle><AlertDescription>{copy.dataDirectoryUnavailable}</AlertDescription></Alert></PanelScroll>
  return <PanelScroll>
    <Card><CardHeader><CardTitle className="flex items-center gap-2"><HardDrive className="size-5" />{copy.dataManagement}</CardTitle><CardDescription>{copy.dataManagementBody}</CardDescription></CardHeader><CardContent><p className="mb-2 text-xs text-muted-foreground">{copy.currentDataDirectory}</p><code className="block select-text break-all rounded-lg bg-muted p-3 text-xs">{data.currentDirectory}</code></CardContent>{data.editing ? <DataDirectoryEditor copy={copy} state={data} /> : <CardFooter className="flex-wrap justify-end gap-2">{data.usingDefaultDirectory ? null : <Action action="restore-default-data-directory" icon={<RotateCcw />}>{copy.restoreDefaultDataDirectory}</Action>}<Action action="begin-change-data-directory" icon={<FolderInput />} variant="default">{copy.changeDataDirectory}</Action></CardFooter>}</Card>
    <Card className="border-destructive/40"><CardHeader><CardTitle className="flex items-center gap-2 text-destructive"><Trash2 className="size-5" />{copy.factoryReset}</CardTitle><CardDescription>{copy.factoryResetBody}</CardDescription></CardHeader><CardFooter className="justify-end"><Action action="factory-reset" icon={<Trash2 />} variant="destructive">{copy.factoryResetAction}</Action></CardFooter></Card>
  </PanelScroll>
}

function DiagnosticsPanel({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  return <PanelScroll><Card><CardHeader><CardTitle>{copy.diagnostics}</CardTitle><CardDescription>{state.diagnostics.status === 'saving' ? copy.savingDiagnostics : state.diagnostics.status === 'saved' ? copy.diagnosticsSaved : copy.diagnosticsFailed}</CardDescription></CardHeader><CardContent className="space-y-2">{state.diagnostics.filename === undefined ? null : <code className="block break-all rounded-lg bg-muted p-3 text-xs">{state.diagnostics.filename}</code>}<p className="text-xs text-muted-foreground">{copy.privacy}</p></CardContent><CardFooter className="flex-wrap justify-end gap-2"><Action action={state.diagnostics.status === 'saved' ? 'show-diagnostics' : 'export-diagnostics'} icon={<Archive />}>{state.diagnostics.status === 'saved' ? copy.showDiagnostics : copy.saveDiagnostics}</Action></CardFooter></Card>{state.configurationAvailable ? <Card><CardHeader><CardTitle>{copy.configurationFiles}</CardTitle><CardDescription>{copy.configurationFilesBody}</CardDescription></CardHeader><CardFooter className="flex-wrap gap-2 pt-6"><Action action="open-settings-document" icon={<FilePenLine />}>{copy.openSettingsDocument}</Action><Action action="open-profile-patch" icon={<FilePenLine />}>{copy.openProfilePatch}</Action><Action action="open-profile-manifest" icon={<FilePenLine />}>{copy.openProfileManifest}</Action><Action action="open-profile-directory" icon={<FolderOpen />}>{copy.openProfileDirectory}</Action></CardFooter></Card> : null}</PanelScroll>
}

function Reason({ copy, state }: { readonly copy: DesktopRecoveryCopy; readonly state: RecoveryState }): JSX.Element {
  return <Card className={cn('shrink-0', state.requested === true ? 'border-border' : 'border-amber-500/50')}><CardContent className="flex gap-4 p-4"><div className="mt-0.5 shrink-0">{state.requested === true ? <LifeBuoy className="size-5 text-muted-foreground" /> : <AlertTriangle className="size-5 text-amber-500" />}</div><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-x-3 gap-y-1"><h2 className="text-sm font-semibold">{copy.reason}</h2>{state.snapshot === undefined ? null : <span className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">{copy.currentProfile}: {state.snapshot.profileName}</span>}{state.profileDirectory === undefined ? null : <span className="inline-flex min-w-0 max-w-full items-center rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground"><span className="shrink-0">{copy.currentProfileDirectory}:&nbsp;</span><code className="truncate select-text" title={state.profileDirectory}>{state.profileDirectory}</code></span>}</div>{state.requested === true ? <><p className="mt-1 text-sm font-medium">{copy.requestedMode}</p><p className="mt-1 text-sm text-muted-foreground">{copy.requestedBody}</p></> : <><p className="mt-1 text-xs text-muted-foreground">{copy.failureStage}: {copy.stageLabels[state.failureStage]}</p><pre className="mt-2 max-h-20 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-muted p-2.5 text-xs leading-relaxed">{state.failureDetail}</pre></>}</div></CardContent></Card>
}

/** Keep the recovery terminal pill opposite the platform's native controls. */
export function RecoveryTerminalAction({ busy = false, copy, search }: { readonly busy?: boolean; readonly copy: DesktopRecoveryCopy; readonly search: string }): JSX.Element | null {
  if (!desktopFrameIsVisible(search)) return null
  const platform = new URLSearchParams(search).get('platform')
  if (platform !== 'darwin' && platform !== 'win32') return null
  return <div className={cn('fixed top-1 z-[1001] flex h-7 items-center', platform === 'win32' ? 'left-3' : 'right-3', busy && 'pointer-events-none opacity-60')}><Action action="open-terminal" className="h-7 rounded-full bg-background/80 px-3 shadow-sm backdrop-blur" icon={<Terminal />}>{copy.openTerminal}</Action></div>
}

export function RecoveryApp(): JSX.Element {
  const state = decodeState()
  if (state === undefined) {
    const copy = desktopRecoveryCopy(fallbackLocale())
    return <><DesktopFrame /><main className="dshNativeContent flex h-screen items-center justify-center p-6"><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.title}</AlertTitle><AlertDescription>{copy.fallbackBody}</AlertDescription></Alert></main></>
  }
  const copy = desktopRecoveryCopy(state.locale)
  return <><DesktopFrame />{state.terminalAvailable ? <RecoveryTerminalAction busy={state.busy} copy={copy} search={window.location.search} /> : null}<main className={cn('dshNativeContent h-screen overflow-hidden p-5 sm:p-6', state.busy && 'pointer-events-none opacity-70')}><div className="mx-auto flex h-full w-full max-w-5xl flex-col gap-4"><Reason copy={copy} state={state} /><Tabs defaultValue={state.activeTab}><TabsList className="w-full justify-start overflow-x-auto"><TabsTrigger value="quick"><LifeBuoy />{copy.tabs.quick}</TabsTrigger><TabsTrigger value="plugins"><Plug />{copy.tabs.plugins}</TabsTrigger><TabsTrigger value="rollback"><History />{copy.tabs.rollback}</TabsTrigger><TabsTrigger value="profiles"><Users />{copy.tabs.profiles}</TabsTrigger><TabsTrigger value="data"><HardDrive />{copy.tabs.data}</TabsTrigger><TabsTrigger value="diagnostics"><Stethoscope />{copy.tabs.diagnostics}</TabsTrigger></TabsList><TabsContent value="quick"><QuickRecoveryPanel copy={copy} state={state} /></TabsContent><TabsContent value="plugins"><PluginsPanel copy={copy} state={state} /></TabsContent><TabsContent value="rollback"><RollbackPanel copy={copy} state={state} /></TabsContent><TabsContent value="profiles"><ProfilesPanel copy={copy} state={state} /></TabsContent><TabsContent value="data"><DataManagementPanel copy={copy} state={state} /></TabsContent><TabsContent value="diagnostics"><DiagnosticsPanel copy={copy} state={state} /></TabsContent></Tabs><RecoveryActionFooter leading={state.busy ? <span className="inline-flex items-center gap-2 text-sm text-muted-foreground"><RefreshCw className="size-4 animate-spin" />{copy.working}</span> : undefined}><Action action="restart" icon={<RotateCcw />} variant={state.restartReady ? 'default' : 'outline'}>{copy.restart}</Action><Action action="quit" icon={<Power />}>{copy.quit}</Action></RecoveryActionFooter></div></main><RecoveryNoticeSurface notice={state.notice} /></>
}
