/** Shared launcher-backed actions rendered in settings and extended title bars. */

import { Bug, ChevronDown, LifeBuoy, RefreshCw, RotateCw, SquareTerminal, Wrench } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'

export interface DesktopNativeActionsProps {
  readonly api: Pick<
    DesktopSettingsApi,
    'openTerminal' | 'restart' | 'restartToRecovery' | 'reloadRenderer' | 'toggleDeveloperTools'
  >
    & Partial<Pick<DesktopSettingsApi, 'exportDiagnostics'>>
  readonly t: (key: DesktopSettingsLocaleKey) => string
  readonly placement: 'settings' | 'titlebar'
}

interface DesktopRestartMenuItemsProps {
  readonly busy: boolean
  readonly t: DesktopNativeActionsProps['t']
  readonly onReload: () => void
  readonly onRestart: () => void
  readonly onRestartToRecovery: () => void
}

/** Shared restart-menu order for Settings and the independent Desktop title bar. */
export function DesktopRestartMenuItems({
  busy, t, onReload, onRestart, onRestartToRecovery,
}: DesktopRestartMenuItemsProps) {
  return (
    <>
      <button type="button" className="dshDesktopActionMenuItem" role="menuitem" disabled={busy} onClick={onReload}>
        <RefreshCw aria-hidden="true" /><span>{t('reloadRenderer')}</span>
      </button>
      <button type="button" className="dshDesktopActionMenuItem" role="menuitem" disabled={busy} onClick={onRestart}>
        <RotateCw aria-hidden="true" /><span>{t('restartDesktop')}</span>
      </button>
      <button type="button" className="dshDesktopActionMenuItem" role="menuitem" disabled={busy} onClick={onRestartToRecovery}>
        <LifeBuoy aria-hidden="true" /><span>{t('restartToRecovery')}</span>
      </button>
    </>
  )
}

/** Developer menu intentionally owns only the Developer Tools toggle. */
export function DesktopDeveloperMenuItems({
  busy, t, onToggleDeveloperTools,
}: {
  readonly busy: boolean
  readonly t: DesktopNativeActionsProps['t']
  readonly onToggleDeveloperTools: () => void
}) {
  return (
    <button
      type="button"
      className="dshDesktopActionMenuItem"
      role="menuitem"
      disabled={busy}
      onClick={onToggleDeveloperTools}
    >
      <Bug aria-hidden="true" />
      <span>{t('toggleDeveloperTools')}</span>
    </button>
  )
}

export function DesktopNativeActions({ api, t, placement }: DesktopNativeActionsProps) {
  const [exportingDiagnostics, setExportingDiagnostics] = useState(false)
  const [opening, setOpening] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const [rendererAction, setRendererAction] = useState<'reload' | 'devtools'>()
  const [restartMenuOpen, setRestartMenuOpen] = useState(false)
  const [developerMenuOpen, setDeveloperMenuOpen] = useState(false)
  const [failed, setFailed] = useState<'diagnostics' | 'terminal' | 'restart' | 'reload' | 'devtools'>()
  const developerMenuRef = useRef<HTMLDivElement>(null)
  const restartMenuRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!developerMenuOpen && !restartMenuOpen) return
    const dismiss = (event: MouseEvent): void => {
      if (!developerMenuRef.current?.contains(event.target as Node)) setDeveloperMenuOpen(false)
      if (!restartMenuRef.current?.contains(event.target as Node)) setRestartMenuOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setDeveloperMenuOpen(false)
        setRestartMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', dismiss)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', dismiss)
      document.removeEventListener('keydown', escape)
    }
  }, [developerMenuOpen, restartMenuOpen])

  const busy = exportingDiagnostics || opening || restarting || rendererAction !== undefined

  const exportDiagnostics = (): void => {
    if (busy || api.exportDiagnostics === undefined) return
    setExportingDiagnostics(true)
    setFailed(undefined)
    void api.exportDiagnostics()
      .catch(() => { setFailed('diagnostics') })
      .finally(() => { setExportingDiagnostics(false) })
  }

  const open = (): void => {
    if (busy) return
    setOpening(true)
    setFailed(undefined)
    void api.openTerminal()
      .catch(() => { setFailed('terminal') })
      .finally(() => { setOpening(false) })
  }

  const restart = (recovery = false): void => {
    if (busy) return
    setRestarting(true)
    setRestartMenuOpen(false)
    setFailed(undefined)
    const operation = recovery ? api.restartToRecovery : api.restart
    void operation()
      .catch(() => { setFailed('restart') })
      .finally(() => { setRestarting(false) })
  }

  const runRendererAction = (action: 'reload' | 'devtools'): void => {
    if (busy) return
    const operation = action === 'reload' ? api.reloadRenderer : api.toggleDeveloperTools
    setRendererAction(action)
    setDeveloperMenuOpen(false)
    setRestartMenuOpen(false)
    setFailed(undefined)
    void operation().catch(() => {
      setFailed(action)
    }).finally(() => {
      setRendererAction(undefined)
    })
  }

  const failureKey = failed === 'diagnostics'
    ? 'exportDiagnosticsError'
    : failed === 'terminal'
    ? 'openTerminalError'
    : failed === 'restart'
      ? 'restartDesktopError'
      : failed === 'reload'
        ? 'reloadRendererError'
        : 'toggleDeveloperToolsError'

  if (placement === 'settings') {
    return (
      <div className="dshDesktopNativeActions" data-placement={placement}>
        {failed !== undefined && (
          <span className="dshDesktopNativeActionError" role="alert">{t(failureKey)}</span>
        )}
        {api.exportDiagnostics !== undefined && (
          <button
            type="button"
            className="dshDesktopSettingsHeaderButton"
            disabled={busy}
            onClick={exportDiagnostics}
          >
            {t(exportingDiagnostics ? 'exportingDiagnostics' : 'exportDiagnostics')}
          </button>
        )}
        <button
          type="button"
          className="dshDesktopSettingsHeaderButton"
          disabled={busy}
          onClick={open}
        >
          {t(opening ? 'openingTerminal' : 'openTerminal')}
        </button>
        <div className="dshDesktopNativeActionMenuAnchor" ref={restartMenuRef}>
          <button
            type="button"
            className="dshDesktopSettingsHeaderButton"
            aria-expanded={restartMenuOpen}
            aria-haspopup="menu"
            disabled={busy}
            onClick={() => { setRestartMenuOpen(value => !value) }}
          >
            {t(restarting ? 'restartingDesktop' : 'restartDesktop')}
            <ChevronDown aria-hidden="true" />
          </button>
          {restartMenuOpen && (
            <div className="dshDesktopActionMenu" role="menu">
              <DesktopRestartMenuItems
                busy={busy}
                t={t}
                onReload={() => { runRendererAction('reload') }}
                onRestart={() => { restart() }}
                onRestartToRecovery={() => { restart(true) }}
              />
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="dshDesktopNativeActions" data-placement={placement}>
      {failed !== undefined && (
        <span className="dshDesktopNativeActionError" role="alert">{t(failureKey)}</span>
      )}
      <button
        type="button"
        className="dshDesktopTitlebarIconButton"
        aria-label={t('openTerminal')}
        title={t('openTerminal')}
        disabled={busy}
        onClick={open}
      >
        <SquareTerminal aria-hidden="true" />
      </button>
      <div className="dshDesktopNativeActionMenuAnchor" ref={restartMenuRef}>
        <button
          type="button"
          className="dshDesktopTitlebarIconButton"
          aria-label={t('restartOptions')}
          aria-expanded={restartMenuOpen}
          aria-haspopup="menu"
          title={t('restartOptions')}
          disabled={busy}
          onClick={() => {
            setDeveloperMenuOpen(false)
            setRestartMenuOpen(value => !value)
          }}
        >
          <RotateCw aria-hidden="true" />
        </button>
        {restartMenuOpen && (
          <div className="dshDesktopActionMenu" role="menu">
            <DesktopRestartMenuItems
              busy={busy}
              t={t}
              onReload={() => { runRendererAction('reload') }}
              onRestart={() => { restart() }}
              onRestartToRecovery={() => { restart(true) }}
            />
          </div>
        )}
      </div>
      <div className="dshDesktopNativeActionMenuAnchor" ref={developerMenuRef}>
        <button
          type="button"
          className="dshDesktopTitlebarIconButton"
          aria-label={t('developerOptions')}
          aria-expanded={developerMenuOpen}
          aria-haspopup="menu"
          title={t('developerOptions')}
          disabled={busy}
          onClick={() => {
            setRestartMenuOpen(false)
            setDeveloperMenuOpen(value => !value)
          }}
        >
          <Wrench aria-hidden="true" />
        </button>
        {developerMenuOpen && (
          <div className="dshDesktopActionMenu" role="menu">
            <DesktopDeveloperMenuItems
              busy={busy}
              t={t}
              onToggleDeveloperTools={() => { runRendererAction('devtools') }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
