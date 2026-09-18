import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import {
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  prepareMacUniversalRuntime,
} from '../scripts/mac-universal.ts'

describe('universal macOS native runtime preparation', () => {
  // fs-ext is the only universal entry whose filename moves with the Electron ABI. Spelling
  // that number out made this spec the last thing standing between an ABI bump and a green
  // `check` job, and it lost: bumping Electron turned a previously green job red instead of
  // catching the drift. Derive the number so the assertion survives the next bump.
  it('tracks the fs-ext binding for both CPU architectures at the installed Electron ABI', () => {
    const abi = readFileSync(
      fileURLToPath(new URL('../node_modules/electron/abi_version', import.meta.url)),
      'utf8',
    ).trim()
    expect(abi).toMatch(/^\d+$/)

    expect(MACOS_UNIVERSAL_NATIVE_ENTRIES).toEqual(expect.arrayContaining([
      {
        arch: 'arm64',
        path: `node_modules/fs-ext/prebuilds/darwin-arm64/electron.abi${abi}.node`,
      },
      {
        arch: 'x86_64',
        path: `node_modules/fs-ext/prebuilds/darwin-x64/electron.abi${abi}.node`,
      },
    ]))
  })

  it('requires every CPU-specific file and repairs both node-pty helpers', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacUniversalRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when one architecture is incomplete', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES.at(-1)!.path

    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })
})
