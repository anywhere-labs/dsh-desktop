import { expect, it } from 'vitest'
import { parse } from 'yaml'
import { tokensAnywherePatch } from '../src/profile-tokens-anywhere.ts'

it('switches Next\'s tokens-anywhere row in a Profile patch and leaves the rest as it was', () => {
  expect(parse(tokensAnywherePatch('[]\n', false))).toEqual([{ id: 'tokens-anywhere', disabled: true }])
  const user = '# mine\n- id: tokens-anywhere\n  disabled: true\n- id: other\n  config: {}\n'
  const enabled = tokensAnywherePatch(user, true)
  expect(enabled).toContain('# mine')
  expect(parse(enabled)).toEqual([{ id: 'tokens-anywhere', disabled: false }, { id: 'other', config: {} }])
  // An insert carrying the id is a bundle's row, not this override.
  expect(parse(tokensAnywherePatch('- insert:\n    - id: tokens-anywhere\n      name: tokens-anywhere\n', false)))
    .toEqual([{ insert: [{ id: 'tokens-anywhere', name: 'tokens-anywhere' }] }, { id: 'tokens-anywhere', disabled: true }])
  expect(() => tokensAnywherePatch('{}\n', false)).toThrow('YAML sequence')
})
