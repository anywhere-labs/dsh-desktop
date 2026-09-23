import { readFileSync } from 'node:fs'
import { expect, it } from 'vitest'

it('keeps panel actions and diagnostics compatible with both AA entry names and languages', () => {
  for (const file of ['plugin-controls.tsx', 'index.ts']) {
    const source = readFileSync(new URL(`../src/client/${file}`, import.meta.url), 'utf8')
    for (const label of ['远程控制', 'Remote Control', '手机连接', 'Mobile connection']) {
      expect(source).toContain(`[aria-label="${label}"]`)
    }
  }
})

it('uses the new entry name in Chinese and English setup guidance', () => {
  const controls = readFileSync(new URL('../src/client/plugin-controls.tsx', import.meta.url), 'utf8')
  const onboarding = readFileSync(new URL('../src/native-ui/onboarding.tsx', import.meta.url), 'utf8')
  for (const source of [controls, onboarding]) {
    expect(source).toContain('侧边栏的“远程控制”')
    expect(source).toContain('Remote Control')
    expect(source).not.toMatch(/侧边栏的“手机连接”|Phone connection|Phone connect/)
  }
})
