/** Exercise the installed Windows ACL write grant in Beta and Next: it labels entries the grant's propagation missed (#1627). */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { test } from 'node:test'
import { pathToFileURL } from 'node:url'

const PACKAGE = '@deepseek-ai/dsh-sandbox-windows-acl'

function packageEntry(workspace) {
  try {
    return createRequire(resolve(workspace, 'package.json')).resolve(PACKAGE)
  } catch (error) {
    // check:layout also runs in CI jobs that do not install runtime dependencies.
    if (error?.code === 'MODULE_NOT_FOUND' && String(error.message).includes(`'${PACKAGE}'`)) return undefined
    throw error
  }
}

/**
 * Bindings for a grant whose Win32 calls all succeed. A path in `labeled` reads back one
 * mandatory label ACE; every other path reads as unlabeled.
 */
function bindings(koffi, root, temp, labeled, treeSet) {
  const sid = koffi.alloc('uint8', 68)
  const labelAcl = koffi.alloc('uint8', 16)
  koffi.encode(labelAcl, 4, 'uint16', 1)
  const inspected = []
  const created = {
    convertStringSidToSidW: (_text, slot) => { koffi.encode(slot, 'void *', sid); return 1 },
    createWellKnownSid: () => 1,
    isValidSid: () => 1,
    getLengthSid: () => 12,
    localAlloc: (_flags, length) => koffi.alloc('uint8', length),
    localFree: () => null,
    initializeAcl: () => 1,
    addMandatoryAce: () => 1,
    getTempPathW: (_length, buffer) => buffer.write(`${temp}${sep}`, 'utf16le') / 2,
    createFileW: () => 1n,
    lockFileEx: () => 1,
    unlockFileEx: () => 1,
    closeHandle: () => 1,
    getNamedSecurityInfoW: (path, _type, _info, _owner, _group, dacl, sacl, descriptor) => {
      if (path !== root) inspected.push(path)
      koffi.encode(dacl, 'void *', null)
      koffi.encode(sacl, 'void *', labeled.has(path) ? labelAcl : null)
      koffi.encode(descriptor, 'void *', null)
      return 0
    },
    setEntriesInAclW: (_count, _entries, _old, slot) => { koffi.encode(slot, 'void *', koffi.alloc('uint8', 8)); return 0 },
    setNamedSecurityInfoW: () => 0,
    treeSetNamedSecurityInfoW: treeSet,
  }
  const api = new Proxy(created, { get: (target, name) => target[name] ?? (() => { throw new Error(`Win32 call ${String(name)}`) }) })
  return { api, inspected }
}

// Carry the labelExistingEntries hunk of patches/dsh-sandbox-windows-acl@<version>.patch to every new runtime.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = packageEntry(workspace)
  test(`${workspace}: the ACL write grant labels entries its propagation missed`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async () => {
    const { AclWriteGrant, workspaceWriteSid } = await import(pathToFileURL(entry).href)
    const koffi = createRequire(resolve(workspace, 'package.json'))('koffi')
    const base = mkdtempSync(join(tmpdir(), 'dsh-acl-backfill-'))
    try {
      const root = join(base, 'workspace')
      const path = name => join(root, ...name.split('/'))
      for (const directory of ['labeled/deep-labeled', 'labeled/deep-unlabeled/deeper']) mkdirSync(path(directory), { recursive: true })
      for (const file of ['top.txt', 'labeled/inner.txt']) writeFileSync(path(file), '')
      symlinkSync(base, path('link'))
      const walks = []
      const grantFor = (labels, workspace = root, treeSet = (...args) => { walks.push(args); return 0 }) => {
        const { api, inspected } = bindings(koffi, workspace, base, new Set(labels), treeSet)
        AclWriteGrant.create(workspaceWriteSid(workspace), api).add(workspace, true)
        return inspected
      }

      // Each unlabeled entry inherits its parent's label again, with its subtree, through an
      // empty label ACL: a top-level file and a directory below a labeled one. Files below the
      // top level, links, and the subtree of an unlabeled entry are not inspected.
      const inspected = grantFor([path('labeled'), path('labeled/deep-labeled')])
      assert.deepEqual(walks.map(([target]) => target).sort(), [path('labeled/deep-unlabeled'), path('top.txt')])
      for (const [, objectType, information, owner, group, dacl, sacl, ...rest] of walks) {
        assert.deepEqual([objectType, information, owner, group, dacl, ...rest], [1, 16, null, null, null, 1, null, 1, null])
        assert.notEqual(sacl, null)
      }
      for (const skipped of ['link', 'labeled/inner.txt', 'labeled/deep-unlabeled/deeper']) assert.ok(!inspected.includes(path(skipped)), skipped)

      // A tree whose entries all carry a label is left alone.
      walks.length = 0
      grantFor(['top.txt', 'labeled', 'labeled/deep-labeled', 'labeled/deep-unlabeled', 'labeled/deep-unlabeled/deeper'].map(path))
      assert.equal(walks.length, 0)

      // The search stops after 2000 label reads: here the top level uses them all up.
      const wide = join(base, 'wide')
      const folders = Array.from({ length: 2001 }, (_, index) => join(wide, `d${index}`))
      for (const folder of folders) mkdirSync(folder, { recursive: true })
      mkdirSync(join(folders[0], 'unlabeled'))
      assert.equal(grantFor(folders, wide).length, 2000)
      assert.equal(walks.length, 0)

      // The repair is best effort: its failure does not fail the grant.
      assert.doesNotThrow(() => grantFor([path('labeled')], root, () => { throw new Error('TreeSetNamedSecurityInfoW') }))
    } finally {
      rmSync(base, { recursive: true, force: true })
    }
  })
}
