import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  recoverOversizedSessionProjectionCache,
  SESSION_PROJCACHE_RELATIVE_PATH,
} from '../src/session-projcache-recovery.ts'

function fixtureHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-projcache-'))
  mkdirSync(join(home, SESSION_PROJCACHE_RELATIVE_PATH[0]))
  return home
}

describe('session projection cache recovery', () => {
  it('quarantines an oversized cache before the runtime could parse it', () => {
    const home = fixtureHome()
    const cachePath = join(home, ...SESSION_PROJCACHE_RELATIVE_PATH)
    const oversized = 'x'.repeat(33)
    writeFileSync(cachePath, oversized)

    const recovered = recoverOversizedSessionProjectionCache(home, {
      maxBytes: 32,
      now: () => new Date('2026-08-24T08:15:16.123Z'),
    })

    expect(recovered).toMatchObject({
      status: 'quarantined',
      cachePath,
      sizeBytes: Buffer.byteLength(oversized),
    })
    expect(existsSync(cachePath)).toBe(false)
    expect(recovered.status === 'quarantined' && recovered.backupPath).toContain(
      'session_projcache.oversized-20260824T081516123Z.json',
    )
    expect(recovered.status === 'quarantined' && readFileSync(recovered.backupPath, 'utf8')).toBe(oversized)
  })

  it('leaves a bounded cache untouched', () => {
    const home = fixtureHome()
    const cachePath = join(home, ...SESSION_PROJCACHE_RELATIVE_PATH)
    writeFileSync(cachePath, 'small-cache')

    expect(recoverOversizedSessionProjectionCache(home, { maxBytes: 32 })).toEqual({
      status: 'within-limit',
      cachePath,
    })
    expect(readFileSync(cachePath, 'utf8')).toBe('small-cache')
  })
})
