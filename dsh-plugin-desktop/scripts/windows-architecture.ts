/** Native Windows package paths and PE architecture checks shared by Desktop channels. */
import { closeSync, openSync, readdirSync, readSync } from 'node:fs'
import { extname, join } from 'node:path'

export type WindowsArchitecture = 'x64' | 'arm64'

export function windowsArchitecture(arch: string = process.arch): WindowsArchitecture {
  if (arch !== 'x64' && arch !== 'arm64') throw new Error(`Unsupported Windows architecture: ${arch}`)
  return arch
}

export function windowsUnpackedDirectory(arch: string = process.arch): string {
  return windowsArchitecture(arch) === 'x64' ? 'win-unpacked' : 'win-arm64-unpacked'
}

function assertMachine(pe: Buffer, arch: WindowsArchitecture, path: string): void {
  if (pe.length !== 6 || pe.toString('ascii', 0, 4) !== 'PE\0\0') throw new Error(`Invalid Windows PE signature: ${path}`)
  const expected = arch === 'arm64' ? 0xaa64 : 0x8664
  if (pe.readUInt16LE(4) !== expected) throw new Error(`Windows PE architecture mismatch: expected ${arch}, got 0x${pe.readUInt16LE(4).toString(16)}: ${path}`)
}

/** Verify an application image read directly from a portable archive. */
export function assertWindowsArchitectureBuffer(data: Buffer, arch: WindowsArchitecture, source: string): void {
  if (data.length < 64 || data.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Invalid Windows PE header: ${source}`)
  const offset = data.readUInt32LE(60)
  assertMachine(data.subarray(offset, offset + 6), arch, source)
}

/** Read only the DOS header and COFF machine field, including for large executables. */
export function assertWindowsArchitecture(path: string, arch: WindowsArchitecture): void {
  const fd = openSync(path, 'r')
  try {
    const dos = Buffer.alloc(64)
    if (readSync(fd, dos, 0, dos.length, 0) !== dos.length || dos.toString('ascii', 0, 2) !== 'MZ') throw new Error(`Invalid Windows PE header: ${path}`)
    const pe = Buffer.alloc(6)
    const bytes = readSync(fd, pe, 0, pe.length, dos.readUInt32LE(60))
    assertMachine(pe.subarray(0, bytes), arch, path)
  } finally { closeSync(fd) }
}

/** In-process addons and DLLs must match Electron; an NSIS bootstrapper can use another CPU. */
export function verifyWindowsNativeTree(root: string, arch: WindowsArchitecture): number {
  let checked = 0
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) checked += verifyWindowsNativeTree(path, arch)
    else if (entry.isFile() && ['.node', '.dll', '.pyd'].includes(extname(entry.name).toLowerCase())) {
      assertWindowsArchitecture(path, arch)
      checked++
    }
  }
  return checked
}
