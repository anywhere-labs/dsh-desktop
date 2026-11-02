/**
 * Client parts that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is a
 * declared difference between the variants (scripts/verify-desktop-variants.mjs); client modules import these names
 * from here so that the rest of the client stays mirrored.
 */

// The official Computer Use bundle of dsh 0.2.2 gets a row on the Computer Use (Next) page. The module lives below
// src/upstream-family/, which only Beta carries.
export { installOfficialComputerUseStyles, useOfficialComputerUse } from '../upstream-family/official-computer-use-row.tsx'
