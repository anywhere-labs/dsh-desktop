import { z } from 'zod'
import { businessEventSchema, type BusinessEvent } from '../event-core/contracts.js'
import { vocEventTypes, type VocEventType } from './contracts.js'

const payloadSchema = z.object({}).passthrough()

export function parseVocEvent(input: unknown): BusinessEvent {
  const event = businessEventSchema.parse(input)
  if (!vocEventTypes.includes(event.eventType as VocEventType)) throw new Error(`unsupported_voc_event:${event.eventType}`)
  payloadSchema.parse(event.payload)
  return event
}

