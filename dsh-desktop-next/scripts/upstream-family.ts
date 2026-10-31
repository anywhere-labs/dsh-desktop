/**
 * Packaging steps that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is
 * a declared difference between the variants (scripts/verify-desktop-variants.mjs); scripts import these names from
 * here so that the rest of the scripts stay mirrored.
 */

// dsh 0.2.1 ships no official Computer Use bundle, so packaging builds no helper and checks no provider.
export const cuaNativeEntries: ((desktopRoot: string) => { arch: 'arm64' | 'x86_64'; path: string }[]) | undefined = undefined
export const prepareCuaNative: ((desktopRoot: string, archs: readonly ('arm64' | 'x64')[]) => string[]) | undefined = undefined
export const OFFICIAL_CUA_UNPACKED: RegExp | undefined = undefined
export const PACKAGED_OFFICIAL_CUA_SMOKE: string | undefined = undefined
