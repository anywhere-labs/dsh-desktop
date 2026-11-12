/**
 * Packaging steps that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is
 * a declared difference between the variants (scripts/verify-desktop-variants.mjs); scripts import these names from
 * here so that the rest of the scripts stay mirrored.
 */

// rc.2 ships Computer Use in the optional installation catalog; its native app needs a physical path.
export const OFFICE_SKILLS_IN_PACKAGE = true
export const OFFICE_SKILL_UNPACKED: RegExp | undefined = /^node_modules\/@deepseek-ai\/dsh-skill-office\//u
export const LEGACY_AGENT_TEAM_BUNDLE: string | undefined = undefined

export { prepareCuaNative } from './upstream-family/cua-native.ts'
export const OFFICIAL_CUA_UNPACKED: RegExp | undefined = /^node_modules\/@deepseek-ai\/dsh-experimental-cua-macos\//u
