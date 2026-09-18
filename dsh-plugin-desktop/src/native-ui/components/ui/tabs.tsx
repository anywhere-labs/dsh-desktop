import { Tabs as TabsPrimitive } from '@base-ui/react/tabs'
import type { ComponentProps } from 'react'
import { cn } from '../../lib/utils.ts'

function Tabs({ className, ...props }: ComponentProps<typeof TabsPrimitive.Root>): JSX.Element {
  return <TabsPrimitive.Root className={cn('flex min-h-0 flex-1 flex-col', className)} data-slot="tabs" {...props} />
}

function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>): JSX.Element {
  return <TabsPrimitive.List activateOnFocus className={cn('inline-flex h-10 w-fit items-center gap-1 rounded-xl bg-muted p-1 text-muted-foreground', className)} data-slot="tabs-list" {...props} />
}

function TabsTrigger({ className, ...props }: ComponentProps<typeof TabsPrimitive.Tab>): JSX.Element {
  return <TabsPrimitive.Tab className={cn('inline-flex h-8 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium whitespace-nowrap outline-none transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/30 data-[active]:bg-background data-[active]:text-foreground data-[active]:shadow-sm disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4', className)} data-slot="tabs-trigger" {...props} />
}

function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Panel>): JSX.Element {
  return <TabsPrimitive.Panel className={cn('min-h-0 flex-1 outline-none', className)} data-slot="tabs-content" {...props} />
}

export { Tabs, TabsContent, TabsList, TabsTrigger }
