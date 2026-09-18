import { Plus } from 'lucide-react'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '../components/ui/card.tsx'
import { buttonVariants } from '../components/ui/button.tsx'

export interface DesktopProfileSelectorItem {
  readonly name: string
  readonly current: boolean
  readonly selectable: boolean
}

export interface DesktopProfileSelectorLabels {
  readonly title: string
  readonly description: string
  readonly current: string
  readonly select: string
  readonly empty: string
  readonly create: string
}

export interface DesktopProfileSelectorProps {
  readonly profiles: readonly DesktopProfileSelectorItem[]
  readonly labels: DesktopProfileSelectorLabels
  readonly selectHref: (name: string) => string | undefined
  readonly createHref?: string
}

/** Shared Profile chooser used by Recovery and startup compatibility admission. */
export function DesktopProfileSelector({
  profiles,
  labels,
  selectHref,
  createHref,
}: DesktopProfileSelectorProps): JSX.Element {
  const hasAlternative = profiles.some(profile => !profile.current && profile.selectable)
  return <Card className="w-full overflow-hidden">
    <CardHeader>
      <CardTitle>{labels.title}</CardTitle>
      <CardDescription>{labels.description}</CardDescription>
    </CardHeader>
    <CardContent className="divide-y p-0">
      {profiles.map(profile => {
        const href = profile.current || !profile.selectable ? undefined : selectHref(profile.name)
        return <div className="flex items-center justify-between gap-4 px-6 py-3" key={profile.name}>
          <span className="min-w-0 truncate text-sm font-medium">{profile.name}</span>
          {profile.current
            ? <span className="rounded-full bg-muted px-2 py-1 text-xs">{labels.current}</span>
            : href === undefined
              ? null
              : <a className={buttonVariants({ variant: 'outline' })} href={href}>{labels.select}</a>}
        </div>
      })}
      {hasAlternative ? null : <p className="px-6 py-5 text-sm text-muted-foreground">{labels.empty}</p>}
    </CardContent>
    {createHref === undefined ? null : <CardFooter className="justify-end pt-6">
      <a className={buttonVariants({ variant: 'outline' })} href={createHref}><Plus />{labels.create}</a>
    </CardFooter>}
  </Card>
}
