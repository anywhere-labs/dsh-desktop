/** The resolvers a packaged Host installs for packages that must resolve to their unpacked copies; the artifact smoke imports them from the archive. */
export { installOfficeEngineResolution, runtimeArchivePath } from './office-engine.ts'
export { AGENT_PRESET_PACKAGE, installAgentPresetResolution } from './agent-preset.ts'
export { CUA_DRIVER_PLATFORM_PACKAGES, installCuaDriverResolution } from './cua-driver.ts'
export { SHARP_WASM_PACKAGE, installSharpWasmResolution } from './sharp-wasm.ts'
export { SKILL_BADGE_PACKAGE, installSkillBadgeResolution } from './skill-badge.ts'
