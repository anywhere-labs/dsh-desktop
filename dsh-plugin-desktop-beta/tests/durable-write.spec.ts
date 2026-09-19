import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// One file-level factory for node:fs (re-registering vi.mock per test
// interferes with vitest's hoisted mock registry); tests switch the mode.
const state = vi.hoisted(() => ({
  mode: 'passthrough' as 'passthrough' | 'enospc' | 'short',
  calls: 0,
  renameFailures: 0,
}))

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  const realWriteSync = actual.writeSync
  const realRenameSync = actual.renameSync
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
    renameSync: vi.fn(((from: string, to: string) => {
      if (state.renameFailures > 0) {
        state.renameFailures -= 1
        // Windows share conflict: another process holds the destination
        // without FILE_SHARE_DELETE (antivirus, indexer, the Host itself).
        const cause = new Error('resource busy or locked') as NodeJS.ErrnoException
        cause.code = 'EBUSY'
        throw cause
      }
      return realRenameSync(from, to)
    }) as typeof actual.renameSync),
  }
})

const roots: string[] = []

beforeEach(() => {
  vi.resetModules()
  state.mode = 'passthrough'
  state.calls = 0
  state.renameFailures = 0
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

  it.skipIf(process.platform === 'win32')('applies the caller-supplied mode to an existing file unless inheritance is requested', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-durable-write-mode-'))
    roots.push(directory)
    const path = join(directory, 'config.yaml')
    writeFileSync(path, 'old\n', { mode: 0o640 })
    expect(statSync(path).mode & 0o777).toBe(0o640)

    const { writeDurableFile } = await import('../src/durable-write.ts')
    // The mode is an instruction, not a default: checkpoint restore replays
    // the mode captured at snapshot time over the current (broken) file.
    writeDurableFile(path, Buffer.from('new\n', 'utf8'), 0o600)

    expect(readFileSync(path, 'utf8')).toBe('new\n')
    expect(statSync(path).mode & 0o777).toBe(0o600)
  })

  it.skipIf(process.platform === 'win32')('inherits the existing mode only when inheritExistingMode is set', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-durable-write-inherit-'))
    roots.push(directory)
    const path = join(directory, 'config.yaml')
    writeFileSync(path, 'old\n', { mode: 0o640 })
    expect(statSync(path).mode & 0o777).toBe(0o640)

    const { writeDurableFile } = await import('../src/durable-write.ts')
    writeDurableFile(path, Buffer.from('new\n', 'utf8'), 0o600, { inheritExistingMode: true })

    // An atomic replacement must not widen an administrator- or user-tightened
    // mode through the default; configuration call sites opt in.
    expect(readFileSync(path, 'utf8')).toBe('new\n')
    expect(statSync(path).mode & 0o777).toBe(0o640)
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

  it('retries the rename over Windows share conflicts and cleans up when the budget is spent', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'dsh-durable-write-retry-'))
    roots.push(directory)
    const target = join(directory, 'config.json')
    writeFileSync(target, 'old')

    const { writeDurableFile } = await import('../src/durable-write.ts')
    // A holder that lets go after two conflicts is absorbed by the backoff.
    state.renameFailures = 2
    writeDurableFile(target, Buffer.from('recovered', 'utf8'))
    expect(readFileSync(target, 'utf8')).toBe('recovered')

    // A holder that never lets go exhausts the backoff budget and surfaces.
    state.renameFailures = 99
    expect(() => writeDurableFile(target, Buffer.from('blocked', 'utf8'))).toThrow('resource busy or locked')
    expect(readFileSync(target, 'utf8')).toBe('recovered')
    expect(readdirSync(directory).filter(name => name.includes('.tmp'))).toEqual([])
  })
})
