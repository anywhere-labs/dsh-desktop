/** Exercise the installed official draft restore path with drafts that are not plain strings. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

// `check:layout` also runs in CI jobs that never install dependencies (upstream-command-windows).
// Without an install there is neither TypeScript nor the conversation package to read, so skip there.
function loadTypeScript() {
  try {
    return createRequire(resolve('dsh-plugin-desktop-beta/package.json'))('typescript')
  } catch (error) {
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'typescript'")) return undefined
    throw error
  }
}
const ts = loadTypeScript()
const skip = ts === undefined && 'typescript is not installed; run `corepack yarn install` to exercise the official conversation client'

function only(file, predicate, description) {
  const matches = []
  const visit = node => {
    if (predicate(node)) matches.push(node)
    ts.forEachChild(node, visit)
  }
  visit(file)
  assert.equal(matches.length, 1, `Expected one official ${description}`)
  return matches[0].getText(file)
}

function classMethod(file, className, methodName) {
  return only(file, node => ts.isMethodDeclaration(node) && node.name.getText(file) === methodName
    && ts.isClassExpression(node.parent) && ts.isVariableDeclaration(node.parent.parent)
    && node.parent.parent.name.getText(file) === className, `${className}.${methodName}`)
}

/** Copy a value out of the evaluation realm so strict equality ignores its prototypes. */
const plain = value => JSON.parse(JSON.stringify(value))

function functionDeclaration(file, name) {
  return only(file, node => ts.isFunctionDeclaration(node) && node.name?.text === name, `${name} function`)
}

// A draft written by another release, a damaged localStorage value, or a plugin
// passing the wrong type must not reach `text.replace` (#1424 item 3), which
// throws inside the conversation view and renders the whole Session empty.
const invalidDrafts = [undefined, null, 42, true, [], {}, { text: 7, references: [] }, { references: [] }]

for (const workspace of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  test(`${workspace}: the installed conversation client tolerates non-string drafts`, { skip }, () => {
    const require = createRequire(resolve(workspace, 'package.json'))
    const manifest = require.resolve('@deepseek-ai/dsh-client-ui-conversation/package.json')
    const pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    assert.equal(pkg.version, '0.2.1-rc.3')
    // The browser loads the `./client` export; assert the patch lands in that file.
    const entry = join(dirname(manifest), pkg.exports['./client'].default)
    const file = ts.createSourceFile(entry, readFileSync(entry, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)

    // Use the installed functions themselves, not a fixture reproducing the patch.
    const draft = runInNewContext(`(() => {
      ${only(file, node => ts.isVariableStatement(node)
        && node.declarationList.declarations.some(declaration => declaration.name.getText(file) === 'REFERENCE_PLACEHOLDER_RE'),
      'reference placeholder pattern')}
      ${functionDeclaration(file, 'copyReference')}
      ${functionDeclaration(file, 'resolveDraftInput')}
      return {
        resolveDraftInput,
        editor: { ${classMethod(file, 'DraftEditorRuntime', 'setDraft')} },
        shell: { ${classMethod(file, 'SessionInputShell', 'setDraft')} },
      }
    })()`)

    for (const value of invalidDrafts) {
      assert.deepEqual(plain(draft.resolveDraftInput(value)), { text: '', references: [] }, `resolveDraftInput(${JSON.stringify(value)})`)
    }
    assert.deepEqual(plain(draft.resolveDraftInput({ text: 'kept' })), { text: 'kept', references: [] })
    assert.deepEqual(plain(draft.resolveDraftInput('plain')), { text: 'plain', references: [] })
    const structured = { text: 'see a.ts', references: [], command: { token: '/x' } }
    assert.deepEqual(plain(draft.resolveDraftInput(structured)), structured)

    // Session shell -> editor runtime, the frames of the reported stack.
    const seeded = []
    const shell = {
      cancelCommandRestore() {},
      restoreCommand() {},
      draftEditor: {
        setDraft: text => { seeded.push(text) },
        restoreDraft: () => { throw new Error('an invalid draft has no references to restore') },
      },
    }
    for (const value of invalidDrafts) draft.shell.setDraft.call(shell, value)
    assert.deepEqual(seeded, invalidDrafts.map(() => ''))

    // An invalid value reads as the empty draft, which an empty editor already holds.
    const updates = []
    const editor = {
      projection: { clipboardText: '', occurrences: [] },
      editor: { update: () => { updates.push('update') } },
    }
    for (const value of invalidDrafts) {
      assert.doesNotThrow(() => { draft.editor.setDraft.call(editor, value) }, `DraftEditorRuntime.setDraft(${JSON.stringify(value)})`)
    }
    assert.deepEqual(updates, [])
  })
}
