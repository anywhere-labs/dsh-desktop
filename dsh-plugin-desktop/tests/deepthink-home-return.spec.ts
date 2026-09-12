import { mkdir, mkdtemp, readFile, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deepThinkBackendBuildIsCurrent, deepThinkWebBuildIsRoutable } from '../src/deepthink-sidecar.ts'

describe('DeepThink home return contract', () => {
  it('has a real DSH home return target and all three launchers', async () => {
    const route = await readFile(new URL('../src/deepthink-route.ts', import.meta.url), 'utf8')
    const client = await readFile(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    expect(route).toContain("data-dsh-return-target','/'")
    expect(route).toContain("c.searchParams.forEach(function(v,k){if(k.indexOf('dsh-desktop-')===0)h.searchParams.append(k,v)}")
    expect(route).toContain('window.location.replace(h.href)')
    expect(route).toContain('routedLocation(location, incoming)')
    expect(route).toContain("key.startsWith('dsh-desktop-')")
    expect(route).toContain("path: `${ROUTE}/runtime`")
    expect(client).toContain("id: 'product-visual-workbench'")
    expect(client).toContain("id: 'dbskill-workbench'")
    expect(client).toContain("id: 'deepthink-workbench'")
  })

  it('uses a Node-compatible runtime for the DeepThink native dependencies', async () => {
    const sidecar = await readFile(new URL('../src/deepthink-sidecar.ts', import.meta.url), 'utf8')
    expect(sidecar).toContain("process.env.DSH_DEEPTHINK_NODE?.trim()")
    expect(sidecar).toContain("process.versions.electron === undefined ? process.execPath : 'node'")
    expect(sidecar).toContain("WEB_PORT: String(this.port)")
  })

  it('rejects a DeepThink web build whose assets are not rooted below /deepthink/', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-deepthink-web-'))
    const index = join(directory, 'index.html')
    try {
      await writeFile(index, '<script type="module" src="/assets/index.js"></script><link rel="stylesheet" href="/assets/index.css">')
      expect(deepThinkWebBuildIsRoutable(index)).toBe(false)

      await writeFile(index, '<script type="module" src="/deepthink/assets/index.js"></script><link rel="stylesheet" href="/deepthink/assets/index.css">')
      expect(deepThinkWebBuildIsRoutable(index)).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('rejects a stale DeepThink backend build when source is newer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-deepthink-backend-'))
    const source = join(root, 'src', 'runtime-config.ts')
    const entry = join(root, 'dist', 'index.js')
    try {
      await mkdir(join(root, 'src'), { recursive: true })
      await mkdir(join(root, 'dist'), { recursive: true })
      await writeFile(source, 'export const current = true')
      await writeFile(entry, 'export const built = true')
      const now = Date.now() / 1000
      await utimes(entry, now - 20, now - 20)
      await utimes(source, now, now)
      expect(deepThinkBackendBuildIsCurrent(root, entry)).toBe(false)

      await utimes(entry, now + 20, now + 20)
      expect(deepThinkBackendBuildIsCurrent(root, entry)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
