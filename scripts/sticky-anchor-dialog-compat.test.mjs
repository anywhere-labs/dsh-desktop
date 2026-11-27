/** Check that upward anchor popovers keep a linear bottom inset in Beta and Next.
 * Blink compensates a scrolling anchor after layout, so a `max(12px, calc(anchor(top) + Npx))` clamp pins the
 * popover at 12px and it drifts away from its trigger as the conversation scrolls. The Desktop patches carry
 * `bottom:calc(anchor(top) + Npx)`, which stays a linear function of the anchor.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const NON_LINEAR = 'bottom:max(12px, calc(anchor(top)'

const CHAT_INSETS = [
  'top:max(12px, var(--dsh-frame-overlay-top,12px));bottom:calc(anchor(top) + 8px);left:max(12px, anchor(left));',
  'top:max(12px, var(--dsh-frame-overlay-top,12px));bottom:calc(anchor(top) + 8px);left:12px;right:12px;margin:0',
]
const APPROVAL_INSETS = ['position-area:none;top:var(--dsh-warning-window-top);bottom:calc(anchor(top) + 8px);left:12px;right:max(12px, anchor(']
const MENU_INSETS = [
  '[data-anchor-side=top]{top:var(--dsh-menu-window-top);bottom:calc(anchor(top) + 4px);',
  '@position-try --dsh-menu-above{top:var(--dsh-menu-window-top);bottom:calc(anchor(top) + 4px);',
  '@position-try --dsh-menu-wide-above{top:var(--dsh-menu-window-top);bottom:calc(anchor(top) + 4px);',
]

/** A patch package, the file it edits and the linear rules that file must gain. */
const PACKAGES = [
  { name: 'dsh-client-ui-chat', file: 'lib/client.js', insets: CHAT_INSETS },
  { name: 'dsh-client-ui-conversation', file: 'lib/client.js', insets: CHAT_INSETS },
  { name: 'dsh-client-ui-approval', file: 'lib/client.js', insets: APPROVAL_INSETS },
  { name: 'dsh-client-ui-primitives', file: 'lib/index.js', insets: MENU_INSETS },
  // The published frontend bundles the primitives' stylesheet into its entry chunk; its source map keeps the
  // original CSS and is not loaded by the application.
  { name: 'dsh-web-frontend', file: /^dist\/assets\/index-.*\.js$/u, insets: MENU_INSETS },
]

/** The added lines of every file a patch touches, keyed by its `b/` path. */
function addedLines(patch) {
  const files = new Map()
  let path
  for (const line of readFileSync(patch, 'utf8').split('\n')) {
    if (line.startsWith('+++ b/')) { path = line.slice(6); files.set(path, ''); continue }
    if (path !== undefined && line.startsWith('+')) files.set(path, files.get(path) + line.slice(1))
  }
  return files
}

for (const { name, file, insets } of PACKAGES) {
  test(`patches: ${name} keeps upward anchor insets linear`, () => {
    const patch = join(root, 'patches', `${name}@0.2.3-alpha.2.patch`)
    assert.ok(existsSync(patch), `${name}: missing patches/${name}@0.2.3-alpha.2.patch`)
    const files = addedLines(patch)
    assert.ok(files.size > 0, `${name}: patch adds nothing`)
    for (const [path, added] of files) {
      if (typeof file === 'string' ? path !== file : !file.test(path)) continue
      assert.ok(!added.includes(NON_LINEAR), `${name}: ${path} still clamps the bottom inset in max()`)
      for (const inset of insets) assert.ok(added.includes(inset), `${name}: ${path} lacks ${inset}`)
      return
    }
    assert.fail(`${name}: patch does not edit ${file}`)
  })
}

function packageDir(workspace, name) {
  const pkgName = `@deepseek-ai/${name}`
  const target = name === 'dsh-web-frontend' ? `${pkgName}/dist/index.html` : pkgName
  const require = createRequire(resolve(workspace, 'package.json'))
  let dir
  try {
    dir = dirname(require.resolve(target))
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${target}'`)) return undefined
    throw error
  }
  for (;;) {
    const manifest = join(dir, 'package.json')
    if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === pkgName) return dir
    assert.notEqual(dirname(dir), dir, `${pkgName}: package root not found`)
    dir = dirname(dir)
  }
}

for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  for (const { name, file, insets } of PACKAGES) {
    const dir = packageDir(workspace, name)
    test(`${workspace}: ${name} keeps upward anchor insets linear`, {
      skip: dir === undefined && 'runtime dependencies are not installed; run corepack yarn install',
    }, () => {
      const sources = installedSources(dir, file)
      assert.ok(sources.length > 0, `${name}: no matching bundle files for ${file}`)
      for (const [path, source] of sources) {
        assert.ok(!source.includes(NON_LINEAR), `${name}: ${path} still clamps the bottom inset in max()`)
        for (const inset of insets) assert.ok(source.includes(inset), `${name}: ${path} lacks ${inset}`)
      }
    })
  }
}

function installedSources(dir, file) {
  if (typeof file === 'string') return [[file, readFileSync(join(dir, file), 'utf8')]]
  const folder = 'dist/assets'
  if (!existsSync(join(dir, folder))) return []
  return readdirSync(join(dir, folder))
    .filter(name => file.test(`${folder}/${name}`))
    .map(name => [`${folder}/${name}`, readFileSync(join(dir, folder, name), 'utf8')])
}