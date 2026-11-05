/**
 * Packaging steps that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is
 * a declared difference between the variants (scripts/verify-desktop-variants.mjs); scripts import these names from
 * here so that the rest of the scripts stay mirrored.
 */

// The official Computer Use bundle of dsh 0.2.2 starts a macOS helper that its release does not ship: Desktop builds
// it, keeps the provider unpacked beside the archive and loads the packaged provider in a smoke. The scripts live below
// scripts/upstream-family/, which only Beta carries.
export { cuaNativeEntries, prepareCuaNative } from './upstream-family/cua-native.ts'

/** The provider package, which starts the helper below its own directory; the Host resolves it to its unpacked copy. */
export const OFFICIAL_CUA_UNPACKED: RegExp | undefined = /^node_modules\/@deepseek-ai\/dsh-experimental-cua-macos\//u

/** The smoke that loads the packaged provider and checks its helper, relative to scripts/. */
export const PACKAGED_OFFICIAL_CUA_SMOKE: string | undefined = 'upstream-family/packaged-official-cua-smoke.mjs'
