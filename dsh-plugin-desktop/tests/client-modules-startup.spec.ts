import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { describe, expect, it } from 'vitest'

// Exercise the installed patch: incorrect line counts shift every later
// source-map section, including for bundles containing non-BMP characters.
const installed = readFileSync(new URL(import.meta.resolve('@deepseek-ai/dsh-client-modules')), 'utf8')
const helper = installed.match(/function newlineCount\(value\) \{[\s\S]*?\n\}/u)?.[0]
if (helper === undefined) throw new Error('client-modules line counter changed; review the Desktop startup patch')
const newlineCount = runInNewContext(`(${helper})`) as (source: string) => number

describe('installed client combo source-map line offsets', () => {
  it.each([
    ['', 0], ['no final newline', 0], ['\n', 1], ['\n\n', 2],
    ['first\r\nsecond\r\n', 2], ['first\rsecond', 0],
    ['中文😀\n𠮷\nlast', 2], ['\u2028\u2029\n\0', 1],
  ] as const)('counts LF offsets for %j', (source, expected) => {
    expect(newlineCount(source)).toBe(expected)
  })

  it('preserves indexed-map section offsets for long minified and multiline bundles', () => {
    const bundles = ['x'.repeat(2_000_000) + '\n;\n', '中文😀\r\n'.repeat(20_000), 'last\n']
    let offset = 0
    const offsets = bundles.map(source => {
      const start = offset
      offset += newlineCount(source)
      return start
    })
    expect(offsets).toEqual([0, 2, 20_002])
    expect(offset).toBe(20_003)
  })
})
