/** Check that the installed automation page in Beta and Next marks its heading row as a macOS window-drag row. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { test } from 'node:test'

const CLIENT = '@deepseek-ai/dsh-client-ui-schedule/client'

function clientPath(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve(CLIENT)
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${CLIENT}'`)) return undefined
    throw error
  }
}

for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = clientPath(workspace)
  test(`${workspace}: the automation page heading row drags the window`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, () => {
    const source = readFileSync(entry, 'utf8')
    // The heading row's styles put the strip above the title inside the row, like the Plugins
    // page head, but upstream never marked it. Carry patches/dsh-client-ui-schedule@<version>.patch
    // to every new runtime until upstream marks the row itself.
    assert.match(source, /className: TaskManagerPage_module_css_default\.pageHeading,\n(?:\s*\/\/[^\n]*\n)?\s*"data-window-drag": true,/u,
      'the automation page heading row lacks data-window-drag')
  })
}
