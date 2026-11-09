/** Desktop-only presentation control for the official sidebar's global panel entries. */
const ROOT_SELECTOR = '[data-slot="sidebar"] > [class*="root"]'
const NAV_SELECTOR = 'nav[class*="panelList"]'
const ATTRIBUTE = 'data-dsh-next-global-panels-folded'
const BUTTON_CLASS = 'dshNextGlobalPanelsToggle'
const STORAGE_KEY = 'dsh-desktop-next:global-panels-folded'
const NAV_ID = 'dsh-next-global-panels'

const CSS = `
${ROOT_SELECTOR} > .${BUTTON_CLASS} {
  box-sizing: border-box; display: flex; flex: none; align-items: center;
  justify-content: space-between; min-height: 30px; margin: 0 4px 4px;
  padding: 4px 12px; border: 0; border-radius: 8px; background: transparent;
  color: var(--dsw-alias-label-secondary); font: inherit; font-size: 12px;
  text-align: left; cursor: pointer; -webkit-app-region: no-drag;
}
${ROOT_SELECTOR} > .${BUTTON_CLASS}:hover { background: var(--dsw-alias-interactive-bg-hover); }
${ROOT_SELECTOR} > .${BUTTON_CLASS}:focus-visible {
  outline: 2px solid var(--dsw-focus-ring-color, var(--dsw-alias-state-business-primary));
  outline-offset: -2px;
}
.${BUTTON_CLASS}::after {
  content: ''; width: 7px; height: 7px; margin-right: 2px;
  border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: rotate(45deg) translateY(-2px);
}
.${BUTTON_CLASS}[aria-expanded="false"]::after { transform: rotate(-45deg); }
[data-slot="sidebar"] > [class*="collapsed"] > .${BUTTON_CLASS} { display: none; }
${ROOT_SELECTOR}:not([class*="collapsed"])[${ATTRIBUTE}="true"] > ${NAV_SELECTOR} {
  display: none !important;
}
`

let activeDispose: (() => void) | undefined

/** Install one control, following lazy sidebar mounts and renderer replacements. */
export function installGlobalPanelFold(): () => void {
  activeDispose?.()
  let folded = false
  try { folded = window.localStorage.getItem(STORAGE_KEY) === '1' } catch { /* Storage may be unavailable. */ }

  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-desktop-next/global-panel-fold'
  style.textContent = CSS
  document.head.append(style)
  const button = document.createElement('button')
  button.className = BUTTON_CLASS
  button.type = 'button'
  let root: Element | null = null
  let priorRootAttribute: string | null = null
  let nav: HTMLElement | null = null
  let ownedNavId: string | null = null
  let disposed = false

  const releaseNav = (): void => {
    if (ownedNavId && nav?.id === ownedNavId) nav.removeAttribute('id')
    nav = null
    ownedNavId = null
  }
  const releaseRoot = (): void => {
    if (root?.getAttribute(ATTRIBUTE) === String(folded)) {
      if (priorRootAttribute === null) root.removeAttribute(ATTRIBUTE)
      else root.setAttribute(ATTRIBUTE, priorRootAttribute)
    }
    root = null
    priorRootAttribute = null
  }
  const sync = (): void => {
    if (disposed) return
    const nextRoot = document.querySelector(ROOT_SELECTOR)
    const nextNav = Array.from(nextRoot?.children ?? []).find((child): child is HTMLElement =>
      child instanceof HTMLElement && child.matches(NAV_SELECTOR)) ?? null
    if (root !== nextRoot) {
      releaseRoot()
      root = nextRoot
      priorRootAttribute = root?.getAttribute(ATTRIBUTE) ?? null
    }
    if (nav !== nextNav) {
      releaseNav()
      nav = nextNav
      if (nav && !nav.id) {
        let candidate = NAV_ID
        for (let suffix = 2; document.getElementById(candidate); suffix += 1) candidate = `${NAV_ID}-${suffix}`
        nav.id = candidate
        ownedNavId = candidate
      }
    }
    // Read only the global navigation's accessible label, never its entries or chat content.
    const label = nav?.getAttribute('aria-label')?.trim()
    if (!root || !nav || !nav.id || !label) {
      button.remove()
      return
    }
    if (button.parentElement !== root || button.nextElementSibling !== nav) root.insertBefore(button, nav)
    if (button.textContent !== label) button.textContent = label
    button.setAttribute('aria-controls', nav.id)
    button.setAttribute('aria-expanded', String(!folded))
    if (root.getAttribute(ATTRIBUTE) !== String(folded)) root.setAttribute(ATTRIBUTE, String(folded))
  }
  const onClick = (): void => {
    folded = !folded
    button.setAttribute('aria-expanded', String(!folded))
    root?.setAttribute(ATTRIBUTE, String(folded))
    try { window.localStorage.setItem(STORAGE_KEY, folded ? '1' : '0') } catch { /* Retain in-memory state. */ }
  }
  button.addEventListener('click', onClick)

  // Observe lazy mounts/replacements without running sync for unrelated chat streaming.
  const observer = new MutationObserver(mutations => {
    if (mutations.some(mutation => {
      const target = mutation.target
      if (target === root || target instanceof Element && target.matches('[data-slot="sidebar"]')) return true
      return [...mutation.addedNodes, ...mutation.removedNodes].some(node =>
        node instanceof Element && (node.matches('[data-slot="sidebar"]') || node.querySelector('[data-slot="sidebar"]') !== null))
    })) sync()
  })
  if (document.body) observer.observe(document.body, { childList: true, subtree: true })
  sync()

  const dispose = (): void => {
    if (disposed) return
    disposed = true
    observer.disconnect()
    button.removeEventListener('click', onClick)
    button.remove()
    releaseNav()
    releaseRoot()
    style.remove()
    if (activeDispose === dispose) activeDispose = undefined
  }
  activeDispose = dispose
  return dispose
}
