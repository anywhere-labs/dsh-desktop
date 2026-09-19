import { AlertTriangle, ArrowLeft, RotateCcw } from 'lucide-react'
import { Alert, AlertDescription } from '../components/ui/alert.tsx'
import { ScrollArea } from '../components/ui/scroll-area.tsx'
import { cn } from '../lib/utils.ts'
import { DesktopFrame } from '../shared/DesktopFrame.tsx'
import { DesktopProfileSelector, type DesktopProfileSelectorItem } from '../shared/ProfileSelector.tsx'
import {
  RecoveryActionFooter,
  RecoveryActionLink,
  RecoveryNoticeSurface,
  type RecoveryNotice,
} from '../shared/RecoveryWindowPrimitives.tsx'
import { desktopRecoveryCopy } from '../../recovery-copy.ts'
import type { DesktopLocale } from '../../runtime.ts'

const SCHEME = 'dsh-profile-selector:'

interface ProfileSelectorState {
  readonly locale: DesktopLocale
  readonly profiles: readonly DesktopProfileSelectorItem[]
  readonly busy: boolean
  readonly restartReady: boolean
  readonly notice?: RecoveryNotice
}

function decodeState(): ProfileSelectorState | undefined {
  const encoded = new URLSearchParams(window.location.search).get('state')
  if (encoded === null || encoded.length > 256_000) return undefined
  try {
    const normalized = encoded.replaceAll('-', '+').replaceAll('_', '/')
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
    const value: unknown = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(atob(padded), character => character.charCodeAt(0)),
    ))
    if (value !== null && typeof value === 'object') return value as ProfileSelectorState
  } catch { /* Render the bounded fallback below. */ }
  return undefined
}

function href(action: 'cancel' | 'create' | 'restart' | 'switch', name?: string): string {
  const url = new URL(`${SCHEME}//${action}`)
  if (name !== undefined) url.searchParams.set('name', name)
  return url.href
}

export function ProfileSelectorApp(): JSX.Element {
  const state = decodeState()
  const locale = state?.locale ?? (new URLSearchParams(window.location.search).get('locale') === 'zh' ? 'zh' : 'en')
  const copy = desktopRecoveryCopy(locale)
  if (state === undefined) return <><DesktopFrame /><main className="dshNativeContent flex h-screen items-center justify-center p-6"><Alert variant="destructive"><AlertTriangle /><AlertDescription>{copy.profilesUnavailable}</AlertDescription></Alert></main></>

  return <><DesktopFrame /><main className={cn('dshNativeContent h-screen overflow-hidden p-5 sm:p-6', state.busy && 'pointer-events-none opacity-70')}>
    <section className="mx-auto flex h-full w-full max-w-2xl flex-col gap-4">
      <h1 className="sr-only">{copy.tabs.profiles}</h1>
      <ScrollArea className="min-h-0 flex-1 pr-3">
        <div className="pb-1">
          <DesktopProfileSelector
            profiles={state.profiles}
            labels={{
              title: copy.profiles,
              description: copy.profilesBody,
              current: copy.currentProfile,
              select: copy.switchProfile,
              empty: copy.profilesEmpty,
              create: copy.addProfile,
            }}
            selectHref={name => href('switch', name)}
            createHref={href('create')}
          />
        </div>
      </ScrollArea>
      <RecoveryActionFooter leading={<RecoveryActionLink href={href('cancel')} icon={<ArrowLeft />}>{copy.back}</RecoveryActionLink>}>
        <RecoveryActionLink href={href('restart')} icon={<RotateCcw />} variant={state.restartReady ? 'default' : 'outline'}>{copy.restart}</RecoveryActionLink>
      </RecoveryActionFooter>
    </section>
  </main><RecoveryNoticeSurface notice={state.notice} /></>
}
