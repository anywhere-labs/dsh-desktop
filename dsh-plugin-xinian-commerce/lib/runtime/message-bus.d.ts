type PendingMessage = {
    id: string;
    toAgent: string;
    payload: Record<string, unknown>;
};
export declare class MessageBus {
    private readonly messages;
    publish(message: PendingMessage): void;
    claim(toAgent: string): PendingMessage | {
        status: 'NO_PENDING_WORK';
    };
}
export {};
