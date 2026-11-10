import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceSourceRoots } from '../src/workspace-source-roots.ts'

const tempDirs: string[] = []
afterEach(() => {
  for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true })
})

function directory(prefix: string): string {
  const path = mkdtempSync(join(tmpdir(), prefix))
  tempDirs.push(path)
  return path
}

describe('WorkspaceSourceRoots', () => {
  it('persists canonical, deduplicated source roots per unchanged primary Workspace path', () => {
    const data = directory('dsh-source-store-')
    const primary = directory('dsh-source-workspace-')
    const source = directory('dsh-source-folder-')
    const aliasParent = directory('dsh-source-alias-')
    const alias = join(aliasParent, 'alias')
    symlinkSync(source, alias, 'dir')
    const filename = join(data, 'state.json')

    const store = new WorkspaceSourceRoots(filename)
    expect(store.add(primary, alias)).toEqual([source])
    expect(store.selectedRoot(primary)).toBe(source)
    expect(store.select(primary, primary)).toBe(primary)
    expect(store.add(primary, source)).toEqual([source])
    expect(store.selectedRoot(primary)).toBe(source)
    expect(new WorkspaceSourceRoots(filename).list(primary)).toEqual([source])
    expect(new WorkspaceSourceRoots(filename).attachedRoots(primary)).toEqual([source])
    expect(store.resolveAuthorizedRoot(primary, primary)).toBe(primary)
    expect(store.resolveAuthorizedRoot(primary, source)).toBe(source)
    expect(() => store.resolveAuthorizedRoot(primary, directory('dsh-source-unattached-'))).toThrow('selected source folder is not attached')
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual({
      version: 1,
      workspaces: { [primary]: [source] },
      selectedRoots: { [primary]: source },
    })
  })

  it('rejects primary-root nesting and overlap between attached roots', () => {
    const primary = directory('dsh-source-workspace-')
    const source = directory('dsh-source-folder-')
    const child = join(source, 'child')
    mkdirSync(child)
    const store = new WorkspaceSourceRoots(join(directory('dsh-source-store-'), 'state.json'))

    expect(() => store.add(primary, join(primary, 'nested'))).toThrow('missing or inaccessible')
    expect(() => store.add(primary, primary)).toThrow('separate from the primary Workspace')
    store.add(primary, source)
    expect(() => store.add(primary, child)).toThrow('source folders must not overlap')
    expect(store.list(primary)).toEqual([source])
  })

  it('detaches an association without deleting the real directory and persists the revocation', () => {
    const data = directory('dsh-source-store-')
    const primary = directory('dsh-source-workspace-')
    const source = directory('dsh-source-folder-')
    const filename = join(data, 'state.json')
    const store = new WorkspaceSourceRoots(filename)
    store.add(primary, source)
    expect(store.select(primary, source)).toBe(source)
    expect(store.selectedRoot(primary)).toBe(source)

    expect(store.remove(primary, source)).toEqual([])
    expect(store.selectedRoot(primary)).toBe(primary)
    expect(new WorkspaceSourceRoots(filename).attachedRoots(primary)).toEqual([])
    expect(existsSync(source)).toBe(true)
  })

  it('does not transfer a persisted grant when a source path is replaced by a symlink', () => {
    const data = directory('dsh-source-store-')
    const primary = directory('dsh-source-workspace-')
    const source = directory('dsh-source-folder-')
    const replacement = directory('dsh-source-replacement-')
    const filename = join(data, 'state.json')
    const store = new WorkspaceSourceRoots(filename)
    store.add(primary, source)

    rmSync(source, { recursive: true })
    symlinkSync(replacement, source, 'dir')

    expect(new WorkspaceSourceRoots(filename).attachedRoots(primary)).toEqual([])
  })

  it('ignores missing source folders and refuses persisted overlapping roots', () => {
    const data = directory('dsh-source-store-')
    const primary = directory('dsh-source-workspace-')
    const source = directory('dsh-source-folder-')
    const missing = join(data, 'missing')
    const filename = join(data, 'state.json')
    const store = new WorkspaceSourceRoots(filename)
    store.add(primary, source)
    store.remove(primary, source)
    const tampered = {
      version: 1,
      workspaces: { [primary]: [primary, source, missing] },
    }
    writeFileSync(filename, JSON.stringify(tampered))
    expect(() => new WorkspaceSourceRoots(filename).attachedRoots(primary)).toThrow('overlapping roots')
  })
})
