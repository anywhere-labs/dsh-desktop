import { PreviewCard as HoverCardPrimitive } from '@base-ui/react/preview-card'
import { cn } from '../../lib/utils.ts'

function HoverCard(props: HoverCardPrimitive.Root.Props): JSX.Element {
  return <HoverCardPrimitive.Root {...props} />
}

function HoverCardTrigger(props: HoverCardPrimitive.Trigger.Props): JSX.Element {
  return <HoverCardPrimitive.Trigger data-slot="hover-card-trigger" {...props} />
}

function HoverCardContent({
  align = 'center',
  alignOffset = 0,
  className,
  side = 'bottom',
  sideOffset = 6,
  ...props
}: HoverCardPrimitive.Popup.Props & Pick<
  HoverCardPrimitive.Positioner.Props,
  'align' | 'alignOffset' | 'side' | 'sideOffset'
>): JSX.Element {
  return (
    <HoverCardPrimitive.Portal>
      <HoverCardPrimitive.Positioner
        align={align}
        alignOffset={alignOffset}
        className="dshShadcnHoverCardPositioner z-50 outline-none"
        side={side}
        sideOffset={sideOffset}
      >
        <HoverCardPrimitive.Popup
          className={cn(
            'dshShadcnHoverCardContent w-64 origin-(--transform-origin) rounded-lg border bg-popover p-4 text-popover-foreground shadow-md outline-none transition-[opacity,transform] data-ending-style:scale-95 data-ending-style:opacity-0 data-starting-style:scale-95 data-starting-style:opacity-0',
            className,
          )}
          data-slot="hover-card-content"
          {...props}
        />
      </HoverCardPrimitive.Positioner>
    </HoverCardPrimitive.Portal>
  )
}

export { HoverCard, HoverCardContent, HoverCardTrigger }
