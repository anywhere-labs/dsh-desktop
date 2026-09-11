type PendingMessage = { id: string; toAgent: string; payload: Record<string, unknown> }

export class MessageBus {
  private readonly messages: PendingMessage[] = []
  publish(message: PendingMessage): void { this.messages.push(message) }
  claim(toAgent: string): PendingMessage | { status: 'NO_PENDING_WORK' } {
    const index = this.messages.findIndex(message => message.toAgent === toAgent)
    if (index < 0) return { status: 'NO_PENDING_WORK' }
    return this.messages.splice(index, 1)[0]!
  }
}
