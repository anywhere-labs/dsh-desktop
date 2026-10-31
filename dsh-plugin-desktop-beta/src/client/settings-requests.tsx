/** Native settings actions reuse the official sidebar trigger and permission dialog. */
import { useEffect, useState } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { DesktopPermissionsDialog } from './permissions.tsx'

export function SettingsRequests({ t }: PropsLocale<'desktop-next'>) {
  const [permissionsOpen, setPermissionsOpen] = useState(false)
  useEffect(() => {
    let observer: MutationObserver | undefined
    const dispose = window.desktopNext?.onOpenSettings?.(page => {
      observer?.disconnect()
      if (page === 'permissions') {
        if (!document.querySelector('.dshNextPermissionsDialog')) setPermissionsOpen(true)
        return
      }
      setPermissionsOpen(false)
      // Target the official slot identity, independent of locale or sidebar width.
      let menuOpened = false
      const open = (): void => {
        if (menuOpened) {
          // The launcher's menu lists Settings first, so the entry is positional, not textual.
          const entry = document.querySelector<HTMLButtonElement>('[role="menu"] button[role="menuitem"]')
          if (!entry) return
          observer?.disconnect()
          entry.click()
          return
        }
        const trigger = document.querySelector('[data-slot="settings.trigger"]')?.closest('button')
        if (trigger) {
          observer?.disconnect()
          trigger.click()
          return
        }
        // dsh 0.1.7 added `settings.launcher`, which lets a plugin take over the footer seat
        // and suppress the `settings.trigger` fallback button. The account plugin does exactly
        // that, so reach Settings through the launcher's own menu when the button is absent.
        const launcher = document.querySelector<HTMLButtonElement>('[data-slot="settings.launcher"] button')
        if (!launcher) return
        menuOpened = true
        launcher.click()
      }
      observer = new MutationObserver(open)
      observer.observe(document.body, { childList: true, subtree: true })
      open()
    })
    return () => { observer?.disconnect(); dispose?.() }
  }, [])
  return <DesktopPermissionsDialog open={permissionsOpen} onClose={() => { setPermissionsOpen(false) }}
    service={window.desktopNext?.permissions} language={t('language')} />
}
