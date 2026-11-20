/** Continue the official onboarding in the main window after Desktop setup: the account step and a pending restart. */
import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings-account/client'
import { Button, Toast } from '@deepseek-ai/dsh-client-ui-primitives'
import type { DesktopOnboardingBridge, DesktopOnboardingSnapshot } from '../../../dsh-plugin-desktop/src/setup-onboarding-bridge.ts'
import { ONBOARDING_STYLE_ATTRIBUTE } from './onboarding-style-scope.ts'

/**
 * The main window's part of the onboarding bridge. Desktop setup itself runs in the pre-Host shell
 * window, so this window never submits setup choices.
 */
type AccountContinuationBridge = Omit<DesktopOnboardingBridge, 'finish'>

function pendingSnapshot(value: DesktopOnboardingSnapshot | null): DesktopOnboardingSnapshot | null {
  return value?.accountPending || value?.restartPending ? value : null
}

/** Mounted onboarding style scopes; the last one to unmount clears the root mark. */
let styleScopes = 0

/** Marks the document root, activating the onboarding-only stylesheet while this element is mounted. */
export function OnboardingStyleScope(): null {
  useLayoutEffect(() => {
    const root = document.documentElement
    styleScopes += 1
    root.setAttribute(ONBOARDING_STYLE_ATTRIBUTE, '')
    return () => {
      styleScopes -= 1
      if (styleScopes === 0) root.removeAttribute(ONBOARDING_STYLE_ATTRIBUTE)
    }
  }, [])
  return null
}

export function registerDesktopOnboarding(ctx: Context): void {
  const bridge = (window as unknown as { dshDesktopSetup?: AccountContinuationBridge }).dshDesktopSetup
  if (!bridge) return
  ctx.slots.inject('onboarding.desktop.before', () => ctx.slots.register({
    name: 'onboarding.desktop.before', inject: () => ({ bridge, zh: ctx.locale.getLocale().active.startsWith('zh') }),
  }, DesktopOnboarding))
}

function DesktopOnboarding({ bridge, zh, renderSurface, renderLoading, renderNext, accountStatus, openLogin }: PropsRuntime<'onboarding.desktop.before'> & {
  bridge: AccountContinuationBridge; zh: boolean
}) {
  const [snapshot, setSnapshot] = useState<DesktopOnboardingSnapshot | null>()
  const [error, setError] = useState('')
  const [revision, refresh] = useState(0)
  const [busy, setBusy] = useState(false)
  // Desktop content and its loading state occupy the official surface with the onboarding-only
  // styles; the official flow returned by renderNext keeps the ordinary shell styles.
  const surface = (children: ReactNode) => <>{renderSurface(children)}<OnboardingStyleScope /></>
  const loading = () => <>{renderLoading()}<OnboardingStyleScope /></>
  useEffect(() => {
    let disposed = false
    void bridge.read().then(value => {
      if (disposed) return
      setError('')
      setSnapshot(pendingSnapshot(value))
    }).catch(cause => { if (!disposed) setError(String(cause)) })
    return () => { disposed = true }
  }, [bridge, revision])
  useEffect(() => {
    if (!snapshot?.accountPending || accountStatus !== 'credential-stored') return
    let disposed = false
    void bridge.dismissAccount(snapshot.profile).then(async () => {
      const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null
      if (!disposed) setSnapshot(next)
    }).catch(cause => { if (!disposed) setError(String(cause)) })
    return () => { disposed = true }
  }, [bridge, snapshot, accountStatus])
  if (error) return surface(<div role="alert" style={{ padding: 48 }}>
    <p>{error}</p><Button onClick={() => { setError(''); setSnapshot(undefined); refresh(value => value + 1) }}>{zh ? '重试' : 'Retry'}</Button>
  </div>)
  if (snapshot === undefined) return loading()
  if (snapshot === null) return renderNext()
  if (!snapshot.accountPending) {
    // Use the official transient portal; onboarding-only styles are inactive
    // once this continuation returns to the ordinary shell.
    const apply = async () => {
      if (busy || !bridge.applyPending) return
      setBusy(true)
      try { await bridge.applyPending(snapshot.profile); setSnapshot(null) }
      catch (cause) { setError(String(cause)) }
      finally { setBusy(false) }
    }
    return <>{renderNext()}<Toast tone="success" holdMs={8000}
      text={zh ? '桌面设置已保存，下次重启后生效。' : 'Desktop settings saved. They will take effect after restarting.'}
      actions={[{ label: zh ? '立即重启' : 'Restart now', onClick: () => { void apply() } }]}
      onDone={() => { setSnapshot(null) }} /></>
  }
  if (accountStatus === 'credential-stored') return loading()
  const dismiss = async (login: boolean) => {
    if (busy) return
    setBusy(true)
    try {
      await bridge.dismissAccount(snapshot.profile)
      const next = snapshot.restartPending ? pendingSnapshot(await bridge.read()) : null
      setSnapshot(next)
      if (login) openLogin()
    } catch (cause) { setError(String(cause)) }
    finally { setBusy(false) }
  }
  return surface(<section className="dshDesktopAccountSetup" aria-labelledby="desktop-account-title" aria-busy={busy}>
    <div>
      <h1 id="desktop-account-title">{zh ? '桌面设置已完成' : 'Desktop setup is complete'}</h1>
      <p>{zh ? `登录 DeepSeek，开始使用 Profile「${snapshot.profile}」。` : `Sign in to DeepSeek to get started with Profile “${snapshot.profile}”.`}</p>
      <p>{zh ? '登录后，如当前 Profile 尚未完成官方引导，将继续进行设置。你也可以在登录窗口中选择使用 API Key，或稍后登录。' : 'After sign-in, any unfinished official setup for this Profile will continue. You can also choose an API key in the sign-in dialog, or sign in later.'}</p>
      {accountStatus === 'error' && <p role="alert">{zh ? '暂时无法读取登录状态，可以稍后在账号菜单中登录。' : 'Account status is unavailable. You can sign in later from the account menu.'}</p>}
      <div className="dshDesktopAccountActions">
        <Button variant="primary" disabled={busy || accountStatus !== 'signed-out'} onClick={() => { void dismiss(true) }}>{zh ? '登录 DeepSeek' : 'Sign in to DeepSeek'}</Button>
        <Button variant="outline" disabled={busy} onClick={() => { void dismiss(false) }}>{zh ? '暂时跳过' : 'Not now'}</Button>
      </div>
    </div>
  </section>)
}
