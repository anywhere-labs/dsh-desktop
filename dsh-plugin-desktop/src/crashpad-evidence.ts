import {
  closeSync,
  constants,
  fstatSync,
  lstatSync,
  openSync,
  readSync,
  readdirSync,
} from 'node:fs'
import { basename, join } from 'node:path'

const MINIDUMP_SIGNATURE = 0x504d444d
const MINIDUMP_EXCEPTION_STREAM = 6
const MINIDUMP_MODULE_LIST_STREAM = 4
const MINIDUMP_SYSTEM_INFO_STREAM = 7
const MINIDUMP_MISC_INFO_STREAM = 15
const MAX_STREAMS = 256
const MAX_MODULES = 4096
const MAX_MODULE_NAME_CHARS = 2048
const MAX_DUMP_BYTES = 512 * 1024 * 1024
const MAX_DUMPS_TO_REPORT = 8

export interface DesktopCrashDumpSummary {
  readonly file: string
  readonly modifiedAt: string
  readonly sizeBytes: number
  readonly dumpTimestamp?: string
  readonly processId?: number
  readonly exceptionThreadId?: number
  readonly exceptionCode?: number
  readonly exceptionCodeHex?: string
  readonly exceptionAddress?: string
  readonly instructionPointer?: string
  readonly exceptionModule?: string
  readonly exceptionModuleOffset?: string
  readonly parseError?: string
}

interface MinidumpStream {
  readonly size: number
  readonly rva: number
}

type ReadMetadata = (offset: number, length: number) => Buffer | undefined

/**
 * Read the small, fixed-layout fields needed to correlate a Crashpad dump with
 * Electron's child-process-gone event. The buffer overload is for deterministic
 * tests; production reads only headers, exception records, module tables and
 * module-name strings, never thread stacks or application memory payloads.
 */
export function parseDesktopMinidumpHeader(buffer: Buffer): Omit<DesktopCrashDumpSummary,
  'file' | 'modifiedAt' | 'sizeBytes' | 'parseError'> {
  return parseMinidump(buffer.byteLength, (offset, length) => {
    if (!rangeFits(buffer.byteLength, offset, length)) return undefined
    return buffer.subarray(offset, offset + length)
  })
}

/**
 * Summarize recent Crashpad pending dumps for the active/previous app run.
 * Paths and dump contents are never emitted; only the GUID filename and a
 * bounded set of exception fields are returned. This is safe to call from an
 * exit observer, where a bad or partial dump must not hide the original event.
 */
export function summarizeDesktopCrashDumps(
  crashReporterDirectory: string,
  since: string | undefined,
  limit = MAX_DUMPS_TO_REPORT,
): DesktopCrashDumpSummary[] {
  const sinceMs = since === undefined ? Number.NEGATIVE_INFINITY : Date.parse(since)
  const cutoff = Number.isFinite(sinceMs) ? sinceMs : Number.NEGATIVE_INFINITY
  const maximum = Math.max(0, Math.min(MAX_DUMPS_TO_REPORT, Math.trunc(limit)))
  if (maximum === 0) return []

  const pendingDirectory = join(crashReporterDirectory, 'pending')
  let names: string[]
  try { names = readdirSync(pendingDirectory) } catch { return [] }

  const candidates: Array<{ path: string; mtimeMs: number }> = []
  for (const name of names) {
    if (!/^[0-9a-f-]{36}\.dmp$/iu.test(name)) continue
    const path = join(pendingDirectory, name)
    try {
      const stats = lstatSync(path)
      if (stats.isSymbolicLink() || !stats.isFile() || stats.nlink > 1 || stats.size > MAX_DUMP_BYTES) continue
      if (stats.mtimeMs < cutoff) continue
      candidates.push({ path, mtimeMs: stats.mtimeMs })
    } catch { /* a dump may be concurrently removed by Crashpad */ }
  }
  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs)

  return candidates.slice(0, maximum).map(({ path, mtimeMs }) => summarizeDump(path, mtimeMs))
}

function parseMinidump(
  fileSize: number,
  readMetadata: ReadMetadata,
): Omit<DesktopCrashDumpSummary, 'file' | 'modifiedAt' | 'sizeBytes' | 'parseError'> {
  const header = readMetadata(0, 32)
  if (header === undefined || header.readUInt32LE(0) !== MINIDUMP_SIGNATURE) throw new Error('not a minidump')

  const streamCount = header.readUInt32LE(8)
  const directoryRva = header.readUInt32LE(12)
  const timestampSeconds = header.readUInt32LE(20)
  if (streamCount > MAX_STREAMS || !rangeFits(fileSize, directoryRva, streamCount * 12)) {
    throw new Error('minidump stream directory is invalid')
  }
  const directory = readMetadata(directoryRva, streamCount * 12)
  if (directory === undefined) throw new Error('minidump stream directory is unreadable')

  const streams = new Map<number, MinidumpStream>()
  for (let index = 0; index < streamCount; index += 1) {
    const offset = index * 12
    const type = directory.readUInt32LE(offset)
    const size = directory.readUInt32LE(offset + 4)
    const rva = directory.readUInt32LE(offset + 8)
    if (rangeFits(fileSize, rva, size)) streams.set(type, { size, rva })
  }

  let processorArchitecture: number | undefined
  const systemInfo = streams.get(MINIDUMP_SYSTEM_INFO_STREAM)
  if (systemInfo !== undefined && systemInfo.size >= 2) {
    const prefix = readMetadata(systemInfo.rva, 2)
    if (prefix !== undefined) processorArchitecture = prefix.readUInt16LE(0)
  }

  let processId: number | undefined
  const misc = streams.get(MINIDUMP_MISC_INFO_STREAM)
  if (misc !== undefined && misc.size >= 12) {
    const prefix = readMetadata(misc.rva, 12)
    if (prefix !== undefined) {
      const flags = prefix.readUInt32LE(4)
      // MINIDUMP_MISC1_PROCESS_ID = 1; ProcessId follows SizeOfInfo and Flags1.
      if ((flags & 1) !== 0) processId = prefix.readUInt32LE(8)
    }
  }

  let exceptionThreadId: number | undefined
  let exceptionCode: number | undefined
  let exceptionAddress: bigint | undefined
  let instructionPointer: bigint | undefined
  const exception = streams.get(MINIDUMP_EXCEPTION_STREAM)
  if (exception !== undefined && exception.size >= 168) {
    const record = readMetadata(exception.rva, 168)
    if (record !== undefined) {
      exceptionThreadId = record.readUInt32LE(0)
      exceptionCode = record.readUInt32LE(8)
      exceptionAddress = record.readBigUInt64LE(24)
      const contextSize = record.readUInt32LE(160)
      const contextRva = record.readUInt32LE(164)
      const pcOffset = processorArchitecture === 9 ? 248
        : processorArchitecture === 0 ? 184
          : processorArchitecture === 12 ? 264
            : undefined
      const pcBytes = processorArchitecture === 0 ? 4 : 8
      if (pcOffset !== undefined && contextSize >= pcOffset + pcBytes
        && rangeFits(fileSize, contextRva, pcOffset + pcBytes)) {
        const context = readMetadata(contextRva, pcOffset + pcBytes)
        if (context !== undefined) {
          instructionPointer = processorArchitecture === 0
            ? BigInt(context.readUInt32LE(pcOffset))
            : context.readBigUInt64LE(pcOffset)
        }
      }
    }
  }

  let exceptionModule: string | undefined
  let exceptionModuleOffset: string | undefined
  const moduleAddress = instructionPointer ?? (exceptionAddress === 0n ? undefined : exceptionAddress)
  if (moduleAddress !== undefined) {
    const moduleList = streams.get(MINIDUMP_MODULE_LIST_STREAM)
    if (moduleList !== undefined && moduleList.size >= 4) {
      const countBytes = readMetadata(moduleList.rva, 4)
      const moduleCount = countBytes?.readUInt32LE(0)
      if (moduleCount !== undefined && moduleCount <= MAX_MODULES
        && rangeFits(moduleList.size, 4, moduleCount * 108)) {
        const tableBytes = moduleCount * 108
        const entries = readMetadata(moduleList.rva + 4, tableBytes)
        if (entries !== undefined) {
          for (let index = 0; index < moduleCount; index += 1) {
            const offset = index * 108
            const baseAddress = entries.readBigUInt64LE(offset)
            const imageSize = BigInt(entries.readUInt32LE(offset + 8))
            if (moduleAddress < baseAddress || moduleAddress >= baseAddress + imageSize) continue
            const nameRva = entries.readUInt32LE(offset + 20)
            const modulePath = readMinidumpString(readMetadata, fileSize, nameRva)
            if (modulePath !== undefined) exceptionModule = basename(modulePath)
            exceptionModuleOffset = `0x${(moduleAddress - baseAddress).toString(16)}`
            break
          }
        }
      }
    }
  }

  return {
    ...(timestampSeconds === 0 ? {} : { dumpTimestamp: new Date(timestampSeconds * 1000).toISOString() }),
    ...(processId === undefined ? {} : { processId }),
    ...(exceptionThreadId === undefined ? {} : { exceptionThreadId }),
    ...(exceptionCode === undefined ? {} : { exceptionCode, exceptionCodeHex: `0x${exceptionCode.toString(16)}` }),
    ...(exceptionAddress === undefined ? {} : { exceptionAddress: `0x${exceptionAddress.toString(16)}` }),
    ...(instructionPointer === undefined ? {} : { instructionPointer: `0x${instructionPointer.toString(16)}` }),
    ...(exceptionModule === undefined ? {} : { exceptionModule }),
    ...(exceptionModuleOffset === undefined ? {} : { exceptionModuleOffset }),
  }
}

function summarizeDump(path: string, modifiedAtMs: number): DesktopCrashDumpSummary {
  const file = basename(path)
  let descriptor: number | undefined
  let sizeBytes = 0
  try {
    const noFollow = process.platform === 'win32' ? 0 : constants.O_NOFOLLOW
    descriptor = openSync(path, constants.O_RDONLY | noFollow)
    const stats = fstatSync(descriptor)
    sizeBytes = stats.size
    if (!stats.isFile() || stats.nlink > 1 || stats.size > MAX_DUMP_BYTES) {
      return { file, modifiedAt: new Date(modifiedAtMs).toISOString(), sizeBytes: stats.size, parseError: 'unsafe-or-too-large' }
    }
    const parsed = parseMinidump(stats.size, (offset, length) => readAt(descriptor!, stats.size, offset, length))
    return {
      file,
      modifiedAt: new Date(modifiedAtMs).toISOString(),
      sizeBytes: stats.size,
      ...parsed,
    }
  } catch (cause) {
    return {
      file,
      modifiedAt: new Date(modifiedAtMs).toISOString(),
      sizeBytes,
      parseError: cause instanceof Error && typeof (cause as NodeJS.ErrnoException).code === 'string'
        ? (cause as NodeJS.ErrnoException).code!.slice(0, 40)
        : 'invalid-or-unreadable-minidump',
    }
  } finally {
    if (descriptor !== undefined) {
      try { closeSync(descriptor) } catch { /* best effort */ }
    }
  }
}

function readAt(descriptor: number, fileSize: number, offset: number, length: number): Buffer | undefined {
  if (!rangeFits(fileSize, offset, length)) return undefined
  const buffer = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const count = readSync(descriptor, buffer, read, length - read, offset + read)
    if (count === 0) return undefined
    read += count
  }
  return buffer
}

function readMinidumpString(readMetadata: ReadMetadata, fileSize: number, rva: number): string | undefined {
  if (!rangeFits(fileSize, rva, 4)) return undefined
  const lengthBytes = readMetadata(rva, 4)
  if (lengthBytes === undefined) return undefined
  const byteLength = lengthBytes.readUInt32LE(0)
  if (byteLength > MAX_MODULE_NAME_CHARS * 2 || byteLength % 2 !== 0
    || !rangeFits(fileSize, rva + 4, byteLength)) return undefined
  const name = readMetadata(rva + 4, byteLength)
  if (name === undefined) return undefined
  return name.toString('utf16le').replaceAll(/[\0\r\n]/gu, '')
}

function rangeFits(total: number, offset: number, length: number): boolean {
  return Number.isSafeInteger(offset) && Number.isSafeInteger(length)
    && offset >= 0 && length >= 0 && offset <= total && length <= total - offset
}