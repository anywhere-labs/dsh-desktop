import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { cpSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { expect, it } from 'vitest'
import { verifyBundledSkills } from '../src/packaged-filesystem-smoke.ts'

it('discovers and reads shipped Cordis skills through fs-local in a plain app directory', async () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-packaged-skills-'))
  try {
    const app = join(root, 'resources', 'app')
    const preset = join(app, 'node_modules', '@deepseek-ai', 'dsh-agent-presets')
    mkdirSync(preset, { recursive: true })
    const require = createRequire(import.meta.url)
    cpSync(join(dirname(require.resolve('@deepseek-ai/dsh-agent-presets/package.json')), 'presets'),
      join(preset, 'presets'), { recursive: true })
    await expect(verifyBundledSkills(app)).resolves.toBeUndefined()
    rmSync(join(preset, 'presets', 'cordis', 'skills', 'cordis-plugin-development'), { recursive: true })
    await expect(verifyBundledSkills(app)).rejects.toThrow('bundled skill is unavailable: cordis-plugin-development')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
