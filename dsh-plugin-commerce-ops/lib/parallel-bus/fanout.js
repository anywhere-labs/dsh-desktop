export class ParallelBus {
    subscribers = [];
    subscribe(subscriber) {
        this.subscribers.push(subscriber);
        return () => { const index = this.subscribers.indexOf(subscriber); if (index >= 0)
            this.subscribers.splice(index, 1); };
    }
    async publish(bundle) {
        const results = await Promise.allSettled(this.subscribers.map(subscriber => subscriber(bundle)));
        return { delivered: results.filter(result => result.status === 'fulfilled').length, failures: results.filter((result) => result.status === 'rejected').map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)) };
    }
}
