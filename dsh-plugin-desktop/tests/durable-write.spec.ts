import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One file-level factory for node:fs (re-registering vi.mock per test
// interferes with vitest's hoisted mock registry); tests switch the mode.
const state = vi.hoisted(() => ({ mode: 'passthrough' as 'passthrough' | 'enospc' | 'short', calls: 0 }))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const realWriteSync = actual.writeSync
  return {
    ...actual,
    writeSync: vi.fn(((fd: number, buffer: Uint8Array, offset?: number) => {
      if (state.mode === 'enospc') {
        const cause = new Error('no space left on device') as NodeJS.ErrnoException
        cause.code = 'ENOSPC'
        throw cause
      }
      state.calls += 1
      if (state.mode === 'short' && state.calls === 1) {
        // Simulate a short first write of 4 bytes.
        return realWriteSync(fd, buffer, 0, 4)
      }
      return realWriteSync(fd, buffer, offset ?? 0)
    }) as typeof actual.writeSync),
  }
})

const roots: string[] = []

beforeEach(() => {
  vi.resetModules()
  state.mode = 'passthrough'
  state.calls = 0
})

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('writeDurableFile', () => {
  it('cleans up the temporary and preserves the target when the write fails', async () => {
    state.mode = 'enospc'
    const directory = mkdtempSync(join(tmpdir(), 'dsh-durable-write-'))
    roots.push(directory)
    const target = join(directory, 'config.json')
    writeFileSync(target, 'original')

    const { writeDurableFile } = await import('../src/durable-write.ts')
    expect(() => writeDurableFile(target, Buffer.from('replacement', 'utf8'))).toThrow('no space left on device')

    expect(readFileSync(target, 'utf8')).toBe('original')
    expect(readdirSync(directory).filter(name => name.includes('.tmp'))).toEqual([])
  })

  it('loops when writeSync writes fewer bytes than requested', async () => {
    state.mode = 'short'
    const directory = mkdtempSync(join(tmpdir(), 'dsh-durable-write-loop-'))
    roots.push(directory)
    const target = join(directory, 'config.json')

    const { writeDurableFile } = await import('../src/durable-write.ts')
    writeDurableFile(target, Buffer.from('a-much-longer-payload', 'utf8'))

    expect(state.calls).toBe(2)
    expect(readFileSync(target, 'utf8')).toBe('a-much-longer-payload')
  })
})
