import type { EventRecord } from '../contracts/index.js';
export declare class EventStore {
    private readonly records;
    append(event: EventRecord): EventRecord;
    list(taskId?: string): readonly EventRecord[];
}
