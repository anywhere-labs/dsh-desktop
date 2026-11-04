/**
 * Packaging steps that differ between the DSH releases Next and Beta follow. Like src/upstream-family.ts, this file is
 * a declared difference between the variants (scripts/verify-desktop-variants.mjs); scripts import these names from
 * here so that the rest of the scripts stay mirrored.
 */

// No packaging step differs at present: dsh 0.2.2 installs its official Computer Use on demand into the Profile.
export {}
