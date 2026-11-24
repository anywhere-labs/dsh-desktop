/** Styles for the session strip and its menu, injected once with the client plugin. */
const STYLES = `
.dshNextTabs,.dshNextTabsMenu{--dshNextTabsAccent:var(--dsw-alias-brand-primary,#3a6df0);--dshNextTabsWarn:var(--dsw-alias-state-warn-primary,#e5a00d);--dshNextTabsIdle:var(--dsw-alias-label-caption,#8a8f99);--dshNextTabsMono:ui-monospace,"Cascadia Mono","JetBrains Mono",SFMono-Regular,Consolas,monospace;--dshNextTabsRadius:5px}
.dshNextTabs{--dshNextTabsH:28px;display:flex;align-items:center;gap:2px;min-width:0;box-sizing:border-box;font-size:12.5px;line-height:1;color:var(--dsw-alias-label-secondary);-webkit-app-region:no-drag;user-select:none}
.dshNextTabs *{box-sizing:border-box}
/* Title bar: between the desktop menu and the native caption buttons. Blank stretches keep dragging the window. */
.dshNextTabs[data-seat=titlebar]{--dshNextTabsH:clamp(20px,calc(var(--dsh-windows-titlebar-height,40px) - 10px),28px);position:fixed;top:0;height:var(--dsh-windows-titlebar-height,40px);
  left:max(var(--dshNextTabsMenuEnd,180px),calc(var(--dsh-windows-sidebar-width,0px) + 12px));
  right:calc(100vw - env(titlebar-area-x,0px) - env(titlebar-area-width,calc(100vw - 144px)) + 10px);
  pointer-events:none;-webkit-app-region:drag;z-index:5}
.dshNextTabs[data-seat=titlebar] > *{pointer-events:auto;-webkit-app-region:no-drag}
/* Below the conversation header: a full-width row under the title, sized by its own height preference. */
.dshNextTabs[data-seat=header]{--dshNextTabsH:clamp(22px,calc(var(--dshNextTabsBar,38px) - 10px),34px);width:auto;margin:8px -28px 0 -20px;padding:0 20px 0 14px;height:var(--dshNextTabsBar,38px);border-top:.5px solid var(--dsw-alias-border-l3,transparent);position:relative}
[data-conversation-header-leading]:has(.dshNextTabs[data-seat=header]){grid-area:30/1/31/-1 !important;display:block !important;min-width:0}
header:has(> [data-conversation-header-leading] .dshNextTabs[data-seat=header]){padding-bottom:0 !important}
.dshNextTabsScroll{position:relative;flex:0 1 auto;min-width:0;height:100%;display:flex;align-items:center;overflow-x:auto;overflow-y:hidden;scrollbar-width:none;overscroll-behavior-x:contain}
.dshNextTabsScroll::-webkit-scrollbar{display:none}
.dshNextTabsScroll[data-fade~=l]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 22px);mask-image:linear-gradient(90deg,transparent,#000 22px)}
.dshNextTabsScroll[data-fade~=r]{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(90deg,#000 calc(100% - 22px),transparent)}
.dshNextTabsScroll[data-fade~=l][data-fade~=r]{-webkit-mask-image:linear-gradient(90deg,transparent,#000 22px,#000 calc(100% - 22px),transparent);mask-image:linear-gradient(90deg,transparent,#000 22px,#000 calc(100% - 22px),transparent)}
.dshNextTabsList{position:relative;display:flex;align-items:center;gap:2px;height:100%;padding:0 2px}
.dshNextTab{position:relative;flex:0 0 auto;display:flex;align-items:center;gap:7px;height:var(--dshNextTabsH);min-width:92px;max-width:208px;padding:0 6px 0 9px;border-radius:var(--dshNextTabsRadius);cursor:default;color:var(--dsw-alias-label-tertiary);outline:none;
  transition:background-color .14s ease,color .14s ease,box-shadow .14s ease,opacity .14s ease}
/* Shrink mode: every tab starts from the same width and gives up space equally; scrolling is the last resort. */
.dshNextTabs[data-overflow=shrink] .dshNextTabsList{min-width:0;flex:1 1 auto}
.dshNextTabs[data-overflow=shrink] .dshNextTab{flex:0 1 208px;min-width:34px;container:dshNextTab/inline-size}
@container dshNextTab (max-width:96px){.dshNextTabKey{display:none}}
@container dshNextTab (max-width:64px){.dshNextTabLabel{display:none}.dshNextTabUnpin{display:none}.dshNextTabSignal{margin-left:auto}.dshNextTabX{margin-right:auto}}
@container dshNextTab (max-width:48px){.dshNextTabX{display:none}}
.dshNextTab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}
.dshNextTab[aria-selected=true]{background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base));color:var(--dsw-alias-label-primary);box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,rgba(127,127,127,.28)),0 1px 2px color-mix(in srgb,var(--dsw-alias-label-primary) 8%,transparent)}
.dshNextTab:focus-visible{box-shadow:0 0 0 1.5px var(--dshNextTabsAccent)}
.dshNextTab[data-state=cold] .dshNextTabLabel{opacity:.72}
.dshNextTab[data-state=awaiting]:not([aria-selected=true]) .dshNextTabLabel{color:var(--dsw-alias-state-warn-label,var(--dshNextTabsWarn))}
.dshNextTab[data-dragging]{opacity:.38}
.dshNextTab[data-drop=before]::before,.dshNextTab[data-drop=after]::after{content:"";position:absolute;top:4px;bottom:4px;width:2px;border-radius:1px;background:var(--dshNextTabsAccent)}
.dshNextTab[data-drop=before]::before{left:-2px}.dshNextTab[data-drop=after]::after{right:-2px}
.dshNextTabsDivider{flex:none;width:1px;height:calc(var(--dshNextTabsH) - 12px);margin:0 4px;background:var(--dsw-alias-border-l2,rgba(127,127,127,.3))}
.dshNextTabLabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:.005em}
.dshNextTabX{flex:none;display:grid;place-items:center;width:18px;height:18px;margin-right:-1px;border:0;border-radius:4px;background:transparent;color:inherit;opacity:0;cursor:pointer;padding:0;transition:opacity .12s ease,background-color .12s ease}
.dshNextTab:hover .dshNextTabX,.dshNextTab[aria-selected=true] .dshNextTabX,.dshNextTab:focus-within .dshNextTabX{opacity:.62}
.dshNextTab[data-pinned] .dshNextTabUnpin{opacity:.5;margin-right:-4px}
.dshNextTabX:hover{opacity:1 !important;background:var(--dsw-alias-interactive-bg-hover)}
.dshNextTabInput{flex:1 1 auto;min-width:0;height:20px;margin:0 -3px;padding:0 3px;border:0;border-radius:3px;outline:1.5px solid var(--dshNextTabsAccent);background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;user-select:text}
.dshNextTabKey{flex:0 0 auto;min-width:13px;height:14px;padding:0 3px;display:grid;place-items:center;border-radius:3px;font:600 9.5px/1 var(--dshNextTabsMono);font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary);background:color-mix(in srgb,var(--dsw-alias-label-primary) 7%,transparent);box-shadow:inset 0 0 0 .5px color-mix(in srgb,var(--dsw-alias-label-primary) 14%,transparent);opacity:0;transition:opacity .14s ease}
.dshNextTabs:hover .dshNextTabKey,.dshNextTabs:has(.dshNextTab:focus-visible) .dshNextTabKey{opacity:.7}
.dshNextTabs:hover .dshNextTab:hover .dshNextTabKey,.dshNextTabs:hover .dshNextTab[aria-selected=true] .dshNextTabKey,.dshNextTab:focus-visible .dshNextTabKey{opacity:1}
.dshNextTabLine{position:absolute;left:10px;right:10px;bottom:-1px;height:2px;border-radius:2px 2px 0 0;background:var(--dshNextTabsAccent);pointer-events:none;transform-origin:center;animation:dshNextTabsLineIn .22s cubic-bezier(.3,.7,.2,1)}
.dshNextTabs[data-seat=header] .dshNextTabLine{bottom:calc((var(--dshNextTabsH) - var(--dshNextTabsBar,38px)) / 2)}
@keyframes dshNextTabsLineIn{from{transform:scaleX(.3);opacity:0}}
/* The dot: three slots each state arranges differently, so the shape alone tells the state. */
.dshNextTabSignal{position:relative;flex:none;width:12px;height:12px;display:flex;align-items:center;justify-content:center;gap:1.5px}
.dshNextTabSignal > i{display:block;flex:none;font-style:normal}
.dshNextTabSignal > i + i{display:none}
.dshNextTabSignal > i:first-child{width:6px;height:6px;border-radius:50%;box-shadow:inset 0 0 0 1.25px var(--dshNextTabsIdle);opacity:.7}
.dshNextTab[aria-selected=true] .dshNextTabSignal[data-state=idle] > i{box-shadow:inset 0 0 0 1.25px var(--dsw-alias-label-secondary);opacity:1}
.dshNextTabSignal[data-state=cold] > i:first-child{width:4px;height:4px;box-shadow:none;background:var(--dshNextTabsIdle);opacity:.38}
.dshNextTabSignal[data-state=running] > i{display:block;width:2px;height:9px;border-radius:1px;box-shadow:none;background:var(--dshNextTabsAccent);opacity:1;transform-origin:50% 50%;animation:dshNextTabsMeter .95s ease-in-out infinite}
.dshNextTabSignal[data-state=running] > i:nth-child(1){animation-delay:-.62s}
.dshNextTabSignal[data-state=running] > i:nth-child(2){animation-delay:-.31s}
.dshNextTabSignal[data-state=connecting] > i{display:block;width:2.5px;height:2.5px;border-radius:50%;box-shadow:none;background:var(--dsw-alias-label-secondary);opacity:.3;animation:dshNextTabsWave 1.1s ease-in-out infinite}
.dshNextTabSignal[data-state=connecting] > i:nth-child(2){animation-delay:.15s}
.dshNextTabSignal[data-state=connecting] > i:nth-child(3){animation-delay:.3s}
.dshNextTabSignal[data-state=unread] > i:first-child{width:7px;height:7px;box-shadow:0 0 0 2px color-mix(in srgb,var(--dshNextTabsAccent) 22%,transparent);background:var(--dshNextTabsAccent);opacity:1;animation:dshNextTabsLand .4s cubic-bezier(.3,1.6,.5,1) both}
.dshNextTabSignal[data-state=awaiting] > i:first-child{position:relative;z-index:1;width:7px;height:7px;box-shadow:none;background:var(--dshNextTabsWarn);opacity:1}
.dshNextTabSignal[data-state=awaiting]::after{content:"";position:absolute;left:50%;top:50%;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:color-mix(in srgb,var(--dshNextTabsWarn) 45%,transparent);animation:dshNextTabsBreathe 1.6s ease-in-out infinite}
@keyframes dshNextTabsMeter{0%,100%{transform:scaleY(.34)}50%{transform:scaleY(1)}}
@keyframes dshNextTabsWave{0%,60%,100%{opacity:.3;transform:translateY(0)}30%{opacity:1;transform:translateY(-1.5px)}}
@keyframes dshNextTabsBreathe{0%,100%{transform:scale(.55);opacity:.9}50%{transform:scale(1);opacity:.15}}
@keyframes dshNextTabsLand{0%{transform:scale(0)}100%{transform:scale(1)}}
.dshNextTabsTools{flex:none;display:flex;align-items:center;gap:1px;height:100%}
.dshNextTabsTools[data-end]{margin-left:auto;padding-left:8px}
.dshNextTabsButton{display:grid;place-items:center;width:26px;height:min(26px,var(--dshNextTabsH));padding:0;border:0;border-radius:var(--dshNextTabsRadius);background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;transition:background-color .12s,color .12s}
.dshNextTabsButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.dshNextTabsButton:active:not(:disabled){background:var(--dsw-alias-interactive-bg-active)}
.dshNextTabsButton:focus-visible{outline:1.5px solid var(--dshNextTabsAccent);outline-offset:-1px}
.dshNextTabsButton:disabled{opacity:.35;cursor:default}
.dshNextTabsEmpty{padding:0 8px;color:var(--dsw-alias-label-caption);font-size:12px}
.dshNextTabsGrip{position:absolute !important;left:0;right:0;bottom:-2px;height:5px;cursor:ns-resize;touch-action:none;z-index:1}
.dshNextTabsGrip::after{content:"";position:absolute;left:50%;bottom:2px;width:36px;height:2px;margin-left:-18px;border-radius:1px;background:var(--dsw-alias-border-l1,rgba(127,127,127,.5));opacity:0;transition:opacity .15s}
.dshNextTabsGrip:hover::after,.dshNextTabsGrip[data-active]::after{opacity:1}
.dshNextTabsMenu{position:fixed;z-index:2147483000;min-width:216px;max-width:320px;max-height:min(70vh,480px);overflow:auto;padding:4px;border-radius:8px;background:var(--dsw-alias-bg-overlay,var(--dsw-alias-bg-layer-2));color:var(--dsw-alias-label-primary);box-sizing:border-box;
  box-shadow:0 0 0 .5px var(--dsw-alias-border-l2,rgba(127,127,127,.3)),0 12px 32px -8px color-mix(in srgb,#000 32%,transparent);font-size:12.5px;line-height:1;-webkit-app-region:no-drag;pointer-events:auto;animation:dshNextTabsPop .12s ease-out;transform-origin:var(--dshNextTabsOrigin,top left);user-select:none}
.dshNextTabsMenu *{box-sizing:border-box}
@keyframes dshNextTabsPop{from{opacity:0;transform:scale(.97)}}
.dshNextTabsMenuItem{display:flex;align-items:center;gap:9px;width:100%;min-height:28px;padding:0 9px;border:0;border-radius:4px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;outline:none}
.dshNextTabsMenuItem:hover:not(:disabled),.dshNextTabsMenuItem:focus-visible{background:var(--dsw-alias-interactive-bg-hover)}
.dshNextTabsMenuItem:disabled{color:var(--dsw-alias-label-caption);cursor:default}
.dshNextTabsMenuLabel{flex:1 1 auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshNextTabsMenuHint{flex:none;font:500 10.5px/1 var(--dshNextTabsMono);color:var(--dsw-alias-label-caption)}
.dshNextTabsMenuCheck{flex:none;width:12px;display:grid;place-items:center;color:var(--dshNextTabsAccent)}
.dshNextTabsMenuHead{padding:7px 9px 4px;font-size:11px;color:var(--dsw-alias-label-caption);letter-spacing:.02em}
.dshNextTabsMenuSeparator{height:1px;margin:4px 6px;background:var(--dsw-alias-border-l3,rgba(127,127,127,.2))}
@media (prefers-reduced-motion:reduce){.dshNextTabs *,.dshNextTabs *::before,.dshNextTabs *::after,.dshNextTabsMenu{animation:none !important;transition:none !important}}
`

export function installSessionTabsStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-desktop-next/session-tabs'
  style.textContent = STYLES
  document.head.append(style)
  return () => style.remove()
}
