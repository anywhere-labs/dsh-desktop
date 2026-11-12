import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import type { OfficialBundleCard } from '../src/client/plugin-controls.tsx'
import type { LaunchPresetBundle } from '../src/launch-presets.ts'
import { OFFICIAL_OAR_SUBAGENTS } from '../src/upstream-family-labels.ts'

const require = createRequire(import.meta.url)
const oarSubagents: OfficialBundleCard | undefined = OFFICIAL_OAR_SUBAGENTS
const oarPresets: LaunchPresetBundle | undefined = OFFICIAL_OAR_SUBAGENTS

it.runIf(oarSubagents !== undefined)('composes OAR subagents as the provider README example does, with Claude Code accepting file edits', () => {
  const manifest = require.resolve(`${oarSubagents!.bundle}/package.json`)
  const bundle = JSON.parse(readFileSync(manifest, 'utf8')).dsh?.bundle
  expect(bundle).toEqual({ patch: './cordis.patch.yml' })
  const example = /```yaml\n(- insert:\n[\s\S]*?)```/u.exec(readFileSync(join(dirname(manifest), 'README.md'), 'utf8'))?.[1]
  expect(example).toBeDefined()
  const expected = parse(example!)
  // The example keeps Claude Code read-only with dontAsk; Desktop lets it change files in the task's directory.
  const claude = expected[0].insert.find((row: { id: string }) => row.id === 'experimental-subagent-oar-claude')
  expect(claude.config.launchArgs).toEqual(['--permission-mode', 'dontAsk', '--permission-prompts', 'none'])
  claude.config.launchArgs[1] = 'acceptEdits'
  const rows = parse(readFileSync(join(dirname(manifest), bundle.patch), 'utf8'))
  expect(rows).toEqual(expected)
  // The Loader resolves each row's module from the installation.
  for (const row of rows[0].insert) expect(require.resolve(row.name)).toBeTruthy()
})

it.runIf(oarPresets !== undefined)('offers launch choices whose shipped one is each provider row as the bundle declares it', () => {
  const bundle = oarPresets!
  const manifest = require.resolve(`${bundle.bundle}/package.json`)
  const declared: { id: string; config: { launchArgs: string[] } }[] = parse(readFileSync(join(dirname(manifest), 'cordis.patch.yml'), 'utf8'))[0].insert
  for (const row of bundle.rows) {
    const shipped = row.presets.filter(preset => preset.shipped === true)
    expect(shipped, row.id).toHaveLength(1)
    expect(shipped[0]!.launchArgs, row.id).toEqual(declared.find(item => item.id === row.id)?.config.launchArgs)
    expect(new Set(row.presets.map(preset => preset.id)).size, row.id).toBe(row.presets.length)
  }
})
