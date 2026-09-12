import { z } from 'zod';
import { businessEventSchema } from '../event-core/contracts.js';
import { vocEventTypes } from './contracts.js';
const payloadSchema = z.object({}).passthrough();
export function parseVocEvent(input) {
    const event = businessEventSchema.parse(input);
    if (!vocEventTypes.includes(event.eventType))
        throw new Error(`unsupported_voc_event:${event.eventType}`);
    payloadSchema.parse(event.payload);
    return event;
}
