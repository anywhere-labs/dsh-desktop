import type { AcquisitionBundle } from '../browser-acquisition/contracts.js'

export type AnalysisSubscriber = (bundle: AcquisitionBundle) => void | Promise<void>

export class ParallelBus {
  private readonly subscribers: AnalysisSubscriber[] = []

  subscribe(subscriber: AnalysisSubscriber): () => void {
    this.subscribers.push(subscriber)
    return () => { const index = this.subscribers.indexOf(subscriber); if (index >= 0) this.subscribers.splice(index, 1) }
  }

  async publish(bundle: AcquisitionBundle): Promise<{ readonly delivered: number; readonly failures: readonly string[] }> {
    const results = await Promise.allSettled(this.subscribers.map(subscriber => subscriber(bundle)))
    return { delivered: results.filter(result => result.status === 'fulfilled').length, failures: results.filter((result): result is PromiseRejectedResult => result.status === 'rejected').map(result => result.reason instanceof Error ? result.reason.message : String(result.reason)) }
  }
}
