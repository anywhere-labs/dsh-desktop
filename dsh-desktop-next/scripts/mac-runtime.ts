import { chmodSync, existsSync } from 'node:fs'
import { MACOS_UNIVERSAL_NATIVE_ENTRIES, prepareMacUniversalRuntime } from '../../dsh-plugin-desktop-beta/scripts/mac-universal.ts'
// Next uses the official Host, which has no dependency on the old desktop lock binding.
export const NEXT_MAC_NATIVE_ENTRIES = [
  ...MACOS_UNIVERSAL_NATIVE_ENTRIES.filter(entry => !entry.path.startsWith('node_modules/fs-ext/')),
  { arch: 'arm64' as const, path: 'node_modules/@trycua/cua-driver-darwin-arm64/cua_driver_node_runtime.node' },
  { arch: 'x86_64' as const, path: 'node_modules/@trycua/cua-driver-darwin-x64/cua_driver_node_runtime.node' },
  { arch: 'arm64' as const, path: 'node_modules/@ubjs/node-darwin-arm64/uniffi-runtime-napi.darwin-arm64.node' },
  { arch: 'x86_64' as const, path: 'node_modules/@ubjs/node-darwin-x64/uniffi-runtime-napi.darwin-x64.node' },
]
export function prepareNextMacRuntime(desktopRoot: string): void {
  prepareMacUniversalRuntime({ desktopRoot, nativeEntries: NEXT_MAC_NATIVE_ENTRIES, exists: existsSync, chmod: chmodSync })
}
