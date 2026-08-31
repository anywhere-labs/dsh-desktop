import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  watchDesktopPatchLayer,
  type DesktopPatchWatchHost,
  type RootIncludeConfig,
} from '../src/patch-watcher.ts'

interface FakeIncludeEntry {
  options: { config: RootIncludeConfig }
  updates: RootIncludeConfig[]
  failNextUpdate: boolean
  update(options: { config: RootIncludeConfig }): Promise<void>
}

function fakeIncludeEntry(): FakeIncludeEntry {
  const entry: FakeIncludeEntry = {
    options: { config: { path: pathToFileURL(join(tmpdir(), 'root-cordis.yml')).href } },
    updates: [],
    failNextUpdate: false,
    async update(options) {
      if (entry.failNextUpdate) {
        entry.failNextUpdate = false
        throw new Error('injected update failure')
      }
      entry.updates.push(options.config)
    },
  }
  return entry
}

function fakeHost(include: FakeIncludeEntry) {
  const logs: string[] = []
  return {
    logs,
    host: {
      loader: { resolve: (id: string) => (id === 'include' ? include : undefined) },
      logger: {
        info: (message: string) => { logs.push(message) },
        error: (message: string) => { logs.push(message) },
      },
    } satisfies DesktopPatchWatchHost,
  }
}

async function until(condition: () => boolean, timeoutMs = 5000): Promise<void> {
  const start = Date.now()
  while (!condition()) {
    if (Date.now() - start > timeoutMs) throw new Error('condition not met within timeout')
    await new Promise(resolve => setTimeout(resolve, 20))
  }
}

const tempDirs: string[] = []

function temporaryDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-patch-watch-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

describe('watchDesktopPatchLayer', () => {
  it('re-applies the composed patches after a file change', async () => {
    const dir = temporaryDir()
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const include = fakeIncludeEntry()
    const { host, logs } = fakeHost(include)
    const composed: PatchOptions[] = [{ id: 'probe', name: 'probe-plugin' }]
    const dispose = await watchDesktopPatchLayer(host, {
      binName: 'dsh-plugin-desktop',
      filenames: [patchPath],
      compose: () => composed,
      debounceMs: 20,
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    writeFileSync(patchPath, '- insert:\n    - id: probe\n      name: probe-plugin\n')
    await until(() => include.updates.length === 1)
    expect(include.updates[0]!.path).toBe(include.options.config.path)
    expect(include.updates[0]!.patches).toEqual(composed)
    expect(logs.some(line => line.includes('re-applied desktop patch layer'))).toBe(true)
    await dispose()
  })

  it('coalesces a burst of saves into one re-apply', async () => {
    const dir = temporaryDir()
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const include = fakeIncludeEntry()
    const { host } = fakeHost(include)
    let composeCalls = 0
    const dispose = await watchDesktopPatchLayer(host, {
      binName: 'dsh-plugin-desktop',
      filenames: [patchPath],
      compose: () => {
        composeCalls += 1
        return []
      },
      debounceMs: 50,
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    writeFileSync(patchPath, '# burst 1\n')
    writeFileSync(patchPath, '# burst 2\n')
    writeFileSync(patchPath, '# burst 3\n')
    await new Promise(resolve => setTimeout(resolve, 400))
    expect(include.updates.length).toBe(1)
    expect(composeCalls).toBeLessThanOrEqual(2)
    await dispose()
  })

  it('keeps the previous generation when compose throws', async () => {
    const dir = temporaryDir()
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const include = fakeIncludeEntry()
    const { host, logs } = fakeHost(include)
    const dispose = await watchDesktopPatchLayer(host, {
      binName: 'dsh-plugin-desktop',
      filenames: [patchPath],
      compose: () => {
        throw new Error('malformed patch layer')
      },
      debounceMs: 20,
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    writeFileSync(patchPath, '# trigger\n')
    await until(() => logs.some(line => line.includes('malformed patch layer')))
    expect(include.updates.length).toBe(0)
    expect(logs.some(line => line.includes('keeping previous generation'))).toBe(true)
    await dispose()
  })

  it('keeps watching after an update failure and recovers', async () => {
    const dir = temporaryDir()
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const include = fakeIncludeEntry()
    const { host, logs } = fakeHost(include)
    const dispose = await watchDesktopPatchLayer(host, {
      binName: 'dsh-plugin-desktop',
      filenames: [patchPath],
      compose: () => [],
      debounceMs: 20,
    })
    include.failNextUpdate = true
    await new Promise(resolve => setTimeout(resolve, 100))
    writeFileSync(patchPath, '# first\n')
    await until(() => logs.some(line => line.includes('injected update failure')))
    expect(include.updates.length).toBe(0)
    await new Promise(resolve => setTimeout(resolve, 300))
    writeFileSync(patchPath, '# second\n')
    await until(() => include.updates.length === 1)
    await dispose()
  })

  it('stops reacting after disposal', async () => {
    const dir = temporaryDir()
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const include = fakeIncludeEntry()
    const { host } = fakeHost(include)
    const dispose = await watchDesktopPatchLayer(host, {
      binName: 'dsh-plugin-desktop',
      filenames: [patchPath],
      compose: () => [],
      debounceMs: 20,
    })
    await new Promise(resolve => setTimeout(resolve, 100))
    writeFileSync(patchPath, '# before dispose\n')
    await until(() => include.updates.length === 1)
    await dispose()
    writeFileSync(patchPath, '# after dispose\n')
    await new Promise(resolve => setTimeout(resolve, 300))
    expect(include.updates.length).toBe(1)
  })

  it('rejects when the root include entry is unavailable', async () => {
    const dir = temporaryDir()
    const patchPath = join(dir, 'cordis.patch.yml')
    writeFileSync(patchPath, '[]\n')
    const { host } = fakeHost(fakeIncludeEntry())
    host.loader.resolve = () => undefined
    await expect(watchDesktopPatchLayer(host, {
      binName: 'dsh-plugin-desktop',
      filenames: [patchPath],
      compose: () => [],
    })).rejects.toThrow('root include entry is unavailable')
  })
})
