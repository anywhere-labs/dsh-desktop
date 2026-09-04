import type { BusinessEvent } from './contracts.js'
import { EventLedger } from './ledger.js'

export type EventRoute = {
  readonly eventType: string
  readonly agentId: string
  readonly riskLevel: 'low' | 'medium' | 'high'
  readonly humanGate: boolean
}

export class EventRouter {
  private readonly routes: EventRoute[] = []

  constructor(private readonly ledger: EventLedger) {}

  register(route: EventRoute, handler: (event: BusinessEvent) => void | Promise<void>): void {
    this.routes.push(route)
    this.ledger.subscribe(route.eventType, handler)
  }

  routesFor(eventType: string): readonly EventRoute[] {
    return this.routes.filter(route => route.eventType === eventType)
  }
}
