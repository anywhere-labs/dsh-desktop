/**
 * Check that Beta and Next load the patched pi-ai that upstream's own runtime ships.
 *
 * Upstream pins pi-ai and patches it (deepseek-harness/patches/@earendil-works__pi-ai@<version>.patch): the stock
 * release re-parses a tool call's whole partial JSON on every streamed delta, so CPU grows with the square of the
 * argument length, and it drops Gemini's tool-call thought signatures on replay. The published runtime packages
 * only declare a caret range, so a Desktop install resolves whatever pi-ai npm offers unless the root resolutions
 * carry upstream's version and patch (patches/pi-ai@<version>.patch, copied verbatim).
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import { test } from 'node:test'

const root = resolve(import.meta.dirname, '..')
const PI_AI = '@earendil-works/pi-ai'

// The copies the runtime loads: the model adapter's, and the OAR subagent's own and through pi-coding-agent.
const CONSUMERS = [
  ['@deepseek-ai/dsh-llm-pi-ai'],
  ['@deepseek-ai/dsh-experimental-subagent-oar'],
  ['@deepseek-ai/dsh-experimental-subagent-oar', '@earendil-works/pi-coding-agent'],
]

/** Find a package directory the way Node resolves it from `fromManifest`; pi-ai exports no `./package.json`. */
function packageDirectory(fromManifest, name) {
  for (const base of createRequire(fromManifest).resolve.paths(name) ?? []) {
    if (existsSync(join(base, name, 'package.json'))) return realpathSync(join(base, name))
  }
  return undefined
}

function piAiDirectory(workspace, chain) {
  let directory = resolve(root, workspace)
  for (const name of [...chain, PI_AI]) {
    const next = packageDirectory(join(directory, 'package.json'), name)
    assert.ok(next, `${workspace}: ${name} is not installed beside ${directory}`)
    directory = next
  }
  return directory
}

/** Split a unified diff into the text each hunk expects before and after it applies, by its header's line counts. */
function hunks(patch) {
  const lines = patch.split('\n')
  const result = []
  let file
  for (let index = 0; index < lines.length; index++) {
    if (lines[index].startsWith('+++ b/')) file = lines[index].slice('+++ b/'.length)
    const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u.exec(lines[index])
    if (header === null) continue
    let oldLines = Number(header[1] ?? 1)
    let newLines = Number(header[2] ?? 1)
    const before = []
    const after = []
    while (oldLines > 0 || newLines > 0) {
      const body = lines[++index]
      assert.ok(body !== undefined, `${file}: hunk ends early`)
      if (body.startsWith('\\')) continue
      if (body[0] !== '+') { before.push(body.slice(1)); oldLines-- }
      if (body[0] !== '-') { after.push(body.slice(1)); newLines-- }
    }
    result.push({ file, before: before.join('\n'), after: after.join('\n') })
  }
  return result
}

// Stable is frozen and keeps its own pi-ai 1.1.0 patch.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  // check:layout also runs in CI jobs that do not install runtime dependencies.
  const installed = packageDirectory(resolve(root, workspace, 'package.json'), CONSUMERS[0][0]) !== undefined
  for (const chain of CONSUMERS) {
    test(`${workspace}: ${chain.join(' > ')} loads upstream's patched pi-ai`, {
      skip: !installed && 'runtime dependencies are not installed; run corepack yarn install',
    }, () => {
      const directory = piAiDirectory(workspace, chain)
      const { version } = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8'))
      const patchFile = join(root, 'patches', `pi-ai@${version}.patch`)
      assert.ok(existsSync(patchFile), `${workspace} loads pi-ai ${version} without a Desktop patch. Copy upstream's `
        + `deepseek-harness/patches/@earendil-works__pi-ai@<version>.patch for the pi-ai upstream pins to `
        + `patches/pi-ai@<version>.patch and resolve the runtime's pi-ai range to it in the root package.json.`)
      const applied = hunks(readFileSync(patchFile, 'utf8'))
      assert.ok(applied.length > 0, `${patchFile} has no hunks`)
      for (const hunk of applied) {
        const installed = readFileSync(join(directory, hunk.file), 'utf8')
        assert.ok(installed.includes(hunk.after), `${hunk.file} in ${directory} lacks the patched lines`)
        assert.ok(!installed.includes(hunk.before), `${hunk.file} in ${directory} still has the unpatched lines`)
      }
    })
  }
}
