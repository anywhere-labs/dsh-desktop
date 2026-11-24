import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rename, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'
import { withStartupLock } from '../../src/startup-lock.js'

async function withHome(run: (home: string, lock: string) => Promise<void>): Promise<void> {
  const home = await mkdtemp(join(tmpdir(), 'acp-lock-'))
  try { await run(home, join(home, 'startup.lock')) } finally { await rm(home, { recursive: true, force: true }) }
}

/** A lock some other, running process holds. */
const live = JSON.stringify({ pid: process.ppid, id: 'another process' })
const never = async (): Promise<never> => { throw new Error('ran beside the owner of the lock') }

test('a lock that names no owner is reclaimed, whatever a killed process left in it', { timeout: 30_000 }, async () => {
  await Promise.all(['', '{', 'null', '{"pid":"7"}', '{"pid":0}'].map(content => withHome(async (home, lock) => {
    await writeFile(lock, content)
    assert.equal(await withStartupLock(home, 10_000, async () => 'ran'), 'ran', JSON.stringify(content))
    assert.equal(existsSync(lock), false)
  })))
})

test('a lock whose process exited is reclaimed at once', { timeout: 30_000 }, async () => {
  await withHome(async (home, lock) => {
    const { pid } = spawnSync(process.execPath, ['-e', ''])
    await writeFile(lock, JSON.stringify({ pid, id: 'exited' }))
    const started = Date.now()
    assert.equal(await withStartupLock(home, 10_000, async () => 'ran'), 'ran')
    assert.ok(Date.now() - started < 1_500, 'without waiting as for a lock that names no owner')
  })
})

test('a lock its running owner holds is never taken, however old', { timeout: 30_000 }, async () => {
  await withHome(async (home, lock) => {
    await writeFile(lock, live)
    await utimes(lock, 0, 0)
    await assert.rejects(withStartupLock(home, 3_000, never), /still starting/u)
    assert.equal(await readFile(lock, 'utf8'), live)
  })
})

test('a lock its owner is still writing is left alone', { timeout: 30_000 }, async () => {
  await withHome(async (home, lock) => {
    await writeFile(lock, '')
    const waiting = assert.rejects(withStartupLock(home, 4_000, never), /still starting/u)
    await delay(1_000)
    await writeFile(lock, live)
    await waiting
    assert.equal(await readFile(lock, 'utf8'), live)
  })
})

test('the time without an owner counts for one lock: a newer one of the same name starts over', { timeout: 30_000 }, async () => {
  await withHome(async (home, lock) => {
    await writeFile(lock, '')
    const waiting = assert.rejects(withStartupLock(home, 5_000, never), /still starting/u)
    await delay(1_400)
    // Another process reclaimed the leftover and is about to write its own lock.
    await writeFile(`${lock}.new`, '')
    await rename(`${lock}.new`, lock)
    await delay(1_000)
    await writeFile(lock, live)
    await waiting
    assert.equal(await readFile(lock, 'utf8'), live)
  })
})

test('waiters that find the same leftover run one at a time', { timeout: 30_000 }, async () => {
  await withHome(async (home, lock) => {
    await writeFile(lock, '')
    let active = 0
    let runs = 0
    await Promise.all(Array.from({ length: 4 }, () => withStartupLock(home, 15_000, async () => {
      assert.equal(++active, 1)
      await delay(150)
      active--
      runs++
    })))
    assert.equal(runs, 4)
    assert.equal(existsSync(lock), false)
  })
})
