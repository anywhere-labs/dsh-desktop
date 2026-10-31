/** One official-component dialog for every native permission entry point. */
import { useEffect, useRef, useState } from 'react'
import { Button, IconSettingsOutlineRegular, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopPermission, DesktopPermissionSnapshot, DesktopPermissions } from '../permissions.ts'

export function DesktopPermissionsSection({ service, language }: { service: DesktopPermissions; language: string }) {
  const zh = language.startsWith('zh')
  return <section className="dshDesktopSettingsGroup" aria-label={zh ? '系统权限' : 'System permissions'}>
    <div className="dshDesktopSettingsUpdateRow">
      <div className="dshDesktopSettingsUpdateSummary">
        <h3>{zh ? '系统权限' : 'System permissions'}</h3>
      </div>
      <DesktopPermissionsButton service={service} language={language} className="dshDesktopSettingsButton" />
    </div>
  </section>
}

export function DesktopPermissionsButton({ service, language, iconOnly = false, disabled = false, label: customLabel, permission, className }: { service?: DesktopPermissions | undefined; language: string; iconOnly?: boolean; disabled?: boolean; label?: string; permission?: DesktopPermission | undefined; className?: string }) {
  const [open, setOpen] = useState(false)
  const zh = language.startsWith('zh')
  const label = customLabel ?? (zh ? '授权设置' : 'Permissions')
  return <>
    <Button variant={iconOnly ? 'ghost' : 'outline'} size="sm" aria-label={label} disabled={disabled}
      className={iconOnly ? 'dshNextSettingsGear' : className} icon={iconOnly ? <IconSettingsOutlineRegular /> : undefined}
      onClick={() => { setOpen(true) }}>{iconOnly ? null : label}</Button>
    <DesktopPermissionsDialog open={open} onClose={() => { setOpen(false) }} service={service} language={language} permission={permission} />
  </>
}

export function DesktopPermissionsDialog({ open, onClose, service, language, permission }: { open: boolean; onClose(): void; service?: DesktopPermissions | undefined; language: string; permission?: DesktopPermission | undefined }) {
  const zh = language.startsWith('zh')
  const body = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const dialog = open ? body.current?.closest<HTMLElement>('[role="dialog"]') : null
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const buttons = () => [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    const trapTab = (event: KeyboardEvent): void => {
      if (event.key !== 'Tab') return
      const targets = buttons()
      const first = targets[0], last = targets.at(-1)
      if (!targets.includes(document.activeElement as HTMLButtonElement) || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last) {
        event.preventDefault(); (event.shiftKey ? last : first)?.focus()
      }
    }
    buttons()[0]?.focus()
    document.addEventListener('keydown', trapTab)
    return () => { document.removeEventListener('keydown', trapTab); previous?.focus({ preventScroll: true }) }
  }, [open])
  return <Modal open={open} onClose={onClose} title={permission === 'microphone' ? (zh ? '麦克风权限' : 'Microphone permission') : (zh ? '系统权限' : 'System permissions')}
      closeLabel={zh ? '关闭' : 'Close'} className="dshNextPermissionsDialog"
      description={zh ? '按需授权。更改系统权限后，可能需要重启应用。' : 'Grant access when needed. You may need to restart the app after changing system permissions.'}>
      <div ref={body}>{open && (service ? <PermissionDetails service={service} language={language} permission={permission} />
        : <p role="status">{zh ? '请在运行 DSH 的桌面应用中管理系统权限。' : 'Manage system permissions in the desktop app running DSH.'}</p>)}
      </div>
    </Modal>
}

export function PermissionDetails({ service, language, permission: onlyPermission }: { service: DesktopPermissions; language: string; permission?: DesktopPermission | undefined }) {
  const t = (zh: string, en: string): string => language.startsWith('zh') ? zh : en
  const [snapshots, setSnapshots] = useState<DesktopPermissionSnapshot[]>([])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const pending = useRef(false)
  const revision = useRef(0)
  useEffect(() => {
    let disposed = false
    const refresh = (): void => {
      if (pending.current) return
      const current = ++revision.current
      const permissions: DesktopPermission[] = onlyPermission ? [onlyPermission] : ['microphone', 'screen', 'accessibility']
      void Promise.all(permissions.map(permission => service.query(permission))).then(values => {
        if (!disposed && current === revision.current) { setSnapshots(values); setFailure('') }
      }).catch(error => { if (!disposed && current === revision.current) setFailure(String(error)) })
    }
    refresh()
    window.addEventListener('focus', refresh)
    return () => { disposed = true; window.removeEventListener('focus', refresh) }
  }, [service, onlyPermission])
  const perform = async (permission: DesktopPermission, action: 'request' | 'openSettings'): Promise<void> => {
    if (pending.current) return
    pending.current = true
    revision.current++
    setBusy(true); setFailure('')
    try {
      await service[action](permission)
      const snapshot = await service.query(permission)
      setSnapshots(values => values.map(value => value.permission === permission ? snapshot : value))
    } catch (error) { setFailure(error instanceof Error ? error.message : String(error)) } finally { pending.current = false; setBusy(false) }
  }
  // macOS cannot tell a screen or Accessibility grant that was never given from a refused one.
  const labels = (permission: DesktopPermission) => ({
    granted: t('已允许', 'Allowed'), denied: permission === 'microphone' ? t('已拒绝', 'Denied') : t('未授权', 'Not granted'),
    restricted: t('受系统限制', 'Restricted'), 'not-determined': t('尚未授权', 'Not requested'), unknown: t('由系统管理', 'Managed by the system'),
  })
  // Steps the system does not explain: macOS reopens the app once screen recording is enabled, and an Accessibility
  // entry it still shows enabled belongs to an earlier build's signature.
  const guidance = {
    screen: t('开启后 macOS 会要求重新打开应用。', 'macOS asks to reopen the app after you turn this on.'),
    accessibility: t('若系统设置中已显示开启，请移除本应用后重新添加。', 'If System Settings already shows it on, remove the app from the list and add it again.'),
  }
  const descriptions = {
    screen: t('用于截图，让 AI 读取屏幕内容。', 'Take screenshots so AI can read what is on screen.'),
    accessibility: t('允许 Computer Use 操作鼠标和键盘。', 'Allow Computer Use to control the mouse and keyboard.'),
    microphone: t('允许需要录音的功能使用麦克风。', 'Allow features that record audio to use the microphone.'),
  }
  return <div className="dshNextPermissionList">
    {failure && <p role="alert" className="dshDesktopSettingsError">{failure}</p>}
    {(onlyPermission ? [onlyPermission] : ['screen', 'accessibility', 'microphone'] as const).map(permission => {
      const snapshot = snapshots.find(value => value.permission === permission)
      const label = { microphone: t('麦克风', 'Microphone'), screen: t('屏幕录制', 'Screen recording'), accessibility: t('辅助功能', 'Accessibility') }[permission]
      return <div key={permission} className="dshNextPermissionRow" role="group" aria-label={label}>
        <div className="dshNextPermissionCopy"><strong>{label}</strong><p className="dshDesktopSettingsHint">{descriptions[permission]}</p>
          <span className="dshNextPermissionStatus" role="status"><StateDot state={snapshot?.status === 'granted' ? 'done' : snapshot?.status === 'denied' || snapshot?.status === 'restricted' ? 'error' : 'idle'} />{snapshot ? labels(permission)[snapshot.status] : t('正在读取…', 'Loading…')}</span>
          {snapshot?.status === 'denied' && permission !== 'microphone' && <p className="dshDesktopSettingsHint">{guidance[permission]}</p>}</div>
        <div className="dshNextPluginActions">
          {snapshot?.canRequest && <Button variant="primary" size="sm" disabled={busy} onClick={() => { void perform(permission, 'request') }}>{t('请求授权', 'Request access')}</Button>}
          {snapshot?.canOpenSettings && <Button variant="outline" size="sm" disabled={busy} onClick={() => { void perform(permission, 'openSettings') }}>{t('打开系统设置', 'Open system settings')}</Button>}
        </div>
      </div>
    })}
  </div>
}
