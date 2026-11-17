/**
 * Root attribute that activates the onboarding-only stylesheet. The Desktop continuation sets it on
 * `<html>` while its content occupies the official onboarding surface, and the client build scopes
 * the sheet to `:root[...]`. A `:root:has(...)` scope instead makes Chromium restyle the whole
 * document after every DOM change, which slows opening and streaming long Sessions.
 */
export const ONBOARDING_STYLE_ATTRIBUTE = 'data-desktop-onboarding-styles'
