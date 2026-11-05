import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { parseDesktopMinidumpHeader, summarizeDesktopCrashDumps } from '../src/crashpad-evidence.ts'

function minidump(): Buffer {
  const buffer = Buffer.alloc(2048)
  const directoryRva = 32
  const streams = [
    { type: 15, size: 12, rva: 80 },
    { type: 6, size: 168, rva: 96 },
    { type: 4, size: 112, rva: 272 },
    { type: 7, size: 2, rva: 72 },
  ]
  buffer.writeUInt32LE(0x504d444d, 0)
  buffer.writeUInt32LE(0xa793, 4)
  buffer.writeUInt32LE(streams.length, 8)
  buffer.writeUInt32LE(directoryRva, 12)
  buffer.writeUInt32LE(1_793_691_280, 20)
  streams.forEach((stream, index) => {
    const offset = directoryRva + index * 12
    buffer.writeUInt32LE(stream.type, offset)
    buffer.writeUInt32LE(stream.size, offset + 4)
    buffer.writeUInt32LE(stream.rva, offset + 8)
  })
  buffer.writeUInt16LE(9, 72) // AMD64
  // MINIDUMP_MISC_INFO: process id flag and PID.
  buffer.writeUInt32LE(12, 80)
  buffer.writeUInt32LE(1, 84)
  buffer.writeUInt32LE(233_197, 88)
  // MINIDUMP_EXCEPTION_STREAM: SIGTRAP may have a zero ExceptionAddress;
  // the actual PC is in CONTEXT_AMD64.Rip.
  buffer.writeUInt32LE(233_201, 96)
  buffer.writeUInt32LE(5, 104)
  buffer.writeBigUInt64LE(0n, 120)
  buffer.writeUInt32LE(1232, 256)
  buffer.writeUInt32LE(512, 260)
  buffer.writeBigUInt64LE(0x100123n, 512 + 248) // CONTEXT_AMD64.Rip
  // One module, with a basename that should be emitted without its private path.
  buffer.writeUInt32LE(1, 272)
  buffer.writeBigUInt64LE(0x100000n, 276)
  buffer.writeUInt32LE(0x5000, 284)
  buffer.writeUInt32LE(400, 296)
  const name = '/opt/DSH Desktop/dsh-desktop'
  const utf16 = Buffer.from(name, 'utf16le')
  buffer.writeUInt32LE(utf16.byteLength, 400)
  utf16.copy(buffer, 404)
  return buffer
}

describe('Crashpad minidump evidence', () => {
  it('extracts process, exception, and containing module without reading user data', () => {
    expect(parseDesktopMinidumpHeader(minidump())).toMatchObject({
      dumpTimestamp: new Date(1_793_691_280 * 1000).toISOString(),
      processId: 233_197,
      exceptionThreadId: 233_201,
      exceptionCode: 5,
      exceptionCodeHex: '0x5',
      exceptionAddress: '0x0',
      instructionPointer: '0x100123',
      exceptionModule: 'dsh-desktop',
      exceptionModuleOffset: '0x123',
    })
  })

  it('rejects malformed minidump headers', () => {
    expect(() => parseDesktopMinidumpHeader(Buffer.alloc(32))).toThrow('not a minidump')
  })

  it('lists recent pending dump summaries, bounded by the previous run time', () => {
    const crashReporterDir = mkdtempSync(join(tmpdir(), 'dsh-crashpad-'))
    const pending = join(crashReporterDir, 'pending')
    mkdirSync(pending)
    const dumpPath = join(pending, 'e63c94c0-ea8e-49c4-a4d3-5bb1e190bac5.dmp')
    writeFileSync(dumpPath, minidump())
    symlinkSync(dumpPath, join(pending, 'b02dc76a-bad2-4987-9c55-389b4569c32b.dmp'))

    const recent = summarizeDesktopCrashDumps(crashReporterDir, new Date(Date.now() - 10_000).toISOString())
    expect(recent).toHaveLength(1)
    expect(recent[0]).toMatchObject({
      file: 'e63c94c0-ea8e-49c4-a4d3-5bb1e190bac5.dmp',
      processId: 233_197,
      exceptionCode: 5,
      exceptionModule: 'dsh-desktop',
    })
    expect(recent[0]?.modifiedAt).toBeTruthy()
  })
})