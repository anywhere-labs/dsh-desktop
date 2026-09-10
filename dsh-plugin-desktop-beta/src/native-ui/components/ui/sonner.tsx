import {
  CircleCheckIcon,
  InfoIcon,
  LoaderCircleIcon,
  OctagonXIcon,
  TriangleAlertIcon,
} from 'lucide-react'
import { Toaster as Sonner, type ToasterProps } from 'sonner'
import { cn } from '../../lib/utils.ts'

function Toaster({ className, toastOptions, ...props }: ToasterProps): JSX.Element {
  const defaultClassNames = {
    toast: 'group toast border-border bg-card text-card-foreground shadow-lg',
    description: 'text-muted-foreground',
    actionButton: 'bg-primary text-primary-foreground',
    cancelButton: 'bg-muted text-muted-foreground',
  }
  return <Sonner
    className={cn('toaster group', className)}
    icons={{
      success: <CircleCheckIcon className="size-4" />,
      info: <InfoIcon className="size-4" />,
      warning: <TriangleAlertIcon className="size-4" />,
      error: <OctagonXIcon className="size-4" />,
      loading: <LoaderCircleIcon className="size-4 animate-spin" />,
    }}
    theme="system"
    toastOptions={{
      ...toastOptions,
      classNames: { ...defaultClassNames, ...toastOptions?.classNames },
    }}
    {...props}
  />
}

export { Toaster }
