/** Bounded, regular-file-only configuration I/O for shell-owned state. */
import { randomUUID } from 'node:crypto'
import { lstatSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export function privateDirectory(path: string): void {
  const parent = dirname(resolve(path))
  if (parent !== path) {
    const info = lstatSync(parent, { throwIfNoEntry: false })
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Expected a real directory: ${parent}`)
    if (!info) privateDirectory(parent)
  }
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new Error(`Expected a real directory: ${path}`)
  if (!info) mkdirSync(path, { mode: 0o700 })
}

export function readPrivateFile(path: string, limit = 1024 * 1024): string | undefined {
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (!info) return undefined
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw new Error(`Configuration must be a regular file smaller than ${limit} bytes: ${path}`)
  // PowerShell 5.1 and other Windows tools can prepend a UTF-8 BOM, which JSON.parse rejects.
  return readFileSync(path, 'utf8').replace(/^\uFEFF/u, '')
}

/** Drop a BOM from a file that upstream also reads itself, because its readers reject one. */
export function removePrivateFileBom(path: string): void {
  if (readPrivateFile(path) === undefined) return
  const text = readFileSync(path, 'utf8')
  if (text.startsWith('\uFEFF')) atomicText(path, text.slice(1))
}

export function atomicText(path: string, text: string): void {
  privateDirectory(dirname(path))
  const info = lstatSync(path, { throwIfNoEntry: false })
  if (info && (!info.isFile() || info.isSymbolicLink())) throw new Error(`Refusing to replace a linked or non-file configuration: ${path}`)
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, text, { mode: 0o600, flag: 'wx' })
    renameSync(temporary, path)
  } finally { rmSync(temporary, { force: true }) }
}

export function atomicJson(path: string, value: unknown): void { atomicText(path, `${JSON.stringify(value, null, 2)}\n`) }
