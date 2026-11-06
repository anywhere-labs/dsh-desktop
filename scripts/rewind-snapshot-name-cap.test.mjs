/**
 * Check that the dsh-rewind-plugin installed in the local Desktop profile still caps
 * snapshot file names. Upstream (through 0.20.0) sanitizes ids without a length limit, so a
 * long model call id builds a `.pending/<id>-<hash>.before` name past ext4's 255-byte limit
 * and every rewind capture fails with ENAMETOOLONG. Re-apply
 * config/desktop-profile/patches/dsh-rewind-plugin@<version>-name-cap.patch after an upgrade.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

const NAME_MAX = 255
// stageCapture appends `-<8 hex>.before`, an anchor entry appends `-<8 hex>.json`, a journal
// prepends `journal-` and appends `.json`, and a rescue directory keeps the bare id.
const WRAPPERS = [id => `journal-${id}.json`, id => `${id}-12345678.before`, id => `${id}-12345678.json`, id => id]
const LONG_KEY = `session-0242cec7-8f83-4805-9b4f-28a8bb73dd9d_call_${'A'.repeat(500)}`

function installedBundle() {
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  try {
    return readFileSync(join(home, 'profiles/desktop/node_modules/dsh-rewind-plugin/lib/index.js'), 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined
    throw error
  }
}

const source = installedBundle()
test('rewind keeps snapshot file names inside the 255-byte limit', {
  skip: source === undefined && 'the local desktop profile is not installed on this machine',
}, () => {
  const declaration = source.match(/function safeFileId\(callId\) \{[\s\S]*?\n\}/u)?.[0]
  assert.ok(declaration, 'safeFileId is missing from the installed bundle')
  const safeFileId = new Function('createHash', `${declaration}; return safeFileId`)(createHash)

  for (const id of [LONG_KEY, `${LONG_KEY.slice(0, 160)}AAA`, `${LONG_KEY.slice(0, 160)}BBB`]) {
    const capped = safeFileId(id)
    assert.match(capped, /^[a-zA-Z0-9._-]+$/u, 'the id must stay path-safe')
    assert.equal(capped, safeFileId(capped), 'not idempotent; a journal name read back would not match its rescue directory')
    for (const wrap of WRAPPERS) assert.ok(Buffer.byteLength(wrap(capped)) <= NAME_MAX, `name past ${NAME_MAX} bytes: ${wrap(capped).slice(0, 80)}…`)
  }
  assert.notEqual(safeFileId(`${LONG_KEY.slice(0, 160)}AAA`), safeFileId(`${LONG_KEY.slice(0, 160)}BBB`), 'capped ids collided')
  // Entries already on disk were stored under the unsuffixed name of a short id; those must not move.
  for (const short of ['op-ms0x1q-abcdefgh', 'session-0242cec7-8f83-4805-9b4f-28a8bb73dd9d']) {
    assert.equal(safeFileId(short), short, 'short ids must pass through untouched or existing snapshots orphan')
  }
})
