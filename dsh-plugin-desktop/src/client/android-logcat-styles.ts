const STYLE_ID = 'dsh-android-logcat-styles'
const OPAQUE_LAYER_1 = '--dsh-android-logcat-bg-layer-1'
const OPAQUE_LAYER_2 = '--dsh-android-logcat-bg-layer-2'

function resolveOpaqueThemeColor(token: string, fallback: string): string {
  const body = document.body
  if (body === null || body === undefined) return fallback
  const raw = getComputedStyle(body).getPropertyValue(token).trim()
  if (raw === '') return fallback
  const probe = document.createElement('span')
  probe.style.color = raw
  if (probe.style.color === '') return fallback
  body.appendChild(probe)
  const normalized = getComputedStyle(probe).color
  probe.remove()
  const components = normalized.match(/rgba?\(([^)]+)\)/i)?.[1]?.replaceAll(',', ' ').replace('/', ' ').trim().split(/\s+/u)
  if (components === undefined || components.length < 3) return fallback
  return `rgb(${components.slice(0, 3).join(' ')})`
}

const CSS = `
.dshAndroidLogcatLauncher { width: max-content; max-width: 100%; min-width: 0; align-self: flex-start; justify-content: flex-start; margin-inline-start: 0; padding-inline: 0; }
.dshAndroidLogcatDrawer {
  position: absolute;
  z-index: 2147483000;
  right: 0;
  bottom: 0;
  left: 0;
  display: flex;
  box-sizing: border-box;
  height: min(var(--dsh-android-logcat-height), 88vh, calc(100% - 8px));
  max-height: calc(100% - 8px);
  min-height: 180px;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid var(--dsw-alias-border-l1);
  border-bottom: 0;
  border-radius: 12px 12px 0 0;
  background: var(--dsh-android-logcat-bg-layer-1);
  color: var(--dsw-alias-label-primary);
  box-shadow: 0 -12px 40px rgba(0, 0, 0, .24);
  font: var(--dsh-android-logcat-ui-font-size, 12px)/1.45 var(--dsw-font-family, system-ui, sans-serif);
  pointer-events: auto;
}
.dshAndroidLogcatDrawer[data-collapsed="true"] {
  height: 42px;
  min-height: 42px;
}
.dshAndroidLogcatResizeHandle {
  position: absolute;
  z-index: 1;
  top: -3px;
  right: 0;
  left: 0;
  height: 8px;
  cursor: ns-resize;
  touch-action: none;
}
.dshAndroidLogcatResizeHandle::after {
  position: absolute;
  top: 3px;
  left: calc(50% - 18px);
  width: 36px;
  height: 3px;
  border-radius: 4px;
  background: var(--dsw-alias-border-l1);
  content: "";
}
.dshAndroidLogcatResizeHandle:hover::after,
.dshAndroidLogcatResizeHandle:focus-visible::after { background: var(--dsw-alias-brand-primary); }
.dshAndroidLogcatResizeHandle:focus-visible { outline: none; }
.dshAndroidLogcatHeader {
  display: flex;
  box-sizing: border-box;
  min-height: 40px;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 5px 12px 5px 16px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsh-android-logcat-bg-layer-2);
  user-select: none;
}
.dshAndroidLogcatHeading { display: flex; min-width: 0; align-items: baseline; gap: 10px; }
.dshAndroidLogcatHeading strong { overflow: hidden; font-size: 1.08em; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.dshAndroidLogcatHeading > span { overflow: hidden; color: var(--dsw-alias-label-secondary); text-overflow: ellipsis; white-space: nowrap; }
.dshAndroidLogcatStatus { color: var(--dsw-alias-state-success-primary) !important; }
.dshAndroidLogcatStatus[data-state="paused"] { color: var(--dsw-alias-state-warn-primary) !important; }
.dshAndroidLogcatHeaderActions { display: flex; flex: 0 0 auto; align-items: center; gap: 4px; }
.dshAndroidLogcatIconButton,
.dshAndroidLogcatButton {
  display: inline-flex;
  min-height: 28px;
  box-sizing: border-box;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsh-android-logcat-bg-layer-2);
  color: inherit;
  cursor: pointer;
  font: inherit;
  white-space: nowrap;
}
.dshAndroidLogcatIconButton { width: 28px; padding: 0; border-color: transparent; background: transparent; font-size: 18px; }
.dshAndroidLogcatIconButton:hover,
.dshAndroidLogcatButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshAndroidLogcatButton:disabled { cursor: not-allowed; opacity: .5; }
.dshAndroidLogcatButton:focus-visible,
.dshAndroidLogcatIconButton:focus-visible,
.dshAndroidLogcatField select:focus-visible,
.dshAndroidLogcatPatternField input:focus-visible,
.dshAndroidLogcatDisplayField select:focus-visible,
.dshAndroidLogcatFollowToggle input:focus-visible,
.dshAndroidLogcatTipsToggle input:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: 1px;
}
.dshAndroidLogcatPrimaryButton { border-color: transparent; background: var(--dsw-alias-brand-primary); color: var(--dsw-alias-label-primary-foreground); }
.dshAndroidLogcatToolbar {
  display: flex;
  min-height: 42px;
  flex: 0 0 auto;
  align-items: end;
  flex-wrap: wrap;
  gap: 7px;
  padding: 6px 10px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsh-android-logcat-bg-layer-1);
}
.dshAndroidLogcatField,
.dshAndroidLogcatPatternField { display: flex; min-width: 110px; flex: 0 1 205px; flex-direction: column; gap: 3px; }
.dshAndroidLogcatField > span,
.dshAndroidLogcatPatternField > span:first-child { color: var(--dsw-alias-label-secondary); font-size: .83em; }
.dshAndroidLogcatField select,
.dshAndroidLogcatPatternField input {
  width: 100%;
  height: 28px;
  box-sizing: border-box;
  padding: 3px 8px;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 6px;
  background: var(--dsh-android-logcat-bg-layer-1);
  color: inherit;
  font: inherit;
}
.dshAndroidLogcatField select:disabled { opacity: .55; }
.dshAndroidLogcatProcessField { flex-basis: 225px; }
.dshAndroidLogcatSeverityField { flex-basis: 125px; }
.dshAndroidLogcatFilterBar { align-items: flex-end; }
.dshAndroidLogcatPatternField { min-width: 170px; flex: 1 1 190px; }
.dshAndroidLogcatPatternField input[aria-invalid="true"] { border-color: var(--dsw-alias-state-error-primary); }
.dshAndroidLogcatFollowToggle { display: inline-flex; min-height: 28px; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); white-space: nowrap; }
.dshAndroidLogcatFollowToggle input { accent-color: var(--dsw-alias-brand-primary); }
.dshAndroidLogcatMultiFilter { position: relative; flex: 0 0 auto; }
.dshAndroidLogcatMultiFilter summary { display: flex; min-height: 28px; box-sizing: border-box; align-items: center; padding: 4px 9px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; background: var(--dsh-android-logcat-bg-layer-1); cursor: pointer; list-style: none; white-space: nowrap; }
.dshAndroidLogcatMultiFilter summary::-webkit-details-marker { display: none; }
.dshAndroidLogcatMultiFilter[data-disabled] summary { cursor: not-allowed; opacity: .55; }
.dshAndroidLogcatMultiFilterMenu { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; display: flex; min-width: 190px; max-height: 240px; flex-direction: column; gap: 2px; overflow: auto; padding: 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 7px; background: var(--dsh-android-logcat-bg-layer-1); box-shadow: 0 8px 24px rgba(0, 0, 0, .5); }
.dshAndroidLogcatMultiFilterMenu label { display: flex; min-height: 26px; align-items: center; gap: 7px; padding: 2px 5px; border-radius: 4px; cursor: pointer; }
.dshAndroidLogcatMultiFilterMenu label:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshAndroidLogcatMultiFilterMenu input { accent-color: var(--dsw-alias-brand-primary); }
.dshAndroidLogcatMultiFilterMenu span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshAndroidLogcatDisplaySettings { display: flex; flex: 0 0 auto; align-items: center; flex-wrap: wrap; gap: 8px 14px; padding: 5px 12px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsh-android-logcat-bg-layer-1); }
.dshAndroidLogcatDisplayField { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); }
.dshAndroidLogcatDisplayField select { min-height: 26px; padding: 2px 6px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 5px; background: var(--dsh-android-logcat-bg-layer-1); color: inherit; font: inherit; }
.dshAndroidLogcatTipsToggle { display: inline-flex; align-items: center; gap: 6px; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.dshAndroidLogcatTipsToggle input { accent-color: var(--dsw-alias-brand-primary); }
.dshAndroidLogcatFilterHelp { display: flex; flex: 0 0 auto; flex-direction: column; gap: 2px; padding: 3px 12px 6px; color: var(--dsw-alias-label-secondary); font-size: .83em; }
.dshAndroidLogcatFilterHelp[hidden] { display: none; }
.dshAndroidLogcatFilterHelp strong { color: var(--dsw-alias-label-primary); font-size: 1.1em; }
.dshAndroidLogcatFilterError { margin: 0; padding: 0; color: var(--dsw-alias-state-error-primary) !important; font-size: .83em; font-weight: 500; }
.dshAndroidLogcatScreenshotBackdrop { position: fixed; z-index: 2147483647; inset: 0; display: grid; place-items: center; padding: 16px; background: var(--dsw-alias-bg-mask-photo); }
.dshAndroidLogcatScreenshotDialog { display: flex; width: min(900px, 96vw); max-height: 94vh; flex-direction: column; overflow: hidden; border: 1px solid var(--dsw-alias-border-l2); border-radius: 10px; background: var(--dsh-android-logcat-bg-layer-2); box-shadow: 0 18px 60px rgba(0, 0, 0, .7); color: var(--dsw-alias-label-primary); }
.dshAndroidLogcatScreenshotDialog header,
.dshAndroidLogcatScreenshotDialog footer { display: flex; flex: 0 0 auto; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 12px; background: var(--dsh-android-logcat-bg-layer-2); }
.dshAndroidLogcatScreenshotDialog img { min-height: 0; max-width: 100%; flex: 1 1 auto; object-fit: contain; }
.dshAndroidLogcatScreenshotDialog footer { justify-content: flex-end; }
.dshAndroidLogcatScreenshotDialog a { text-decoration: none; }
.dshAndroidLogcatAlerts { display: flex; flex: 0 0 auto; flex-direction: column; gap: 3px; padding: 6px 12px 0; }
.dshAndroidLogcatAlerts p,
.dshAndroidLogcatEmptyHint { margin: 0; color: var(--dsw-alias-label-secondary); }
.dshAndroidLogcatAlerts p[role="alert"] { color: var(--dsw-alias-state-error-primary); }
.dshAndroidLogcatAlerts p[role="status"] { color: var(--dsw-alias-state-warn-primary); }
.dshAndroidLogcatEmptyHint { flex: 0 0 auto; padding: 10px 12px; }
.dshAndroidLogcatLogList {
  min-height: 0;
  flex: 1 1 auto;
  overflow: auto;
  padding: 4px 0;
  background: var(--dsh-android-logcat-bg-layer-1);
  scrollbar-gutter: stable;
  overscroll-behavior: contain;
  font: var(--dsh-android-logcat-log-font-size, 12px)/1.55 var(--dsw-mono-font-family, ui-monospace, SFMono-Regular, Consolas, monospace);
}
.dshAndroidLogcatLogRow { display: flex; width: 100%; min-width: 0; align-items: flex-start; flex-wrap: wrap; gap: 3px 10px; box-sizing: border-box; padding: 2px 12px; color: var(--dsw-alias-label-secondary); }
.dshAndroidLogcatLogRow code { min-width: 0; font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
.dshAndroidLogcatLogRow > code:only-child { flex: 1 1 100%; }
.dshAndroidLogcatTimestamp { flex: 0 1 150px; min-width: 110px; color: var(--dsw-alias-label-tertiary); }
.dshAndroidLogcatLogMeta { flex: 0 1 80px; min-width: 55px; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; font: inherit; text-align: left; }
.dshAndroidLogcatLevel { flex: 0 0 30px; font-weight: 700; }
.dshAndroidLogcatLogTag { flex: 0 1 180px; min-width: 90px; overflow: hidden; padding: 0; border: 0; background: transparent; color: var(--dsw-alias-link); cursor: pointer; font: inherit; text-align: left; text-overflow: ellipsis; white-space: nowrap; }
.dshAndroidLogcatMessage { flex: 1 1 240px; min-width: 0; color: inherit; white-space: pre-wrap; overflow-wrap: anywhere; }
.dshAndroidLogcatLogRow[data-level="verbose"] { color: var(--dsw-alias-label-secondary); }
.dshAndroidLogcatLogRow[data-level="debug"] { color: var(--dsw-alias-label-primary); }
.dshAndroidLogcatLogRow[data-level="info"] { color: var(--dsw-alias-state-success-primary); }
.dshAndroidLogcatLogRow[data-level="warn"] { color: var(--dsw-alias-state-warn-primary); }
.dshAndroidLogcatLogRow[data-level="error"] { color: var(--dsw-alias-state-error-primary); }
.dshAndroidLogcatFooter { display: flex; min-height: 22px; flex: 0 0 auto; align-items: center; justify-content: space-between; padding: 2px 12px; border-top: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-label-secondary); font-size: .83em; }
@media (max-width: 720px) {
  .dshAndroidLogcatDrawer { height: min(var(--dsh-android-logcat-height), 92vh, calc(100% - 8px)); max-height: calc(100% - 8px); border-radius: 8px 8px 0 0; }
  .dshAndroidLogcatToolbar { align-items: stretch; }
  .dshAndroidLogcatField { flex: 1 1 140px; }
  .dshAndroidLogcatProcessField { flex-basis: 170px; }
  .dshAndroidLogcatFilterBar { gap: 5px; }
  .dshAndroidLogcatFilterBar > .dshAndroidLogcatButton { padding-inline: 6px; }
  .dshAndroidLogcatHeading > span:not(.dshAndroidLogcatStatus) { display: none; }
}
@media (prefers-reduced-motion: no-preference) {
  .dshAndroidLogcatDrawer { transition: height 120ms ease; }
}
`

/** Install one plugin-owned stylesheet and return its lifecycle disposer. */
export function installAndroidLogcatStyles(owner: string): () => void {
  if (typeof document === 'undefined') return () => {}
  const existing = document.getElementById(STYLE_ID)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.id = STYLE_ID
  style.dataset.plugin = owner
  style.dataset.pluginCss = `${owner}/android-logcat`
  const isDark = () => document.body?.hasAttribute('data-ds-dark-theme') ?? false
  const refreshOpaqueThemeColors = () => {
    const dark = isDark()
    const layer1 = resolveOpaqueThemeColor('--dsw-alias-bg-layer-1', dark ? 'rgb(35 35 36)' : 'rgb(249 250 251)')
    const layer2 = resolveOpaqueThemeColor('--dsw-alias-bg-layer-2', dark ? 'rgb(44 44 46)' : 'rgb(249 250 251)')
    style.textContent = `:root { ${OPAQUE_LAYER_1}: ${layer1}; ${OPAQUE_LAYER_2}: ${layer2}; }\n${CSS}`
  }
  refreshOpaqueThemeColors()
  document.head.appendChild(style)
  const themeRoot = document.body ?? document.documentElement
  const observer = typeof MutationObserver === 'undefined' || themeRoot === undefined
    ? null
    : new MutationObserver(refreshOpaqueThemeColors)
  observer?.observe(themeRoot, { attributes: true, attributeFilter: ['data-ds-dark-theme', 'class'] })
  return () => { observer?.disconnect(); style.remove() }
}
