import { AlertCircle, AlertTriangle, HelpCircle, Info } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '../components/ui/button.tsx'
import { ScrollArea } from '../components/ui/scroll-area.tsx'
import { DesktopFrame } from '../shared/DesktopFrame.tsx'

const SCHEME = 'dsh-desktop-dialog:'

interface DesktopDialogState {
  readonly type: 'none' | 'info' | 'error' | 'question' | 'warning'
  readonly title: string
  readonly message: string
  readonly detail?: string
  readonly advisory?: string
  readonly buttons: readonly string[]
  readonly defaultId: number
  readonly cancelId: number
  readonly presentation?: 'default' | 'diagnostic' | 'profile-compatibility'
}

function decodeState(): DesktopDialogState | undefined {
  const encoded = new URLSearchParams(window.location.search).get('state')
  if (encoded === null || encoded.length > 64_000) return undefined
  try {
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const value: unknown = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(padded), character => character.charCodeAt(0)),
    ))
    if (value !== null && typeof value === 'object') return value as DesktopDialogState
  } catch { /* The bounded fallback below remains actionable. */ }
  return undefined
}

function respond(response: number): void {
  const url = new URL(`${SCHEME}//response`)
  url.searchParams.set('id', String(response))
  window.location.assign(url.href)
}

export function desktopDialogShowsToneIcon(presentation: DesktopDialogState['presentation']): boolean {
  return presentation !== 'profile-compatibility'
}

export function desktopDialogButtonClassName(
  presentation: DesktopDialogState['presentation'],
  index: number,
): string | undefined {
  return presentation === 'profile-compatibility' && index === 0 ? 'mr-auto' : undefined
}

export function desktopDialogAdvisoryLines(advisory: string): readonly string[] {
  return advisory.split('\n')
}

export function DesktopDialogToneIcon({ type }: Pick<DesktopDialogState, 'type'>): JSX.Element {
  const className = type === 'error'
    ? 'text-destructive'
    : type === 'warning'
      ? 'text-amber-500'
      : 'text-muted-foreground'
  if (type === 'error') return <AlertCircle aria-hidden="true" className={className} />
  if (type === 'warning') return <AlertTriangle aria-hidden="true" className={className} />
  if (type === 'question') return <HelpCircle aria-hidden="true" className={className} />
  return <Info aria-hidden="true" className={className} />
}

export function DesktopDialogApp(): JSX.Element {
  const state = decodeState()
  useEffect(() => {
    if (state === undefined) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') respond(state.cancelId)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => { window.removeEventListener('keydown', onKeyDown) }
  }, [state])

  if (state === undefined) return <><DesktopFrame /><main className="dshNativeContent flex items-center justify-center p-5"><p className="text-sm text-destructive">Desktop dialog state is unavailable.</p></main></>
  const diagnostic = state.presentation === 'diagnostic'
  const profileCompatibility = state.presentation === 'profile-compatibility'
  const showToneIcon = desktopDialogShowsToneIcon(state.presentation)
  const describedBy = [
    ...(state.detail === undefined ? [] : ['desktop-dialog-detail']),
    ...(state.advisory === undefined ? [] : ['desktop-dialog-advisory']),
  ].join(' ') || undefined
  return <><DesktopFrame /><main className="dshNativeContent flex flex-col p-5">
    <section className="flex gap-4" role="dialog" aria-labelledby="desktop-dialog-title" aria-describedby={describedBy}>
      {showToneIcon ? <div className="mt-0.5 shrink-0"><DesktopDialogToneIcon type={state.type} /></div> : null}
      <div className="min-w-0 flex-1">
        <h1 className="text-base font-semibold leading-tight" id="desktop-dialog-title">{state.message}</h1>
        {state.detail === undefined
          ? null
          : profileCompatibility
            ? <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground" id="desktop-dialog-detail">{state.detail}</p>
          : diagnostic
            ? <ScrollArea className="mt-3 h-64 rounded-lg border bg-muted/40">
                <pre className="select-text whitespace-pre-wrap break-words p-3 font-mono text-xs leading-relaxed text-muted-foreground" id="desktop-dialog-detail">{state.detail}</pre>
              </ScrollArea>
            : <ScrollArea className="mt-2 h-28 pr-3">
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground" id="desktop-dialog-detail">{state.detail}</p>
              </ScrollArea>}
        {state.advisory === undefined ? null : <div className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2.5 text-sm leading-relaxed text-amber-100" id="desktop-dialog-advisory">
          {desktopDialogAdvisoryLines(state.advisory).map((line, index) => <span className="block" key={`${String(index)}:${line}`}>{line}</span>)}
        </div>}
      </div>
    </section>
    <footer className="mt-5 flex shrink-0 flex-wrap justify-end gap-2">
      {state.buttons.map((label, index) => <Button autoFocus={index === state.defaultId} className={desktopDialogButtonClassName(state.presentation, index)} key={`${String(index)}:${label}`} onClick={() => { respond(index) }} type="button" variant={index === state.defaultId ? 'default' : index === state.cancelId ? 'outline' : 'secondary'}>{label}</Button>)}
    </footer>
  </main></>
}
