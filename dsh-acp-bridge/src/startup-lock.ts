/** Serialize editor-triggered starts. A lock whose owner is gone is reclaimed; a live one is never stolen. */
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { processAlive } from './endpoint.js'

/** A new lock names its owner one small write after it appears: one that still names none by then was left by a killed process. */
const OWNERLESS_MS = 2_000

function ownerPid(text: string): number | undefined {
  try {
    const { pid } = JSON.parse(text) as { pid?: unknown }
    return typeof pid === 'number' && Number.isSafeInteger(pid) && pid > 0 ? pid : undefined
  } catch { return undefined }
}

/** The lock at `path`, with what tells it from a newer lock of the same name. */
async function readLock(path: string): Promise<{ id: string, text: string } | undefined> {
  try {
    const { ino, mtimeNs } = await stat(path, { bigint: true })
    return { id: `${ino}:${mtimeNs}`, text: await readFile(path, 'utf8') }
  } catch { return undefined /* Just released. */ }
}

export async function withStartupLock<T>(home: string, timeoutMs: number, run: () => Promise<T>, name = 'startup.lock'): Promise<T> {
  await mkdir(home, { recursive: true, mode: 0o700 })
  const path = join(home, name)
  const owner = JSON.stringify({ pid: process.pid, id: randomUUID() })
  const deadline = Date.now() + timeoutMs
  let ownerless: { id: string, since: number } | undefined
  for (;;) {
    try { await writeFile(path, owner, { flag: 'wx', mode: 0o600 }); break }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
    const lock = await readLock(path)
    if (lock) {
      const pid = ownerPid(lock.text)
      if (pid === undefined && ownerless?.id !== lock.id) ownerless = { id: lock.id, since: Date.now() }
      const abandoned = pid === undefined ? Date.now() - ownerless!.since >= OWNERLESS_MS : !processAlive(pid)
      // Recheck that it is still the same lock before removing it.
      if (abandoned && (await readLock(path))?.id === lock.id) await rm(path, { force: true }).catch(() => undefined)
    }
    if (Date.now() >= deadline) throw new Error('Another editor is still starting DSH. Wait and reconnect.')
    await delay(100)
  }
  try { return await run() }
  finally { if (await readFile(path, 'utf8').catch(() => '') === owner) await rm(path, { force: true }) }
}
