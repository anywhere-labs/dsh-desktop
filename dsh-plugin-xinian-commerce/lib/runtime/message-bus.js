export class MessageBus {
    messages = [];
    publish(message) { this.messages.push(message); }
    claim(toAgent) {
        const index = this.messages.findIndex(message => message.toAgent === toAgent);
        if (index < 0)
            return { status: 'NO_PENDING_WORK' };
        return this.messages.splice(index, 1)[0];
    }
}
