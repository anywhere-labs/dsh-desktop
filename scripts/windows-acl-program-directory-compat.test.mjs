/** Exercise the installed Windows ACL write grant in Beta and Next: it never labels the program directory (#1564). */
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
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

/** Bindings that let the grant create its SIDs and fail every later Win32 call, which only a grant past the guard makes. */
function bindings(koffi) {
  const sid = koffi.alloc('uint8', 68)
  const created = {
    convertStringSidToSidW: (_text, slot) => { koffi.encode(slot, 'void *', sid); return 1 },
    createWellKnownSid: () => 1,
    isValidSid: () => 1,
    localFree: () => null,
  }
  return new Proxy(created, { get: (target, name) => target[name] ?? (() => { throw new Error(`Win32 call ${String(name)}`) }) })
}

// Carry the assertOutsideProgramDirectory hunk of patches/dsh-sandbox-windows-acl@<version>.patch to every new runtime.
for (const workspace of ['dsh-plugin-desktop-beta', 'dsh-desktop-next']) {
  const entry = packageEntry(workspace)
  test(`${workspace}: the ACL write grant refuses workspaces that overlap the program directory`, {
    skip: entry === undefined && 'runtime dependencies are not installed; run corepack yarn install',
  }, async () => {
    const { AclWriteGrant, workspaceWriteSid } = await import(pathToFileURL(entry).href)
    const koffi = createRequire(resolve(workspace, 'package.json'))('koffi')
    const root = mkdtempSync(join(tmpdir(), 'dsh-acl-program-'))
    const program = join(root, 'Programs', 'DSH')
    const inside = join(program, 'resources')
    const elsewhere = join(root, 'workspace')
    for (const directory of [inside, elsewhere]) mkdirSync(directory, { recursive: true })
    const executable = process.execPath
    process.execPath = join(program, 'DSH.exe')
    try {
      const grant = AclWriteGrant.create(workspaceWriteSid(elsewhere), bindings(koffi))
      for (const workspace of [program, inside, root]) {
        assert.throws(() => grant.add(workspace, true), /must not overlap the program directory/, workspace)
      }
      // A disjoint workspace reaches the first Win32 call of the grant itself.
      assert.throws(() => grant.add(elsewhere, true), /^Error: Win32 call /)
    } finally {
      process.execPath = executable
      rmSync(root, { recursive: true, force: true })
    }
  })
}
