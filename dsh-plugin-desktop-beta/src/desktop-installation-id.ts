/** Private installation identity used only by DSH Desktop update checks. */

import { randomUUID } from 'node:crypto'
import { chmod, lstat, mkdir, open } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'

/** Header carrying the pseudonymous Desktop installation identity. */
export const DESKTOP_INSTALLATION_ID_HEADER = 'X-DSH-Desktop-Installation-Id'

/** Relative state location below Electron's userData directory. */
export const DESKTOP_INSTALLATION_ID_RELATIVE_PATH = join('identity', 'installation-id')

/** Maximum state bytes read before treating an ordinary file as corrupt. */
export const MAX_DESKTOP_INSTALLATION_ID_BYTES = 128

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u

/** Locally generated, pseudonymous UUID v4 scoped to one Desktop userData tree. */
export type DesktopInstallationId = string & { readonly __desktopInstallationId: unique symbol }

/** Injectable UUID source used only by focused tests. */
export interface DesktopInstallationIdOptions {
  readonly randomUUID?: () => string
}

/** Failure raised when the identity state path is unsafe or cannot be persisted. */
export class DesktopInstallationIdError extends Error {
  constructor(message: string, options: { readonly cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'DesktopInstallationIdError'
  }
}

/** Return the exact private state path for one Electron userData directory. */
export function desktopInstallationIdPath(userDataDirectory: string): string {
  if (userDataDirectory.length === 0
    || /[\0\r\n]/u.test(userDataDirectory)
    || !isAbsolute(userDataDirectory)) {
    throw new DesktopInstallationIdError('Desktop userData must be an absolute path without control characters.')
  }
  return join(resolve(userDataDirectory), DESKTOP_INSTALLATION_ID_RELATIVE_PATH)
}

/** Parse one canonical lowercase UUID v4 without accepting surrounding text. */
export function parseDesktopInstallationId(value: unknown): DesktopInstallationId | undefined {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value)
    ? value as DesktopInstallationId
    : undefined
}

/** Require one canonical UUID v4 before it can enter an outbound header. */
export function assertDesktopInstallationId(value: string): DesktopInstallationId {
  const parsed = parseDesktopInstallationId(value)
  if (parsed === undefined) {
    throw new DesktopInstallationIdError('Desktop installation identity must be a canonical lowercase UUID v4.')
  }
  return parsed
}

/**
 * Return the installation UUID for one Desktop userData tree.
 *
 * A missing or corrupt ordinary file is rebuilt atomically. Symbolic links,
 * directories, and other special entries are rejected rather than followed or
 * removed. Persistence failures are explicit: callers must not silently emit a
 * fresh, process-local identifier on every update check.
 */
export async function getOrCreateDesktopInstallationId(
  userDataDirectory: string,
  options: DesktopInstallationIdOptions = {},
): Promise<DesktopInstallationId> {
  const statePath = desktopInstallationIdPath(userDataDirectory)
  const identityDirectory = dirname(statePath)
  await prepareIdentityDirectory(identityDirectory)

  try {
    return await withFileLock(statePath, async () => {
      const persisted = await readPersistedInstallationId(statePath)
      if (persisted !== undefined) return persisted

      const generated = assertDesktopInstallationId((options.randomUUID ?? randomUUID)())
      await writeFileAtomic(statePath, `${generated}\n`, {
        mode: PRIVATE_FILE_MODE,
        dirMode: PRIVATE_DIRECTORY_MODE,
      })
      return generated
    })
  } catch (cause) {
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop installation identity could not be persisted safely.', { cause })
  }
}

async function prepareIdentityDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
    const stat = await lstat(directory)
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new DesktopInstallationIdError('Desktop identity state directory must be an ordinary directory.')
    }
    await chmod(directory, PRIVATE_DIRECTORY_MODE)
  } catch (cause) {
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop identity state directory is unavailable.', { cause })
  }
}

async function readPersistedInstallationId(statePath: string): Promise<DesktopInstallationId | undefined> {
  let stat: Awaited<ReturnType<typeof lstat>>
  try {
    stat = await lstat(statePath)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw new DesktopInstallationIdError('Desktop installation identity state could not be inspected.', { cause })
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new DesktopInstallationIdError('Desktop installation identity state must be an ordinary file.')
  }
  if (stat.size > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined

  const handle = await open(statePath, 'r')
  try {
    const opened = await handle.stat()
    if (!opened.isFile() || opened.size > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined
    if (opened.dev !== stat.dev || opened.ino !== stat.ino) {
      throw new DesktopInstallationIdError('Desktop installation identity state changed while it was being opened.')
    }
    const buffer = Buffer.alloc(MAX_DESKTOP_INSTALLATION_ID_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_DESKTOP_INSTALLATION_ID_BYTES) return undefined
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
    const match = /^([0-9a-f-]+)\n?$/u.exec(text)
    const parsed = match === null ? undefined : parseDesktopInstallationId(match[1])
    if (parsed === undefined) return undefined
    await handle.chmod(PRIVATE_FILE_MODE)
    return parsed
  } catch (cause) {
    if (cause instanceof TypeError) return undefined
    if (cause instanceof DesktopInstallationIdError) throw cause
    throw new DesktopInstallationIdError('Desktop installation identity state could not be read safely.', { cause })
  } finally {
    await handle.close()
  }
}
