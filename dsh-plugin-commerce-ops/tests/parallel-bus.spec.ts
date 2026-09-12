import { describe, expect, it } from 'vitest'
import { ParallelBus } from '../src/parallel-bus/fanout.js'

describe('ParallelBus', () => {
  it('fans out one acquisition bundle to every read-only analysis subscriber', async () => {
    const bus = new ParallelBus()
    const received: string[] = []
    bus.subscribe(bundle => { received.push(`quality:${bundle.acquisitionId}`) })
    bus.subscribe(bundle => { received.push(`insight:${bundle.acquisitionId}`) })
    const result = await bus.publish({ acquisitionId: 'acq_001' } as never)
    expect(result).toEqual({ delivered: 2, failures: [] })
    expect(received).toEqual(['quality:acq_001', 'insight:acq_001'])
  })
})
