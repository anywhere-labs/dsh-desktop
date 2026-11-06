/**
 * The Host half of the native file drag, ported from upstream's `apps/desktop-host`: workspace files a Session may read
 * are authorized through the composed filesystem, and the shell receives their path and content identity over the Host's
 * IPC channel. The Host bundle imports src/upstream-family.ts, which re-exports this module.
 */
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-fs'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-sandbox-policy'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { parseFileAddress } from '@deepseek-ai/dsh-util-workspace-path'

/** Private Host-to-main answer; never exposed to renderer JavaScript. */
export interface LocalDragResource {
  readonly path: string
  readonly sha256: string
  readonly size: number
}

/**
 * Authorize an unmodified local file through the composed filesystem's actual read operations.
 * @param ctx - booted Desktop Host.
 * @param address - Session-scoped resource reference.
 * @param cancellation - caller cancellation, combined with the read deadline.
 * @returns verified Host-local path and content identity, or null for nonlocal resources.
 */
export async function localDragResource(ctx: Context, address: string, cancellation?: AbortSignal): Promise<LocalDragResource | null> {
  const resource = parseFileAddress(address)
  if (resource?.scope !== 'session') throw new Error('File drag requires a Session resource')
  const sessions = ctx.get('sessions')
  const persistence = ctx.get('sessionPersistence')
  const fs = ctx.get('fs')
  const policy = ctx.get('sandboxPolicy')
  if (fs === undefined || sessions === undefined || policy === undefined) throw new Error('File access unavailable')
  const sessionId = resource.sessionId as SessionId
  const header = sessions.get(sessionId)?.header ?? (await persistence?.stat(sessionId))?.header
  if (header === undefined) throw new Error('File drag Session unavailable')
  const signal = cancellation === undefined ? AbortSignal.timeout(10_000) : AbortSignal.any([cancellation, AbortSignal.timeout(10_000)])
  signal.throwIfAborted()
  const cwd = header.cwd ?? policy.workspaceRoot
  const entry = await fs.lstat(resource.path, { cwd }, signal)
  if (entry?.type !== 'file') return null
  const target = await fs.resolve(resource.path, { cwd, signal })
  const path = fs.processPath(target)
  const mapped = fs.processPathFromHostPath(path)
  if (mapped === undefined) return null
  const roundTrip = await fs.resolve(mapped, { signal })
  if (roundTrip.targetKey !== target.targetKey) return null
  const info = await fs.stat(target, signal)
  if (info?.type !== 'file' || info.size === undefined) return null
  const hash = createHash('sha256')
  let size = 0
  while (size < info.size) {
    signal.throwIfAborted()
    const data = await fs.readByteRange(target, { offset: size, length: Math.min(64 * 1024, info.size - size) }, signal)
    if (data.length === 0) return null
    hash.update(data)
    size += data.length
  }
  // Even empty files require a read authorization check.
  if (size === 0) await fs.readByteRange(target, { offset: 0, length: 1 }, signal)
  const after = await fs.stat(target, signal)
  signal.throwIfAborted()
  if (after?.version !== info.version || after.size !== size) return null
  return { path, size, sha256: hash.digest('hex') }
}

/**
 * Answer the shell's `file-drag-resource` requests and honor its `file-drag-cancel` messages, as upstream's Desktop Host does.
 * @param application - the booting Host; requests wait for it.
 * @param send - delivers one answer to the shell.
 * @returns `receive`, which takes the two drag messages and reports whether the message was one, and `stop`, which
 * aborts unfinished reads and awaits their answers before the Host shuts down.
 */
export function installHostFileDragResources(application: Promise<{ readonly ctx: Context }>, send: (message: object) => Promise<void>): {
  receive(message: unknown): boolean
  stop(): Promise<void>
} {
  let stopping = false
  const reads = new Map<number, AbortController>()
  const tasks = new Set<Promise<void>>()
  return {
    receive: (message) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return false
      if (message.type === 'file-drag-cancel') {
        if ('requestId' in message && typeof message.requestId === 'number') reads.get(message.requestId)?.abort()
        return true
      }
      if (message.type !== 'file-drag-resource') return false
      if (!('requestId' in message) || typeof message.requestId !== 'number' || !Number.isSafeInteger(message.requestId)
        || !('address' in message) || typeof message.address !== 'string') return true
      const { requestId, address } = message
      const abort = new AbortController()
      reads.set(requestId, abort)
      const task = (async () => {
        try {
          if (stopping) throw new Error('Host stopping')
          const { ctx } = await application
          const resource = await localDragResource(ctx, address, abort.signal)
          await send({ type: 'file-drag-resource', requestId, resource })
        } catch (error) {
          if (!abort.signal.aborted) console.error(error)
          await send({ type: 'file-drag-resource', requestId, resource: null, error: 'File drag resource unavailable' })
        } finally { reads.delete(requestId) }
      })().catch((error: unknown) => { console.error(error) })
      tasks.add(task)
      void task.finally(() => { tasks.delete(task) })
      return true
    },
    stop: async () => {
      stopping = true
      for (const abort of reads.values()) abort.abort()
      await Promise.allSettled(tasks)
    },
  }
}
