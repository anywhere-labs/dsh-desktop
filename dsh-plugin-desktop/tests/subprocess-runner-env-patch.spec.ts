import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-subprocess-local@0.1.5-rc.1.patch',
  import.meta.url,
), 'utf8')

describe('subprocess runner environment patch (#943)', () => {
  it('keeps the Windows private-runner guard intact', () => {
    for (const marker of [
      'if (selection === WINDOWS_RUNNER_SELECTION && process.platform === "win32" && process.versions.electron !== void 0) {',
      'env.ELECTRON_RUN_AS_NODE = "1";',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('extends Node-mode launch to the Linux scoped runner (#943)', () => {
    for (const marker of [
      'if (selection !== WINDOWS_RUNNER_SELECTION && process.versions.electron !== void 0) {',
      'env.ELECTRON_RUN_AS_NODE = "1";',
      '// #943: the Linux scoped launch re-executes the packaged entry — the',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('leaves the scrub loop and selection plumbing untouched', () => {
    for (const marker of [
      'const normalized = name.toUpperCase();',
      'if (RUNNER_CONTROL_ENV_PREFIXES.some((prefix) => normalized.startsWith(prefix))) Reflect.deleteProperty(env, name);',
      '[SUBPROCESS_RUNNER_ENV]: selection,',
    ]) {
      expect(patch).toContain(marker)
    }
  })
})
