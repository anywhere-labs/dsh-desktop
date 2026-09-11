export class EventStore {
    records = [];
    append(event) {
        if (!this.records.some(record => record.eventId === event.eventId))
            this.records.push(event);
        return event;
    }
    list(taskId) {
        return this.records.filter(event => taskId === undefined || event.taskId === taskId);
    }
}
