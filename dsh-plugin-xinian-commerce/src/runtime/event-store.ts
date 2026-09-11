import type { EventRecord } from '../contracts/index.js'

export class EventStore {
  private readonly records: EventRecord[] = []
  append(event: EventRecord): EventRecord {
    if (!this.records.some(record => record.eventId === event.eventId)) this.records.push(event)
    return event
  }
  list(taskId?: string): readonly EventRecord[] {
    return this.records.filter(event => taskId === undefined || event.taskId === taskId)
  }
}
