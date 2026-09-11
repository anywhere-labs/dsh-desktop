import { type CommerceTask, type EventRecord, type TaskState } from '../contracts/index.js';
import { EventStore } from './event-store.js';
export declare class TaskStore {
    private readonly eventStore;
    private readonly records;
    constructor(eventStore: EventStore);
    create(input: Pick<CommerceTask, 'type' | 'productId' | 'storeIds' | 'input' | 'approvalRequired'>): CommerceTask;
    get(id: string): CommerceTask;
    list(): CommerceTask[];
    attachOutputs(id: string, outputs: CommerceTask['outputs']): CommerceTask;
    transition(id: string, toState: TaskState, actorId: string, summary?: string): CommerceTask;
    events(id: string): readonly EventRecord[];
}
