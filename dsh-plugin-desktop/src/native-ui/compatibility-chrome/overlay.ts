import type { CompatibilityChromeCommand } from '../../compatibility-chrome-contract.ts'

const POPUPS = '.dshShadcnHoverCardPositioner, .dshDesktopActionMenu, .dshDesktopNativeActionError'
const SURFACES = '.dshDesktopFrameTitlebar, ' + POPUPS

export function installChromeOverlay(
  invoke: (command: CompatibilityChromeCommand) => Promise<void>,
  dismiss: () => void,
  failed: () => void,
): () => void {
  let expanded = false
  const update = (): void => {
    const next = document.querySelector(POPUPS) !== null
    if (next === expanded) return
    expanded = next
    void invoke(next ? 'expand' : 'collapse').catch(failed)
  }
  const outside = (event: MouseEvent): void => {
    if (event.target instanceof Element && event.target.closest(SURFACES) === null) dismiss()
  }
  const escape = (event: KeyboardEvent): void => {
    if (event.key === 'Escape') dismiss()
  }
  const observer = new MutationObserver(update)
  observer.observe(document.body, { childList: true, subtree: true })
  document.addEventListener('mousedown', outside)
  document.addEventListener('keydown', escape)
  update()
  return () => {
    observer.disconnect()
    document.removeEventListener('mousedown', outside)
    document.removeEventListener('keydown', escape)
    if (expanded) void invoke('collapse').catch(failed)
  }
}
