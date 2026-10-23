/**
 * Sidebar footer layout owned by Desktop Next.
 *
 * Upstream renders `sidebar.footer.action` as a `display: contents` anchor
 * inside a `flex-wrap: nowrap` row container, so several full-width launchers
 * become flex siblings on one line and crush each other, whereas a hard
 * `flex-direction: column` override stacks compact icon-only actions one per
 * row in the middle of an expanded sidebar. Next uses a balanced multi-column
 * grid in the expanded sidebar by default — keeping full-width launchers on
 * their own `1 / -1` rows while distributing compact icon actions evenly across
 * balanced rows and aligned columns — and switches back to a single vertical
 * column when the sidebar collapses into its narrow rail or when the user
 * disables the horizontal layout compatibility toggle.
 */

const STYLE_ID = 'dsh-desktop-sidebar-footer-styles'
export const SIDEBAR_FOOTER_COMPAT_ATTRIBUTE = 'data-dsh-sidebar-footer-compat'
export const SIDEBAR_FOOTER_BALANCED_ATTRIBUTE = 'data-dsh-sidebar-footer-balanced'
const FOOTER_SLOT_SELECTOR = '[data-slot="sidebar.footer.action"]'
const FOOTER_ITEM_ATTRIBUTE = 'data-dsh-footer-item'
const GRID_COLUMNS_VAR = '--dsh-footer-grid-columns'
const COMPACT_COLUMN_GAP = 6
const MAX_COMPACT_ITEM_WIDTH = 96
const IGNORED_TEXT_TAGS = new Set(['SVG', 'STYLE', 'SCRIPT', 'NOSCRIPT', 'TEMPLATE'])

const CSS = `
body [data-slot="sidebar.footer.action"] {
  display: grid !important;
  box-sizing: border-box;
  grid-template-columns: var(--dsh-footer-grid-columns, repeat(4, minmax(0, 1fr)));
  align-items: center;
  column-gap: 6px;
  row-gap: 4px;
  min-width: 0;
  width: calc(100% + 8px);
  margin-inline: -4px;
  max-height: min(40vh, 240px);
  padding: 0 4px;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
}
html[data-dsh-sidebar-footer-balanced="off"]:not([data-dsh-sidebar-footer-compat="off"]) body [data-slot="sidebar.footer.action"] {
  display: flex !important;
  flex-direction: row;
  flex-wrap: wrap;
  justify-content: flex-start;
  column-gap: 4px;
}
body [class*="collapsed"] [data-slot="sidebar.footer.action"],
html[data-dsh-sidebar-footer-balanced="off"] body [class*="collapsed"] [data-slot="sidebar.footer.action"],
html[data-dsh-sidebar-footer-compat="off"] body [data-slot="sidebar.footer.action"] {
  display: grid !important;
  grid-template-columns: minmax(0, 1fr) !important;
  justify-items: center;
}
body [data-slot="sidebar.footer.action"] > * {
  grid-column: 1 / -1;
  justify-self: stretch;
  flex: 0 0 100%;
  min-width: 0;
  max-width: 100%;
}
body [data-slot="sidebar.footer.action"] > [data-dsh-footer-item="compact"] {
  grid-column: span 1;
  justify-self: center;
  flex: 0 0 auto;
  width: max-content !important;
  max-width: 100%;
  padding-inline: 0 !important;
  order: 1;
}
body [class*="collapsed"] [data-slot="sidebar.footer.action"] > *,
html[data-dsh-sidebar-footer-compat="off"] body [data-slot="sidebar.footer.action"] > [data-dsh-footer-item="compact"] {
  grid-column: 1 / -1;
  justify-self: center;
}
`

function hasVisibleLabelText(node: Node): boolean {
  if (node.nodeType === 3) {
    return (node.textContent ?? '').trim().length > 0
  }
  if (node.nodeType !== 1) return false
  const el = node as Element
  if (typeof el.tagName === 'string' && IGNORED_TEXT_TAGS.has(el.tagName.toUpperCase())) {
    return false
  }
  const children = el.childNodes
  if (!children) return false
  for (let i = 0; i < children.length; i += 1) {
    const child = children[i]
    if (child && hasVisibleLabelText(child)) return true
  }
  return false
}

/**
 * Compute a balanced column count for compact footer items so multi-row wraps
 * divide evenly (e.g. 6 items wrap as 3+3 instead of greedy 5+1).
 */
export function computeBalancedColumnCount(
  widths: readonly number[],
  containerWidth: number,
  columnGap = COMPACT_COLUMN_GAP,
): number {
  const count = widths.length
  if (count === 0) return 1
  const available = Math.max(containerWidth, 1)

  const fitsColumns = (cols: number): boolean => {
    let total = (cols - 1) * columnGap
    for (let c = 0; c < cols; c += 1) {
      let colMax = 0
      for (let i = c; i < count; i += cols) {
        const w = widths[i] ?? 0
        if (w > colMax) colMax = w
      }
      total += colMax
    }
    return total <= available
  }

  let maxCols = 1
  for (let cols = count; cols >= 1; cols -= 1) {
    if (fitsColumns(cols)) {
      maxCols = cols
      break
    }
  }

  const minRows = Math.ceil(count / maxCols)
  if (minRows === 1) {
    if (count < 3) {
      const maxItemWidth = Math.max(...widths, 28)
      return Math.max(
        count,
        Math.min(4, Math.floor((available + columnGap) / (maxItemWidth + columnGap))),
      )
    }
    return count
  }

  const idealCols = Math.ceil(count / minRows)
  for (let cols = idealCols; cols <= maxCols; cols += 1) {
    if (fitsColumns(cols)) return cols
  }
  return maxCols
}

/** Build the CSS `grid-template-columns` value for balanced compact footer items. */
export function computeBalancedGridTemplate(
  widths: readonly number[],
  containerWidth: number,
  columnGap = COMPACT_COLUMN_GAP,
): string {
  const cols = computeBalancedColumnCount(widths, containerWidth, columnGap)
  if (cols <= 1 || widths.length === 0) {
    return 'minmax(0, 1fr)'
  }
  const available = Math.max(containerWidth, 1)
  const equalColWidth = (available - (cols - 1) * columnGap) / cols
  const colMaxes: number[] = []
  for (let c = 0; c < cols; c += 1) {
    let colMax = 28
    for (let i = c; i < widths.length; i += cols) {
      const w = widths[i] ?? 0
      if (w > colMax) colMax = w
    }
    colMaxes.push(colMax)
  }
  const widestCol = Math.max(...colMaxes)
  if (widestCol <= equalColWidth) {
    return `repeat(${cols}, minmax(0, 1fr))`
  }
  return colMaxes.map(w => `minmax(0, ${Math.max(w, 1)}fr)`).join(' ')
}

function setAttrIfChanged(el: Element, name: string, value: string): void {
  if (el.getAttribute?.(name) !== value) {
    el.setAttribute?.(name, value)
  }
}

/**
 * Measure and balance direct children of a `sidebar.footer.action` slot element.
 *
 * Uses strict write -> read -> write batching so setting attributes never
 * interleaves with `getBoundingClientRect()` / `scrollWidth` reads (avoiding
 * synchronous layout thrashing).
 */
export function balanceSidebarFooterSlot(slot: HTMLElement, knownSlotWidth?: number): void {
  const children = slot.children ? Array.from(slot.children) : []
  if (children.length === 0) return

  // Pass 1 (Write): classify by text content and apply initial item attributes.
  const compactCandidates: Element[] = []
  for (const child of children) {
    if (hasVisibleLabelText(child)) {
      setAttrIfChanged(child, FOOTER_ITEM_ATTRIBUTE, 'full')
    } else {
      setAttrIfChanged(child, FOOTER_ITEM_ATTRIBUTE, 'compact')
      compactCandidates.push(child)
    }
  }

  // Pass 2 (Read): batch all geometry reads in one layout pass.
  const rawWidth = knownSlotWidth
    || slot.clientWidth
    || (typeof slot.getBoundingClientRect === 'function' ? Math.floor(slot.getBoundingClientRect().width) : 0)
    || 216
  const containerWidth = Math.max(rawWidth - 8, 120)
  const compactWidths: number[] = []
  const oversizedChildren: Element[] = []

  for (const child of compactCandidates) {
    const rectW = typeof child.getBoundingClientRect === 'function'
      ? Math.ceil(child.getBoundingClientRect().width)
      : 0
    const naturalWidth = Math.max(rectW, (child as HTMLElement).scrollWidth ?? 0, 28)
    if (naturalWidth > MAX_COMPACT_ITEM_WIDTH || naturalWidth > containerWidth * 0.55) {
      oversizedChildren.push(child)
    } else {
      compactWidths.push(naturalWidth)
    }
  }

  // Pass 3 (Write): promote oversized items and commit the grid template variable.
  for (const child of oversizedChildren) {
    setAttrIfChanged(child, FOOTER_ITEM_ATTRIBUTE, 'full')
  }

  const template = computeBalancedGridTemplate(compactWidths, containerWidth, COMPACT_COLUMN_GAP)
  if (slot.style?.getPropertyValue?.(GRID_COLUMNS_VAR) !== template) {
    slot.style?.setProperty?.(GRID_COLUMNS_VAR, template)
  }
}

function syncAllSidebarFooterSlots(): void {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return
  const slots = document.querySelectorAll<HTMLElement>(FOOTER_SLOT_SELECTOR)
  for (const slot of slots) {
    balanceSidebarFooterSlot(slot)
  }
}

/** Toggle the expanded sidebar footer row layout compatibility mode. */
export function setSidebarFooterCompat(enabled: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  if (enabled) {
    if (typeof root.removeAttribute === 'function') {
      root.removeAttribute(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE)
    } else if (root.dataset) {
      delete root.dataset.dshSidebarFooterCompat
    }
  } else if (typeof root.setAttribute === 'function') {
    root.setAttribute(SIDEBAR_FOOTER_COMPAT_ATTRIBUTE, 'off')
  } else if (root.dataset) {
    root.dataset.dshSidebarFooterCompat = 'off'
  }
  syncAllSidebarFooterSlots()
}

/** Toggle the balanced multi-column grid distribution for compact footer items. */
export function setSidebarFooterBalanced(enabled: boolean): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!root) return
  if (enabled) {
    if (typeof root.removeAttribute === 'function') {
      root.removeAttribute(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE)
    } else if (root.dataset) {
      delete root.dataset.dshSidebarFooterBalanced
    }
  } else if (typeof root.setAttribute === 'function') {
    root.setAttribute(SIDEBAR_FOOTER_BALANCED_ATTRIBUTE, 'off')
  } else if (root.dataset) {
    root.dataset.dshSidebarFooterBalanced = 'off'
  }
  syncAllSidebarFooterSlots()
}

/** Install the footer layout sheet and balanced-grid observer; tolerate headless Client boot. */
export function installSidebarFooterStyles(): () => void {
  if (typeof document === 'undefined') return () => {}
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style) {
    style.textContent = CSS
  } else {
    style = document.createElement('style')
    style.id = STYLE_ID
    style.dataset.plugin = 'dsh-plugin-desktop-beta'
    style.textContent = CSS
    document.head.appendChild(style)
  }

  const observedResizeSlots = new WeakSet<Element>()
  const observedMutationTargets = new WeakSet<Element>()
  const resizeObserver = typeof ResizeObserver !== 'undefined'
    ? new ResizeObserver(entries => {
        for (const entry of entries) {
          if (entry.target instanceof HTMLElement) {
            balanceSidebarFooterSlot(entry.target, Math.floor(entry.contentRect?.width ?? 0))
          }
        }
      })
    : null

  let scheduled = false
  let bootstrapObserver: MutationObserver | null = null
  let bootstrapActive = false

  const scheduleRefresh = (): void => {
    if (scheduled) return
    scheduled = true
    queueMicrotask(() => {
      scheduled = false
      refresh()
    })
  }

  // Scoped observer that watches only the footer slot (and its direct parent)
  // rather than the entire document subtree, so chat streaming causes zero work.
  const slotMutationObserver = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(() => {
        scheduleRefresh()
      })
    : null

  const refresh = (): void => {
    if (typeof document.querySelectorAll !== 'function') return
    const slots = document.querySelectorAll<HTMLElement>(FOOTER_SLOT_SELECTOR)
    if (slots.length === 0) {
      if (bootstrapObserver && !bootstrapActive && document.body) {
        bootstrapActive = true
        bootstrapObserver.observe(document.body, { childList: true, subtree: true })
      }
      return
    }
    if (bootstrapObserver && bootstrapActive) {
      bootstrapObserver.disconnect()
      bootstrapActive = false
    }
    for (const slot of slots) {
      if (resizeObserver && !observedResizeSlots.has(slot)) {
        observedResizeSlots.add(slot)
        resizeObserver.observe(slot)
      }
      if (slotMutationObserver && !observedMutationTargets.has(slot)) {
        observedMutationTargets.add(slot)
        slotMutationObserver.observe(slot, { childList: true, subtree: true })
        if (slot.parentElement && !observedMutationTargets.has(slot.parentElement)) {
          observedMutationTargets.add(slot.parentElement)
          slotMutationObserver.observe(slot.parentElement, { childList: true })
        }
      }
      balanceSidebarFooterSlot(slot)
    }
  }

  bootstrapObserver = typeof MutationObserver !== 'undefined'
    ? new MutationObserver(mutations => {
        for (const mutation of mutations) {
          for (let i = 0; i < mutation.addedNodes.length; i += 1) {
            const node = mutation.addedNodes[i]
            if (
              node instanceof Element
              && (node.matches?.(FOOTER_SLOT_SELECTOR) || node.querySelector?.(FOOTER_SLOT_SELECTOR) !== null)
            ) {
              scheduleRefresh()
              return
            }
          }
        }
      })
    : null

  refresh()

  return () => {
    bootstrapObserver?.disconnect()
    slotMutationObserver?.disconnect()
    resizeObserver?.disconnect()
    style?.remove()
    setSidebarFooterCompat(true)
    setSidebarFooterBalanced(true)
  }
}
