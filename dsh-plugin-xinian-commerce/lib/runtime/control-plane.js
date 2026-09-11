import { randomUUID } from 'node:crypto';
import { CommerceTaskSchema } from '../contracts/index.js';
const transitions = {
    INTAKE: ['PLANNED', 'WAITING_INPUT', 'CANCELLED'], PLANNED: ['READY', 'WAITING_INPUT', 'CANCELLED'], READY: ['RUNNING', 'CANCELLED'],
    RUNNING: ['VERIFYING', 'WAITING_INPUT', 'REPAIRING', 'FAILED', 'CANCELLED'], VERIFYING: ['ACCEPTED', 'REPAIRING', 'FAILED'],
    ACCEPTED: ['DELIVERED', 'BLOCKED'], DELIVERED: ['ARCHIVED'], ARCHIVED: [], WAITING_INPUT: ['READY', 'CANCELLED'],
    REPAIRING: ['RUNNING', 'FAILED', 'BLOCKED'], BLOCKED: ['READY', 'CANCELLED'], FAILED: ['REPAIRING', 'CANCELLED'], CANCELLED: [], EXPIRED: [],
};
export class TaskStore {
    eventStore;
    records = new Map();
    constructor(eventStore) {
        this.eventStore = eventStore;
    }
    create(input) {
        const now = new Date().toISOString();
        const task = CommerceTaskSchema.parse({ id: randomUUID(), ...input, state: 'INTAKE', outputs: [], createdAt: now, updatedAt: now });
        this.records.set(task.id, task);
        return task;
    }
    get(id) { const task = this.records.get(id); if (!task)
        throw new Error('task not found'); return task; }
    list() { return [...this.records.values()]; }
    attachOutputs(id, outputs) { const updated = { ...this.get(id), outputs, updatedAt: new Date().toISOString() }; this.records.set(id, updated); return updated; }
    transition(id, toState, actorId, summary = `task moved to ${toState}`) {
        const current = this.get(id);
        if (!transitions[current.state].includes(toState))
            throw new Error(`illegal task transition: ${current.state} -> ${toState}`);
        const updated = { ...current, state: toState, updatedAt: new Date().toISOString() };
        this.records.set(id, updated);
        const event = { eventId: randomUUID(), taskId: id, type: 'task.state.changed', fromState: current.state, toState, actorId, timestamp: updated.updatedAt, correlationId: id, summary };
        this.eventStore.append(event);
        return updated;
    }
    events(id) { return this.eventStore.list(id); }
}
