import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { assertWindowsArchitecture, assertWindowsArchitectureBuffer, verifyWindowsNativeTree, windowsUnpackedDirectory } from '../scripts/windows-architecture.ts'

it('rejects mixed-CPU native dependencies while permitting an external NSIS bootstrapper', () => {
  const root = mkdtempSync(join(tmpdir(), 'desktop-windows-cpu-'))
  const pe = (machine: number) => {
    const data = Buffer.alloc(256)
    data.write('MZ'); data.writeUInt32LE(128, 60); data.write('PE\0\0', 128); data.writeUInt16LE(machine, 132)
    return data
  }
  try {
    mkdirSync(join(root, 'nested'))
    writeFileSync(join(root, 'native.node'), pe(0xaa64))
    writeFileSync(join(root, 'nested', 'runtime.dll'), pe(0xaa64))
    writeFileSync(join(root, 'installer.exe'), pe(0x14c))
    expect(verifyWindowsNativeTree(root, 'arm64')).toBe(2)
    expect(() => assertWindowsArchitectureBuffer(pe(0x8664), 'arm64', 'archive application')).toThrow('architecture mismatch')
    expect(() => assertWindowsArchitectureBuffer(pe(0xaa64), 'arm64', 'archive application')).not.toThrow()
    expect(() => assertWindowsArchitecture(join(root, 'native.node'), 'x64')).toThrow('architecture mismatch')
    writeFileSync(join(root, 'nested', 'runtime.dll'), pe(0x8664))
    expect(() => verifyWindowsNativeTree(root, 'arm64')).toThrow('architecture mismatch')
    writeFileSync(join(root, 'native.node'), 'broken')
    expect(() => assertWindowsArchitecture(join(root, 'native.node'), 'arm64')).toThrow('Invalid Windows PE')
    expect(windowsUnpackedDirectory('arm64')).toBe('win-arm64-unpacked')
    expect(windowsUnpackedDirectory('x64')).toBe('win-unpacked')
    expect(() => windowsUnpackedDirectory('ia32')).toThrow('Unsupported Windows')
  } finally { rmSync(root, { recursive: true, force: true }) }
})
