import { expect, it } from 'vitest'
import { LogLimiter } from '../src/log-limiter.ts'
import type { LogInput } from '../src/log-record.ts'

const line = (message: string, level: LogInput['level'] = 'info'): LogInput => ({ source: 'host.stderr', event: 'output', level, message, pid: 7 })
const minute = 60_000

it('writes a repeated line once and reports its count after one, five and every fifteen minutes', () => {
  const limiter = new LogLimiter()
  expect(limiter.admit(line('reconnect attempt 1 failed'), 0)).toHaveLength(1)
  for (let second = 10; second < 60; second += 10) expect(limiter.admit(line(`reconnect attempt ${second} failed`), second * 1000)).toEqual([])
  const first = limiter.admit(line('reconnect attempt 61 failed'), minute + 1000)
  expect(first).toEqual([expect.objectContaining({ event: 'output.repeated', message: 'reconnect attempt 1 failed', pid: 7, fields: expect.objectContaining({ repeats: 5 }) })])
  let counts: LogInput[] = []
  for (let time = minute + 11_000; time <= 22 * minute; time += 10_000) counts.push(...limiter.admit(line('reconnect attempt 9 failed'), time))
  expect(counts.map(count => count.fields?.repeats)).toEqual([30, 90])
  counts = limiter.drain(22 * minute + 1000, true)
  expect(counts).toEqual([expect.objectContaining({ event: 'output.repeated' })])
})

it('forgets a line that went quiet and writes it again when it comes back', () => {
  const limiter = new LogLimiter()
  limiter.admit(line('plugin ready'), 0)
  expect(limiter.nextDue()).toBeUndefined()
  expect(limiter.admit(line('plugin ready'), 1000)).toEqual([])
  expect(limiter.nextDue()).toBe(minute)
  expect(limiter.drain(2 * minute)).toEqual([expect.objectContaining({ event: 'output.repeated', fields: expect.objectContaining({ repeats: 1 }) })])
  expect(limiter.nextDue()).toBeUndefined()
  expect(limiter.admit(line('plugin ready'), 3 * minute)).toEqual([line('plugin ready')])
})

it('counts lines beyond the source budget, keeps other sources apart and reports the dropped count', () => {
  const limiter = new LogLimiter({ burst: 3, perSecond: 1, recentLines: 16, repeatIntervalsMs: [minute], droppedReportMs: 10_000 })
  const admitted = Array.from({ length: 6 }, (_, index) => limiter.admit(line(`distinct ${'x'.repeat(index)}`, index === 5 ? 'error' : 'info'), 0)).flat()
  expect(admitted).toHaveLength(3)
  expect(limiter.admit({ ...line('other source'), source: 'host.stdout' }, 0)).toHaveLength(1)
  expect(limiter.nextDue()).toBe(10_000)
  expect(limiter.drain(5000)).toEqual([])
  expect(limiter.admit(line('after refill'), 5000)).toEqual([
    expect.objectContaining({ source: 'host.stderr', event: 'output.dropped', level: 'warn', fields: expect.objectContaining({ dropped: 3, errors: 1 }) }),
    line('after refill'),
  ])
})

it('reports a pending count when its line is pushed out of the recent lines', () => {
  const limiter = new LogLimiter({ burst: 100, perSecond: 1, recentLines: 2, repeatIntervalsMs: [minute], droppedReportMs: 10_000 })
  limiter.admit(line('alpha'), 0); limiter.admit(line('alpha'), 1)
  limiter.admit(line('beta'), 2)
  expect(limiter.admit(line('gamma'), 3)).toEqual([expect.objectContaining({ event: 'output.repeated', message: 'alpha', fields: expect.objectContaining({ repeats: 1 }) }), line('gamma')])
})
