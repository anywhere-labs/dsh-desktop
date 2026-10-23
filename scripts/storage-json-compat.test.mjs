/** Exercise the installed storage backend in every Desktop channel (issue #1473). */
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const descriptor = { name: 'workspace', version: 2, tables: ['records'], hasGlobal: true }
const record = { label: '\uFEFFproject', middle: 'a\uFEFFb', multiline: '\n\uFEFFline', escaped: '\\uFEFF' }
const global = { 'key\uFEFF': '\uFEFFselected' }
const state = { global, tables: { records: { k: record } } }
const document = JSON.stringify({ unit: { name: descriptor.name, version: descriptor.version }, ...state })

function runtimePath(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve('@deepseek-ai/dsh-storage-json')
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes("'@deepseek-ai/dsh-storage-json'")) return undefined
    throw error
  }
}

for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-plugin-desktop', 'dsh-desktop-next']) {
  const entry = runtimePath(workspace)
  test(`${workspace}: JSON storage BOM compatibility`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async t => {
    const { JsonStorageBackend } = await import(pathToFileURL(entry).href)
    async function withBackend(run) {
      const root = await mkdtemp(join(tmpdir(), 'dsh-storage-bom-'))
      const backend = new JsonStorageBackend(root)
      try { await run(root, backend) } finally {
        await backend.close()
        await rm(root, { recursive: true, force: true })
      }
    }

    for (const prefix of ['', '\uFEFF']) {
      const encoding = prefix ? 'UTF-8 BOM' : 'plain UTF-8'
      await t.test(`reads a single unit with ${encoding} without changing its bytes or string contents`, () => withBackend(async (root, backend) => {
        const path = join(root, 'workspace.json')
        const source = Buffer.from(prefix + document)
        await writeFile(path, source)
        const unit = await backend.kv.open(descriptor)
        assert.deepEqual(await unit.loadAll(), state)
        assert.deepEqual(await readFile(path), source)
      }))

      await t.test(`reads per-record and global documents with ${encoding} without rewriting them`, () => withBackend(async (root, backend) => {
        await mkdir(join(root, 'workspace', 'records'), { recursive: true })
        const files = [
          [join(root, 'workspace', 'records', 'k.json'), prefix + JSON.stringify({ version: 2, record })],
          [join(root, 'workspace', 'global.json'), prefix + JSON.stringify({ version: 2, record: global })],
        ]
        for (const [path, text] of files) await writeFile(path, text, 'utf8')
        const unit = await backend.kv.open({ ...descriptor, layout: 'per-record' })
        assert.deepEqual(await unit.loadAll(), state)
        for (const [path, text] of files) assert.equal(await readFile(path, 'utf8'), text)
      }))

      await t.test(`migrates an accepted legacy unit with ${encoding} and preserves the source`, () => withBackend(async (root, backend) => {
        const path = join(root, 'workspace.json')
        // Upstream's legacy cache migration copies table records only.
        const source = prefix + JSON.stringify({ unit: { name: 'workspace', version: 1 }, ...state, global: null })
        await writeFile(path, source, 'utf8')
        const unit = await backend.kv.open({ ...descriptor, layout: 'per-record', compatibleVersions: [1] })
        assert.deepEqual(await unit.loadAll(), { ...state, global: null })
        assert.equal(await readFile(path, 'utf8'), source)
        assert.deepEqual(JSON.parse(await readFile(join(root, 'workspace', 'records', 'k.json'), 'utf8')), { version: 2, record })
      }))
    }

    const invalidDocuments = [
      ['malformed JSON after a BOM', '\uFEFF{"unit":', 'malformed-medium'],
      ['two leading BOMs', '\uFEFF\uFEFF' + document, 'malformed-medium'],
      ['a BOM after whitespace', ' \uFEFF' + document, 'malformed-medium'],
      ['a foreign unit header', '\uFEFF' + document.replace('"workspace"', '"other"'), 'malformed-medium'],
      ['an unaccepted version', '\uFEFF' + document.replace('"version":2', '"version":99'), 'version-mismatch'],
    ]
    for (const [name, source, code] of invalidDocuments) {
      await t.test(`still rejects ${name} in a single unit and preserves the file`, () => withBackend(async (root, backend) => {
        const path = join(root, 'workspace.json')
        await writeFile(path, source, 'utf8')
        await assert.rejects(backend.kv.open(descriptor), { code })
        assert.equal(await readFile(path, 'utf8'), source)
      }))
    }

    for (const layout of ['per-record', 'legacy']) {
      await t.test(`still ignores malformed or foreign ${layout} documents and preserves them`, () => withBackend(async (root, backend) => {
        const sources = layout === 'legacy' ? invalidDocuments.map(([, text]) => text) : [
          '\uFEFF{"version":',
          '\uFEFF\uFEFF' + JSON.stringify({ version: 2, record }),
          ' \uFEFF' + JSON.stringify({ version: 2, record }),
          '\uFEFF' + JSON.stringify({ version: 99, record }),
        ]
        const path = layout === 'legacy' ? join(root, 'workspace.json') : join(root, 'workspace', 'records', 'k.json')
        if (layout === 'per-record') await mkdir(join(root, 'workspace', 'records'), { recursive: true })
        for (const source of sources) {
          await writeFile(path, source, 'utf8')
          const unit = await backend.kv.open({ ...descriptor, layout: 'per-record' })
          try { assert.deepEqual(await unit.loadAll(), { global: null, tables: { records: {} } }) } finally { await unit.close() }
          assert.equal(await readFile(path, 'utf8'), source)
        }
      }))
    }
  })
}
