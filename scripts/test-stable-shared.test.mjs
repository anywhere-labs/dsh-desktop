/** Pin which Stable specs count as tests of modules Next and Beta ship. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { stableSharedSpecs } from './test-stable-shared.mjs'

test('selects the Stable specs whose Stable imports all lie in the closure Next and Beta reach', () => {
  const sources = new Map([
    ['dsh-desktop-next/src/main.ts', "import { a } from '../../dsh-plugin-desktop/src/a.ts'\n"],
    ['dsh-plugin-desktop-beta/scripts/package.ts', "const { s } = await import('../../dsh-plugin-desktop/scripts/s.mjs')\n"],
    ['dsh-plugin-desktop/src/a.ts', "import { b } from './b.ts'\nexport const a = b\n"],
    ['dsh-plugin-desktop/src/b.ts', 'export const b = 1\n'],
    ['dsh-plugin-desktop/src/stable-only.ts', "import { b } from './b.ts'\nexport const c = b\n"],
    ['dsh-plugin-desktop/scripts/s.mjs', 'export const s = 1\n'],
    ['dsh-plugin-desktop/tests/helper.ts', "export const helper = 'fixture'\n"],
    // A transitive dependency of a shared module is shared too.
    ['dsh-plugin-desktop/tests/b.spec.ts', "import { b } from '../src/b.ts'\n"],
    // Test helpers do not count as Stable code.
    ['dsh-plugin-desktop/tests/a.spec.ts', "import { a } from '../src/a'\nimport { helper } from './helper.ts'\n"],
    ['dsh-plugin-desktop/tests/script.spec.ts', "import { s } from '../scripts/s.mjs'\n"],
    // Exercising a Stable-only module keeps a spec with the frozen suite.
    ['dsh-plugin-desktop/tests/mixed.spec.ts', "import { a } from '../src/a.ts'\nimport { c } from '../src/stable-only.ts'\n"],
    ['dsh-plugin-desktop/tests/stable-only.spec.ts', "import { c } from '../src/stable-only.ts'\n"],
    // A spec that imports no Stable code tests nothing Next or Beta ships.
    ['dsh-plugin-desktop/tests/manifest.spec.ts', "import { helper } from './helper.ts'\n"],
  ])
  assert.deepEqual(stableSharedSpecs(sources), ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/script.spec.ts'])
})

test('ignores specs of Next and Beta and Stable code nothing reaches', () => {
  const sources = new Map([
    ['dsh-desktop-next/src/main.ts', "export const main = 1\n"],
    ['dsh-desktop-next/tests/main.spec.ts', "import { main } from '../src/main.ts'\n"],
    ['dsh-plugin-desktop/src/unused.ts', 'export const unused = 1\n'],
    ['dsh-plugin-desktop/tests/unused.spec.ts', "import { unused } from '../src/unused.ts'\n"],
  ])
  assert.deepEqual(stableSharedSpecs(sources), [])
})
