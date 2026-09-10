import { useEffect, type ReactNode } from 'react'
import { toast } from 'sonner'
import { buttonVariants } from '../components/ui/button.tsx'
import { Toaster } from '../components/ui/sonner.tsx'
import { cn } from '../lib/utils.ts'

export type RecoveryActionVariant = 'default' | 'outline' | 'secondary' | 'destructive'

export interface RecoveryNotice {
  readonly tone: 'info' | 'success' | 'warning' | 'error'
  readonly title: string
  readonly body: string
}

/** Shared link styling for actions emitted by local Recovery-family documents. */
export function RecoveryActionLink({
  children,
  className,
  href,
  icon,
  variant = 'outline',
}: {
  readonly children: ReactNode
  readonly className?: string | undefined
  readonly href: string
  readonly icon?: ReactNode
  readonly variant?: RecoveryActionVariant
}): JSX.Element {
  return <a className={cn(buttonVariants({ variant }), className)} href={href}>{icon}{children}</a>
}

/** Keep one leading action on the left and the remaining actions on the right. */
export function RecoveryActionFooter({
  children,
  leading,
}: {
  readonly children: ReactNode
  readonly leading?: ReactNode
}): JSX.Element {
  return <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t pt-4">
    {leading === undefined ? null : <div className="mr-auto flex items-center">{leading}</div>}
    {children}
  </footer>
}

function RecoveryNoticeEffect({ notice }: { readonly notice: RecoveryNotice }): null {
  useEffect(() => {
    const options = { id: 'dsh-recovery-notice', description: notice.body, duration: 8_000 }
    if (notice.tone === 'success') toast.success(notice.title, options)
    else if (notice.tone === 'warning') toast.warning(notice.title, options)
    else if (notice.tone === 'error') toast.error(notice.title, options)
    else toast.info(notice.title, options)
  }, [notice.body, notice.title, notice.tone])
  return null
}

/** Shared Recovery-style notification surface for native Desktop windows. */
export function RecoveryNoticeSurface({ notice }: { readonly notice: RecoveryNotice | undefined }): JSX.Element {
  return <>
    {notice === undefined ? null : <RecoveryNoticeEffect notice={notice} />}
    <Toaster closeButton offset={{ top: 52, right: 24 }} position="top-right" richColors />
  </>
}
