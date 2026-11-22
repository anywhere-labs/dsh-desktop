/**
 * Client parts that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is a
 * declared difference between the variants (scripts/verify-desktop-variants.mjs); client modules import these names
 * from here so that the rest of the client stays mirrored.
 */

// The official Computer Use bundle of dsh 0.2.2 gets a row on the Computer Use (Next) page. The module lives below
// src/upstream-family/.
export { installOfficialComputerUseStyles, useOfficialComputerUse } from '../upstream-family/official-computer-use-row.tsx'

// The settings shell of dsh 0.2.2 takes section icons from plugins, so Desktop settings shows its display glyph
// without patching the shell. The module lives below src/upstream-family/.
export { registerDesktopSettingsIcon } from '../upstream-family/desktop-settings-icon.tsx'

// The Client primitives of dsh 0.2.3 leave their stylesheets to the official renderer, which the Desktop native pages
// do not run; those pages install the sheets themselves. The module lives below src/upstream-family/.
export { installPrimitivesStyles } from '../upstream-family/primitives-styles.ts'
