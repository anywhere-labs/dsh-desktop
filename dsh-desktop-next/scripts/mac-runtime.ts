import { chmodSync, existsSync } from 'node:fs'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES, prepareMacUniversalRuntime } from '../../dsh-plugin-desktop/scripts/mac-universal.ts'
import { cuaNativeEntries, prepareCuaNative } from './upstream-family.ts'
// Next uses the official Host, which has no dependency on the old desktop lock binding.
export const NEXT_MAC_NATIVE_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => !entry.path.startsWith('node_modules/fs-ext/')),
  { arch: 'arm64' as const, path: 'node_modules/@trycua/cua-driver-darwin-arm64/cua_driver_node_runtime.node' },
  { arch: 'x86_64' as const, path: 'node_modules/@trycua/cua-driver-darwin-x64/cua_driver_node_runtime.node' },
  { arch: 'arm64' as const, path: 'node_modules/@ubjs/node-darwin-arm64/uniffi-runtime-napi.darwin-arm64.node' },
  { arch: 'x86_64' as const, path: 'node_modules/@ubjs/node-darwin-x64/uniffi-runtime-napi.darwin-x64.node' },
]
/**
 * Native files one macOS package carries: the fixed inventory and, when it ships the official Computer Use
 * bundle, that bundle's helpers.
 * @param desktopRoot - Desktop package root.
 * @returns Thin native files per CPU, relative to the application directory.
 */
export function nextMacNativeEntries(desktopRoot: string): { arch: 'arm64' | 'x86_64'; path: string }[] {
  return [...NEXT_MAC_NATIVE_ENTRIES, ...cuaNativeEntries?.(desktopRoot) ?? []]
}
export function prepareNextMacRuntime(desktopRoot: string): void {
  prepareCuaNative?.(desktopRoot, ['arm64', 'x64'])
  prepareMacUniversalRuntime({ desktopRoot, nativeEntries: nextMacNativeEntries(desktopRoot), exists: existsSync, chmod: chmodSync })
}
