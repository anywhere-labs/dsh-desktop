/**
 * Anywhere account page in the official Settings dialog, driving the Host routes of ../anywhere-account.ts; the left
 * sidebar and the Conversation Views can show it too (./anywhere-entries.tsx). Its identity and balance cards follow the
 * official account page; below them a bar leads to what only this account has: its models, its usage, this computer's
 * connection, and where the page shows besides Settings.
 */
import { useCallback, useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from 'react'
import {
  Button, IconDataOutlineMedium, IconGaugeOutlineMedium, IconLinkOutlineMedium, IconPanelLeftOutlineMedium, IconRightUpOutlineRegular,
  IconUserOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ANYWHERE_ACCOUNT_ROUTES, type AnywhereAccountSnapshot, type AnywhereProblem } from '../anywhere-account.ts'
import { DesktopSettingsToggleRow } from './DesktopSettingsSection.tsx'
import { AnywhereModelsPanel, ControlRow, type OfficialModelsFace } from './anywhere-models.tsx'
import { callHost, formatYuan, intlLocale, problemText, type AnywherePlacement, type Copy, type RouteReply } from './anywhere-shared.ts'
import { AnywhereUsageBoard } from './anywhere-usage.tsx'

/** A sign-in and a first balance arrive soon; otherwise the page only has the balance to keep fresh. */
const POLL_WAITING_MS = 1500
const POLL_IDLE_MS = 15_000

/** Which control an action belongs to; only that control shows it is busy. */
type Control = 'sign-in' | 'cancel' | 'sign-out'

const PENDING_PHASES: readonly string[] = ['waiting-browser', 'exchanging', 'configuring']

/** Open a Tokens Anywhere page: the Desktop window hands http(s) pages to the system browser. */
function ExternalLink({ href, className, children }: { href: string; className?: string; children: React.ReactNode }) {
  return <a href={href} className={className} target="_blank" rel="noreferrer">{children}</a>
}

function SignedOut({ state, t, busy, run, notice }: {
  state: AnywhereAccountSnapshot
  t: Copy
  busy: ReadonlySet<Control>
  run: (control: Control, path: string, body?: object) => Promise<RouteReply | undefined>
  notice: AnywhereProblem | undefined
}) {
  const attempt = state.attempt
  const pending = attempt !== undefined && PENDING_PHASES.includes(attempt.phase)
  const waiting = attempt?.phase === 'waiting-browser'
  const failure = attempt !== undefined && attempt.error !== undefined && attempt.error.code !== 'cancelled' && !pending ? attempt.error : notice
  const title = !pending ? t('登录 Tokens Anywhere', 'Sign in to Tokens Anywhere')
    : waiting ? t('请在登录窗口中完成登录', 'Finish signing in in the sign-in window')
      : attempt.phase === 'exchanging' ? t('正在验证账号…', 'Checking your account…') : t('正在配置模型…', 'Setting up models…')
  return (
    <>
      <div className="dshAnywhereCard dshAnywhereSignedOut">
        <div className="dshAnywhereSignedOutTitle">{title}</div>
        <div className="dshAnywhereSignedOutDescription">{waiting
          ? t('窗口没有出现，或想用已登录的浏览器？可以在浏览器中打开。', 'No window, or prefer the browser you are signed in to? Open it there.')
          : t('用 Agents Anywhere 账号登录，即可直接使用下面这些模型，不需要填写 API Key。', 'Sign in with your Agents Anywhere account to use these models right away, with no API key to enter.')}</div>
        {failure !== undefined && <div className="dshDesktopSettingsError" role="alert">{problemText(failure, t)}</div>}
        <div className="dshAnywhereActions">
          {!pending && (
            <Button variant="primary" className="dshAnywhereSignIn" disabled={busy.has('sign-in')}
              onClick={() => { void run('sign-in', ANYWHERE_ACCOUNT_ROUTES.signIn) }}>
              {busy.has('sign-in') ? t('正在打开…', 'Opening…') : t('登录', 'Sign in')}
            </Button>
          )}
          {waiting && attempt.authorizeUrl !== undefined && (
            <ExternalLink className="dshAnywhereLinkButton" href={attempt.authorizeUrl}>{t('在浏览器中打开', 'Open in browser')}</ExternalLink>
          )}
          {waiting && (
            <Button variant="outline" disabled={busy.has('cancel')}
              onClick={() => { void run('cancel', ANYWHERE_ACCOUNT_ROUTES.cancel, { id: attempt.id }) }}>
              {t('取消', 'Cancel')}
            </Button>
          )}
        </div>
      </div>
      <div className="dshAnywhereBalanceCard">
        {[
          [t('模型', 'Models'), t('Claude、GPT、DeepSeek 自动配置好，思考等级默认开启', 'Claude, GPT and DeepSeek set up for you, with thinking on by default')],
          [t('计费', 'Billing'), t('人民币余额，用多少扣多少，可随时查看用量', 'A CNY balance, charged as you use it, with usage to check anytime')],
          [t('本机', 'This computer'), t('退出登录后，本机的 Key 和模型配置都会移除', 'Signing out removes the key and the models from this computer')],
        ].map(([label, text], index) => (
          <div key={label}>
            {index > 0 && <div className="dshAnywhereDivider" />}
            <div className="dshAnywhereRow">
              <span>{label}</span>
              <span className="dshAnywhereSecondary dshAnywhereRowText">{text}</span>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

type AccountTab = 'models' | 'usage' | 'connection' | 'placement'

/** The account's parts side by side, in a bar with the look of the settings navigation to its left. */
function AccountNav({ id, tabs, value, label, onChange }: {
  id: string
  tabs: readonly { readonly id: AccountTab; readonly label: string; readonly icon: ReactNode }[]
  value: AccountTab
  label: string
  onChange: (tab: AccountTab) => void
}) {
  const cells = useRef(new Map<AccountTab, HTMLButtonElement>())
  const keys = (event: KeyboardEvent, index: number): void => {
    const next = event.key === 'ArrowRight' ? (index + 1) % tabs.length
      : event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
        : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : undefined
    if (next === undefined) return
    event.preventDefault()
    const tab = tabs[next]!
    onChange(tab.id)
    cells.current.get(tab.id)?.focus()
  }
  return (
    <div className="dshAnywhereNav" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          ref={(cell) => { if (cell === null) cells.current.delete(tab.id); else cells.current.set(tab.id, cell) }}
          type="button"
          role="tab"
          id={`${id}-${tab.id}`}
          className="dshAnywhereNavCell"
          aria-selected={value === tab.id}
          aria-controls={`${id}-${tab.id}-panel`}
          tabIndex={value === tab.id ? 0 : -1}
          onClick={() => { onChange(tab.id) }}
          onKeyDown={(event) => { keys(event, index) }}
        >
          {tab.icon}
          <span>{tab.label}</span>
        </button>
      ))}
    </div>
  )
}

type PlacementKey = 'sidebar' | 'conversation'

/** Where the account shows besides Settings; the right sidebar has no entry yet. */
function PlacementRows({ placement, t }: { placement: AnywherePlacement; t: Copy }) {
  const view = useSyncExternalStore(placement.subscribe, placement.getSnapshot)
  const [pending, setPending] = useState<ReadonlyMap<PlacementKey, boolean>>(new Map())
  if (view === undefined) return null
  const set = async (key: PlacementKey, value: boolean): Promise<void> => {
    setPending(current => new Map(current).set(key, value))
    try {
      await placement.set(key === 'sidebar' ? { sidebar: value } : { conversation: value })
    } catch {
      // The preferences keep what they had, and the switch shows it again.
    } finally {
      setPending((current) => {
        const next = new Map(current)
        next.delete(key)
        return next
      })
    }
  }
  return (
    <>
      <DesktopSettingsToggleRow
        label={t('在左侧边栏显示', 'Show in the left sidebar')}
        description={t('左侧边栏加一个 Anywhere 账户入口，点开直接进入这个页面。', 'Adds an Anywhere account entry to the left sidebar that opens this page.')}
        checked={pending.get('sidebar') ?? view.sidebar}
        disabled={!view.writable || pending.has('sidebar')}
        onChange={(next) => { void set('sidebar', next) }}
      />
      <DesktopSettingsToggleRow
        label={t('在会话区显示', 'Show in conversations')}
        description={t('会话的视图标签里加一个 Anywhere 账户，不离开会话就能查看模型和用量。', 'Adds an Anywhere account tab beside each conversation, to see models and usage without leaving it.')}
        checked={pending.get('conversation') ?? view.conversation}
        disabled={!view.writable || pending.has('conversation')}
        onChange={(next) => { void set('conversation', next) }}
      />
    </>
  )
}

function SignedIn({ state, t, language, busy, run, act, officialModels, placement }: {
  state: AnywhereAccountSnapshot
  t: Copy
  language: string
  busy: ReadonlySet<Control>
  run: (control: Control, path: string, body?: object) => Promise<RouteReply | undefined>
  act: (path: string, body?: object) => Promise<RouteReply | undefined>
  officialModels: () => OfficialModelsFace | undefined
  placement: AnywherePlacement | undefined
}) {
  const navId = useId()
  const [selected, setSelected] = useState<AccountTab>('models')
  // A part mounts when first shown and stays, so going elsewhere keeps its drafts and filters.
  const [visited, setVisited] = useState<ReadonlySet<AccountTab>>(new Set(['models']))
  const [confirmSignOut, setConfirmSignOut] = useState(false)
  const account = state.account!
  const attempt = state.attempt
  const pending = attempt !== undefined && PENDING_PHASES.includes(attempt.phase)
  const held = state.balance !== undefined && Number(state.balance.held) > 0
  const tabs: readonly { id: AccountTab; label: string; icon: ReactNode }[] = [
    { id: 'models', label: t('模型', 'Models'), icon: <IconDataOutlineMedium size={16} /> },
    // The usage comes through the session, which may have ended while the models keep working.
    ...(account.sessionEnded === true ? [] : [{ id: 'usage' as const, label: t('用量', 'Usage'), icon: <IconGaugeOutlineMedium size={16} /> }]),
    { id: 'connection', label: t('本机连接', 'This computer'), icon: <IconLinkOutlineMedium size={16} /> },
    // Only where the window can change it.
    ...(placement === undefined ? [] : [{ id: 'placement' as const, label: t('显示位置', 'Placement'), icon: <IconPanelLeftOutlineMedium size={16} /> }]),
  ]
  const tab: AccountTab = tabs.some(item => item.id === selected) ? selected : 'models'
  return (
    <>
      <div className="dshAnywhereCard">
        <div className="dshAnywhereIdentity">
          <span className="dshAnywhereAvatar"><IconUserOutlineRegular size={20} /></span>
          <span className="dshAnywhereIdentityCopy">
            <span className="dshAnywhereName">{account.displayName || account.email}</span>
            <span className="dshAnywhereSecondary">{account.displayName !== '' && account.email !== '' ? account.email : t('已登录', 'Signed in')}</span>
          </span>
        </div>
        <ExternalLink className="dshAnywhereAccountInfo" href={`${state.origin}/console/settings/account/`}>
          {t('更多账号信息', 'More account info')}<IconRightUpOutlineRegular size={12} />
        </ExternalLink>
      </div>

      {account.sessionEnded === true && (
        <div className="dshAnywhereCard" role="status">
          <span className="dshAnywhereRowCopy">
            <span>{t('需要重新登录', 'Sign in again')}</span>
            <span className="dshAnywhereSecondary">{t('模型仍可继续使用，查看余额和用量需要重新登录。', 'Models keep working. Sign in again to see your balance and usage.')}</span>
          </span>
          <span className="dshAnywhereActions">
            {pending && attempt?.phase === 'waiting-browser' && attempt.authorizeUrl !== undefined && (
              <ExternalLink className="dshAnywhereLinkButton" href={attempt.authorizeUrl}>{t('在浏览器中打开', 'Open in browser')}</ExternalLink>
            )}
            {pending && attempt?.phase === 'waiting-browser' ? (
              <Button variant="outline" disabled={busy.has('cancel')}
                onClick={() => { void run('cancel', ANYWHERE_ACCOUNT_ROUTES.cancel, { id: attempt.id }) }}>{t('取消', 'Cancel')}</Button>
            ) : (
              <Button variant="primary" disabled={busy.has('sign-in') || pending}
                onClick={() => { void run('sign-in', ANYWHERE_ACCOUNT_ROUTES.signIn) }}>{t('重新登录', 'Sign in')}</Button>
            )}
          </span>
        </div>
      )}

      {account.sessionEnded !== true && (
        <div className="dshAnywhereBalanceCard">
          <div className="dshAnywhereRow">
            <span>{t('账户余额', 'Balance')}</span>
            {state.balance !== undefined ? (
              <span className="dshAnywhereAmountColumn">
                <span className="dshAnywhereAmount">{formatYuan(state.balance.available, language)}</span>
                {held && state.balance !== undefined && (
                  <span className="dshAnywhereSecondary">{t(`另有 ${formatYuan(state.balance.held, language)} 正在使用中`, `plus ${formatYuan(state.balance.held, language)} held by running requests`)}</span>
                )}
              </span>
            ) : (
              <span className="dshAnywhereSecondary">{state.balanceError === undefined ? t('正在读取…', 'Reading…') : problemText(state.balanceError, t)}</span>
            )}
          </div>
          <div className="dshAnywhereDivider" />
          <div className="dshAnywhereRow">
            <span>{t('更多', 'More')}</span>
            <span className="dshAnywhereActions">
              <ExternalLink className="dshAnywhereLinkButton" href={`${state.origin}/console/usage/`}>{t('查询用量', 'View usage')}</ExternalLink>
              <ExternalLink className="dshAnywhereLinkButton dshAnywherePrimary" href={`${state.origin}/console/settings/billing/`}>{t('充值', 'Top up')}</ExternalLink>
            </span>
          </div>
        </div>
      )}

      <AccountNav
        id={navId}
        label={t('账户内容', 'Account sections')}
        value={tab}
        tabs={tabs}
        onChange={(next) => {
          setSelected(next)
          setVisited(current => new Set(current).add(next))
        }}
      />
      <div role="tabpanel" id={`${navId}-models-panel`} aria-labelledby={`${navId}-models`} hidden={tab !== 'models'}>
        <AnywhereModelsPanel state={state} t={t} act={act} officialModels={officialModels} />
      </div>
      {account.sessionEnded !== true && visited.has('usage') && (
        <div role="tabpanel" id={`${navId}-usage-panel`} aria-labelledby={`${navId}-usage`} hidden={tab !== 'usage'}>
          <AnywhereUsageBoard t={t} language={language} models={state.models} />
        </div>
      )}
      <div role="tabpanel" id={`${navId}-connection-panel`} aria-labelledby={`${navId}-connection`} hidden={tab !== 'connection'}>
        <div className="dshAnywhereRows">
          <ControlRow label={t('专用 Key', 'Key')} description={t('这台电脑专用，退出登录时一并删除。', 'For this computer only; signing out deletes it.')}>
            <code className="dshAnywhereSecondary">{account.keyPrefix}…</code>
          </ControlRow>
          <ControlRow label={t('连接时间', 'Connected')} description={new Date(account.connectedAt).toLocaleString(intlLocale(language))} />
          {account.memoryOnly === true && (
            <ControlRow label={t('登录状态', 'Sign-in')} description={t(
              '系统钥匙串不可用，退出应用后需要重新登录才能查看余额和用量。',
              'The system keychain is unavailable, so you will need to sign in again after quitting to see your balance and usage.',
            )} />
          )}
          {confirmSignOut ? (
            <ControlRow label={t('退出登录？', 'Sign out?')} description={t(
              '退出后会断开这台电脑，并移除本机的 Key 和 Tokens Anywhere 模型。',
              'Signing out disconnects this computer and removes its key and the Tokens Anywhere models.',
            )}>
              <Button variant="outline" size="sm" onClick={() => { setConfirmSignOut(false) }}>{t('取消', 'Cancel')}</Button>
              <Button variant="primary" size="sm" disabled={busy.has('sign-out')}
                onClick={() => { void run('sign-out', ANYWHERE_ACCOUNT_ROUTES.signOut).then(() => { setConfirmSignOut(false) }) }}>
                {busy.has('sign-out') ? t('正在退出…', 'Signing out…') : t('确认退出', 'Sign out')}
              </Button>
            </ControlRow>
          ) : (
            <ControlRow label={t('退出登录', 'Sign out')} description={t('断开这台电脑和这个账户的连接。', 'Disconnect this computer from this account.')}>
              <Button variant="outline" size="sm" onClick={() => { setConfirmSignOut(true) }}>{t('退出', 'Sign out')}</Button>
            </ControlRow>
          )}
        </div>
      </div>
      {placement !== undefined && (
        <div role="tabpanel" id={`${navId}-placement-panel`} aria-labelledby={`${navId}-placement`} hidden={tab !== 'placement'}>
          <div className="dshAnywhereRows">
            <PlacementRows placement={placement} t={t} />
          </div>
        </div>
      )}
    </>
  )
}

export function AnywhereAccountSettings({ language, officialModels, placement, heading = true }: {
  language: string
  officialModels: () => OfficialModelsFace | undefined
  /** Where the account shows besides Settings; absent where the window cannot change it. */
  placement?: AnywherePlacement | undefined
  /** A Conversation View tab already names the page. */
  heading?: boolean
}) {
  const t: Copy = useCallback((zh, en) => language.startsWith('zh') ? zh : en, [language])
  const [state, setState] = useState<AnywhereAccountSnapshot>()
  const [unreachable, setUnreachable] = useState(false)
  const [busy, setBusy] = useState<ReadonlySet<Control>>(new Set())
  const [error, setError] = useState<AnywhereProblem>()
  const pending = state?.attempt !== undefined && PENDING_PHASES.includes(state.attempt.phase)
  // The Host reads the balance in the background and answers without it.
  const balanceDue = state?.account !== undefined && state.account.sessionEnded !== true && state.balance === undefined && state.balanceError === undefined

  useEffect(() => {
    let stopped = false
    const read = async (): Promise<void> => {
      try {
        const reply = await callHost(ANYWHERE_ACCOUNT_ROUTES.state)
        if (stopped || reply.state === undefined) return
        setState(reply.state)
        setUnreachable(false)
      } catch {
        if (!stopped) setUnreachable(true)
      }
    }
    void read()
    const timer = setInterval(() => { void read() }, pending || balanceDue ? POLL_WAITING_MS : POLL_IDLE_MS)
    return () => { stopped = true; clearInterval(timer) }
  }, [pending, balanceDue])

  const act = useCallback(async (path: string, body: object = {}): Promise<RouteReply | undefined> => {
    setError(undefined)
    try {
      const reply = await callHost(path, body)
      if (reply.state !== undefined) setState(reply.state)
      if (reply.error !== undefined) setError(reply.error)
      return reply
    } catch {
      setError({ code: 'failed' })
      return undefined
    }
  }, [])

  const run = useCallback(async (control: Control, path: string, body: object = {}): Promise<RouteReply | undefined> => {
    setBusy(current => new Set(current).add(control))
    try {
      return await act(path, body)
    } finally {
      setBusy((current) => {
        const next = new Set(current)
        next.delete(control)
        return next
      })
    }
  }, [act])

  return (
    <div className="dshDesktopSettings" data-next-anywhere-account="">
      {heading && (
        <header className="dshDesktopSettingsHeader">
          <h2>{t('Anywhere 账户', 'Anywhere account')} <span className="dshDesktopSettingsBadge">Beta</span></h2>
        </header>
      )}
      <div className="dshAnywhereSection">
        {state === undefined && !unreachable && <p className="dshAnywhereSecondary" role="status">{t('正在读取…', 'Loading…')}</p>}
        {unreachable && <p className="dshDesktopSettingsError" role="alert">{t('暂时读不到账户状态。', 'The account state is unavailable right now.')}</p>}
        {error !== undefined && <p className="dshDesktopSettingsError" role="alert">{problemText(error, t)}</p>}
        {state !== undefined && state.account === undefined && <SignedOut state={state} t={t} busy={busy} run={run} notice={state.notice} />}
        {state?.account !== undefined && <SignedIn state={state} t={t} language={language} busy={busy} run={run} act={act} officialModels={officialModels} placement={placement} />}
      </div>
    </div>
  )
}
