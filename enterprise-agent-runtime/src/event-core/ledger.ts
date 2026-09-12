import { businessEventSchema, type BusinessEvent } from './contracts.js'

export type EventHandler = (event: BusinessEvent) => void | Promise<void>

export interface EventStore {
  read(): readonly BusinessEvent[]
  append(event: BusinessEvent): void
}

export class EventLedger {
  private readonly events: BusinessEvent[] = []
  private readonly handlers = new Map<string, EventHandler[]>()

  constructor(private readonly store?: EventStore) {
    this.events.push(...(store?.read() ?? []))
  }

  subscribe(eventType: string, handler: EventHandler): () => void {
    const list = this.handlers.get(eventType) ?? []
    list.push(handler)
    this.handlers.set(eventType, list)
    return () => {
      const current = this.handlers.get(eventType) ?? []
      this.handlers.set(eventType, current.filter(item => item !== handler))
    }
  }

  async append(input: BusinessEvent): Promise<BusinessEvent> {
    const event = businessEventSchema.parse(input)
    if (this.events.some(item => item.eventId === event.eventId)) return event
    this.store?.append(event)
    this.events.push(event)
    const handlers = [...(this.handlers.get(event.eventType) ?? []), ...(this.handlers.get('*') ?? [])]
    await Promise.all(handlers.map(handler => handler(event)))
    return event
  }

  list(filter?: { readonly tenantId?: string; readonly correlationId?: string }): readonly BusinessEvent[] {
    return this.events.filter(event => (!filter?.tenantId || event.tenantId === filter.tenantId) && (!filter?.correlationId || event.correlationId === filter.correlationId))
  }
}
