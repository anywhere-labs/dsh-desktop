/**
 * Anywhere account page in the official Settings dialog, driving the Host routes of ../account.ts; the main column and
 * the Conversation Views can show it too (./entries.tsx), the main column in the frame of the official entry pages. Its
 * identity and balance cards follow the official account page; below them the official segmented tabs lead to what only
 * this account has: its models, its usage, its settings on this computer, and how the page shows: where besides
 * Settings, and in which currency.
 */
import { useCallback, useEffect, useId, useState, useSyncExternalStore } from 'react'
import {
  Button, IconRightUpOutlineRegular, IconUserOutlineRegular, SegmentedTabs, Tag, type SegmentedTab,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { ANYWHERE_ACCOUNT_ROUTES, type AnywhereAccountSnapshot, type AnywhereProblem } from '../account.ts'
import { ToggleRow } from './controls.tsx'
import { AnywhereGeminiRow, AnywhereKeyRows, AnywhereLocalFileRows } from './local.tsx'
import { AnywhereModelsPanel, ControlRow, type OfficialModelsFace } from './models.tsx'
import { callHost, formatMoney, moneyFormat, problemText, type AnywherePlacement, type Copy, type RouteReply } from './shared.ts'
import { AnywhereUsageBoard } from './usage.tsx'

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
        {failure !== undefined && <div className="dshAnywhereError" role="alert">{problemText(failure, t)}</div>}
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
          [t('计费', 'Billing'), t('美元余额，用多少扣多少，可随时查看用量', 'A US dollar balance, charged as you use it, with usage to check anytime')],
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

type AccountTab = 'models' | 'usage' | 'local' | 'placement'

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
      // The configuration keeps what it had, and the switch shows it again.
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
      <ToggleRow
        label={t('在左侧边栏显示', 'Show in the left sidebar')}
        description={t('左侧边栏加一个 Tokens Anywhere 入口，点开直接进入这个页面。', 'Adds a Tokens Anywhere entry to the left sidebar that opens this page.')}
        checked={pending.get('sidebar') ?? view.sidebar}
        disabled={!view.writable || pending.has('sidebar')}
        onChange={(next) => { void set('sidebar', next) }}
      />
      <ToggleRow
        label={t('在会话区显示', 'Show in conversations')}
        description={t('会话的视图标签里加一个 Tokens Anywhere，不离开会话就能查看模型和用量。', 'Adds a Tokens Anywhere tab beside each conversation, to see models and usage without leaving it.')}
        checked={pending.get('conversation') ?? view.conversation}
        disabled={!view.writable || pending.has('conversation')}
        onChange={(next) => { void set('conversation', next) }}
      />
    </>
  )
}

/**
 * Amounts in the language's own currency instead of dollars: as the account has it in the Tokens Anywhere console until
 * changed here, which leaves the console's setting alone. Shown as it will be once saved.
 */
function LocalCurrencyRow({ state, t, act }: {
  state: AnywhereAccountSnapshot
  t: Copy
  act: (path: string, body?: object) => Promise<RouteReply | undefined>
}) {
  const [pending, setPending] = useState<boolean>()
  const set = async (next: boolean): Promise<void> => {
    setPending(next)
    await act(ANYWHERE_ACCOUNT_ROUTES.currency, { localCurrency: next })
    setPending(undefined)
  }
  return (
    <ToggleRow
      label={t('显示当地货币', 'Show local currency')}
      // As in the console, only Chinese has a currency of its own here.
      description={t(
        '按当天汇率以人民币显示金额。默认跟随网页端的设置，在这里更改不影响网页端。',
        'Your language has no local currency here, so amounts stay in US dollars.',
      )}
      checked={pending ?? state.money?.localCurrency === true}
      disabled={!state.local.writable || pending !== undefined}
      onChange={(next) => { void set(next) }}
    />
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
  const money = moneyFormat(state.money, language)
  const part = (value: AccountTab, label: string): SegmentedTab<AccountTab> =>
    ({ value, label, id: `${navId}-${value}`, panelId: `${navId}-${value}-panel` })
  const parts: [SegmentedTab<AccountTab>, ...SegmentedTab<AccountTab>[]] = [
    part('models', t('模型', 'Models')),
    // The usage comes through the session, which may have ended while the models keep working.
    ...(account.sessionEnded === true ? [] : [part('usage', t('用量', 'Usage'))]),
    part('local', t('设置', 'Settings')),
    // Only where the page is given the placement to change.
    ...(placement === undefined ? [] : [part('placement', t('显示', 'Display'))]),
  ]
  const tab: AccountTab = parts.some(item => item.value === selected) ? selected : 'models'
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
            <span className="dshAnywhereActions">
              {state.balance !== undefined ? (
                <span className="dshAnywhereAmountColumn">
                  <span className="dshAnywhereAmount">{formatMoney(state.balance.available, money)}</span>
                  {held && state.balance !== undefined && (
                    <span className="dshAnywhereSecondary">{t(`另有 ${formatMoney(state.balance.held, money)} 正在使用中`, `plus ${formatMoney(state.balance.held, money)} held by running requests`)}</span>
                  )}
                </span>
              ) : (
                <span className="dshAnywhereSecondary">{state.balanceError === undefined ? t('正在读取…', 'Reading…') : problemText(state.balanceError, t)}</span>
              )}
              <ExternalLink className="dshAnywhereLinkButton dshAnywherePrimary" href={`${state.origin}/console/settings/billing/`}>{t('充值', 'Top up')}</ExternalLink>
            </span>
          </div>
        </div>
      )}

      {/* The account's parts side by side, in the tabs of the official Plugins page. */}
      <SegmentedTabs
        className="dshAnywhereTabs"
        label={t('账户内容', 'Account sections')}
        value={tab}
        items={parts}
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
          <AnywhereUsageBoard t={t} language={language} models={state.models} money={state.money} />
        </div>
      )}
      <div role="tabpanel" id={`${navId}-local-panel`} aria-labelledby={`${navId}-local`} hidden={tab !== 'local'}>
        <div className="dshAnywhereRows">
          <AnywhereKeyRows state={state} t={t} act={act} />
          <AnywhereGeminiRow state={state} t={t} act={act} />
          <AnywhereLocalFileRows state={state} t={t} act={act} />
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
            <LocalCurrencyRow state={state} t={t} act={act} />
          </div>
        </div>
      )}
    </>
  )
}

/**
 * Where the page shows: a Settings section, under a heading of its own like the Desktop settings beside it; the main
 * column, in the official entry pages' frame with the page title; or a Conversation View, whose tab names the page.
 */
export type AnywherePageFrame = 'section' | 'page' | 'view'

export function AnywhereAccountSettings({ language, officialModels, placement, frame = 'section' }: {
  language: string
  officialModels: () => OfficialModelsFace | undefined
  /** Where the account shows besides Settings; absent where it cannot be changed. */
  placement?: AnywherePlacement | undefined
  frame?: AnywherePageFrame
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
    <div className="dshAnywherePage" data-tokens-anywhere="" data-frame={frame}>
      {frame !== 'view' && (
        // As the official title rows: the title, then its tags. In the main column the row, which reaches the window's
        // top strip, drags the window like the Plugins page's.
        <header className="dshAnywhereHeader" data-window-drag={frame === 'page' ? '' : undefined}>
          {frame === 'page' ? <h1>Tokens Anywhere</h1> : <h2>Tokens Anywhere</h2>}
          <Tag className="dshAnywhereStatusTag" tone="info">Beta</Tag>
        </header>
      )}
      <div className="dshAnywhereSection">
        {state === undefined && !unreachable && <p className="dshAnywhereSecondary" role="status">{t('正在读取…', 'Loading…')}</p>}
        {unreachable && <p className="dshAnywhereError" role="alert">{t('暂时读不到账户状态。', 'The account state is unavailable right now.')}</p>}
        {error !== undefined && <p className="dshAnywhereError" role="alert">{problemText(error, t)}</p>}
        {state !== undefined && state.account === undefined && <SignedOut state={state} t={t} busy={busy} run={run} notice={state.notice} />}
        {state?.account !== undefined && <SignedIn state={state} t={t} language={language} busy={busy} run={run} act={act} officialModels={officialModels} placement={placement} />}
      </div>
    </div>
  )
}
