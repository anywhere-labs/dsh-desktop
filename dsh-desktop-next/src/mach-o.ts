/** Read which CPUs a Mach-O file runs on, without the developer tools `lipo` needs. */
import { closeSync, openSync, readSync } from 'node:fs'
import { open } from 'node:fs/promises'

/** CPU a Mach-O slice targets; `other` covers CPUs Next does not ship. */
export type MachOArchitecture = 'arm64' | 'x64' | 'other'

/** Bytes that hold the thin header, or the fat header with its slice table. */
const HEADER_BYTES = 4096

function cpuArchitecture(cputype: number): MachOArchitecture {
  return cputype === 0x0100000c ? 'arm64' : cputype === 0x01000007 ? 'x64' : 'other'
}

/**
 * Read the CPU types from the start of a Mach-O file, one per slice of a fat archive.
 * @param head - The first bytes of the file; 4096 cover every slice table Next ships.
 * @returns CPU types in header order; empty for data that is not Mach-O.
 */
export function parseMachOArchitectures(head: Buffer): MachOArchitecture[] {
  if (head.length < 8) return []
  const magic = head.subarray(0, 4).toString('hex')
  switch (magic) {
    case 'cffaedfe': case 'cefaedfe': return [cpuArchitecture(head.readUInt32LE(4))]
    case 'feedfacf': case 'feedface': return [cpuArchitecture(head.readUInt32BE(4))]
    case 'cafebabe': case 'cafebabf': {
      const stride = magic === 'cafebabe' ? 20 : 32
      const slices: MachOArchitecture[] = []
      for (let index = 0, offset = 8; index < head.readUInt32BE(4) && offset + 4 <= head.length; index++, offset += stride) {
        slices.push(cpuArchitecture(head.readUInt32BE(offset)))
      }
      return slices
    }
    default: return []
  }
}

/**
 * Read the CPU types a Mach-O file carries, one per slice of a fat archive.
 * @param path - Regular file.
 * @returns CPU types in header order; empty for a file that is not Mach-O.
 */
export function machOArchitectures(path: string): MachOArchitecture[] {
  const descriptor = openSync(path, 'r')
  try {
    const head = Buffer.alloc(HEADER_BYTES)
    return parseMachOArchitectures(head.subarray(0, readSync(descriptor, head, 0, HEADER_BYTES, 0)))
  } finally { closeSync(descriptor) }
}

/**
 * Read the CPU types a Mach-O file carries without blocking the calling thread.
 * @param path - Regular file.
 * @returns CPU types in header order; empty for a file that is not Mach-O.
 */
export async function readMachOArchitectures(path: string): Promise<MachOArchitecture[]> {
  const handle = await open(path, 'r')
  try {
    const head = Buffer.alloc(HEADER_BYTES)
    const { bytesRead } = await handle.read(head, 0, HEADER_BYTES, 0)
    return parseMachOArchitectures(head.subarray(0, bytesRead))
  } finally { await handle.close() }
}
