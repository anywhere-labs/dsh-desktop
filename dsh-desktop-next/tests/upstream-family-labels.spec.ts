import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'
import { parse } from 'yaml'
import type { OfficialBundleCard } from '../src/client/plugin-controls.tsx'
import type { LaunchPresetBundle } from '../src/launch-presets.ts'
import { OFFICIAL_OAR_SUBAGENTS, OFFICIAL_PLUGIN_INDEX } from '../src/upstream-family-labels.ts'

const require = createRequire(import.meta.url)
const meta = (locale: 'zh' | 'en'): { title?: unknown; description?: unknown } => JSON.parse(readFileSync(
  require.resolve(`@deepseek-ai/dsh-experimental-plugin-market-bundle/locale/${locale}.json`), 'utf8')).meta
// Releases before 0.2.2 still call the bundle a plugin market; Desktop shows the 0.2.2 name ahead of them.
const BEFORE_0_2_2 = { zh: '自定义插件市场', en: 'Custom plugin markets' }
const oarSubagents: OfficialBundleCard | undefined = OFFICIAL_OAR_SUBAGENTS
const oarPresets: LaunchPresetBundle | undefined = OFFICIAL_OAR_SUBAGENTS

it('names the official plugin index bundle exactly as the installed release does from 0.2.2 on', () => {
  for (const locale of ['zh', 'en'] as const) {
    if (meta(locale).title === BEFORE_0_2_2[locale]) continue
    expect(meta(locale).title, locale).toBe(OFFICIAL_PLUGIN_INDEX.title[locale])
    expect(meta(locale).description, locale).toBe(OFFICIAL_PLUGIN_INDEX.description[locale])
  }
})

it.runIf(oarSubagents !== undefined)('names OAR subagents exactly as the installed provider does and ships it as an optional bundle', () => {
  const card = oarSubagents!
  for (const locale of ['zh', 'en'] as const) {
    const provider = JSON.parse(readFileSync(require.resolve(`${card.bundle}/locale/${locale}.json`), 'utf8')).meta
    expect(provider.title, locale).toBe(card.title[locale])
    expect(provider.description, locale).toBe(card.description[locale])
  }
  const installation = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  expect(installation.dsh.optionalBundles).toContain(card.bundle)
  expect(Object.hasOwn(installation.dependencies, card.bundle)).toBe(true)
})

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
