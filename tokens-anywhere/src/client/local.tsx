/**
 * The account on this computer: its key, copied or rotated; whether the Gemini models speak Google's own format; and,
 * for custom setups, the two local files it writes: the active Profile's configuration with its models, opened as the
 * Settings dialog's own button opens it, and the credentials document with its key, only shown in the file manager
 * since it holds every provider's key. What the account writes there stays in the plugin's configuration, not on the page.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconCopyOutlineRegular, IconRefreshOutlineRegular, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { ANYWHERE_ACCOUNT_ROUTES, type AnywhereAccountSnapshot } from '../account.ts'
import { ToggleRow } from './controls.tsx'
import { ControlRow } from './models.tsx'
import { callHost, type Copy, type RouteReply } from './shared.ts'

type Act = (path: string, body?: object) => Promise<RouteReply | undefined>

/**
 * Gemini through Google's own API instead of Chat Completions, off by default as Tokens Anywhere's own DeepSeek Harness
 * guide sets it up; the switch rewrites the Gemini route. Custom routes are the user's, so it waits while custom
 * configuration is on. Shown as it will be once saved.
 */
export function AnywhereGeminiRow({ state, t, act }: { state: AnywhereAccountSnapshot; t: Copy; act: Act }) {
  const [pending, setPending] = useState<boolean>()
  const custom = state.custom === true
  const set = async (next: boolean): Promise<void> => {
    setPending(next)
    await act(ANYWHERE_ACCOUNT_ROUTES.local, { geminiNative: next })
    setPending(undefined)
  }
  return (
    <ToggleRow
      label={t('用谷歌格式配置 Gemini 模型', 'Configure Gemini models in Google\'s format')}
      description={custom
        ? t('自定义配置开启时不可更改。', 'Unavailable while custom configuration is on.')
        : t('默认通过 OpenAI 格式调用，开启后改用谷歌的原生接口。', 'Gemini models use the OpenAI format by default; turn this on to use Google\'s own API.')}
      checked={pending ?? state.local.geminiNative}
      disabled={!state.local.writable || custom || pending !== undefined}
      onChange={(next) => { void set(next) }}
    />
  )
}

/** How long the copy button says what happened. */
const COPY_NOTE_MS = 2_000

/** The key: its prefix, a copy to the clipboard, and a rotation the user confirms first. */
export function AnywhereKeyRows({ state, t, act }: { state: AnywhereAccountSnapshot; t: Copy; act: Act }) {
  const account = state.account!
  const [copy, setCopy] = useState<'idle' | 'busy' | 'copied' | 'failed'>('idle')
  const [confirming, setConfirming] = useState(false)
  const [rotating, setRotating] = useState(false)
  const note = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => { clearTimeout(note.current) }, [])

  const copyKey = async (): Promise<void> => {
    setCopy('busy')
    const reply = await act(ANYWHERE_ACCOUNT_ROUTES.copyKey)
    const secret = (reply?.result as { secret?: unknown } | undefined)?.secret
    // A refused write, like a key the Host could not give, shows on the button.
    const copied = typeof secret === 'string' && await writeClipboard(secret)
    setCopy(copied ? 'copied' : 'failed')
    clearTimeout(note.current)
    note.current = setTimeout(() => { setCopy('idle') }, COPY_NOTE_MS)
  }

  const rotate = async (): Promise<void> => {
    setConfirming(false)
    setRotating(true)
    await act(ANYWHERE_ACCOUNT_ROUTES.rotateKey)
    setRotating(false)
  }

  return (
    <>
      <ControlRow label={t('专用 Key', 'Key')} description={t('这台电脑专用，退出登录时一并删除。', 'For this computer only; signing out deletes it.')}>
        <code className="dshAnywhereSecondary">{account.keyPrefix}…</code>
        <Button variant="outline" size="sm" icon={<IconCopyOutlineRegular size={14} />} disabled={copy === 'busy'} onClick={() => { void copyKey() }}>
          {copy === 'copied' ? t('已复制', 'Copied') : copy === 'failed' ? t('复制失败', 'Copy failed') : t('复制', 'Copy')}
        </Button>
        <Button variant="outline" size="sm" icon={<IconRefreshOutlineRegular size={14} />} disabled={rotating || account.sessionEnded === true}
          onClick={() => { setConfirming(true) }}>
          {rotating ? t('正在轮换…', 'Rotating…') : t('轮换', 'Rotate')}
        </Button>
      </ControlRow>
      {confirming && (
        <ControlRow label={t('轮换 Key？', 'Rotate the key?')} description={t(
          '旧 Key 会立即失效，DSH 会自动换用新 Key；复制到别处的旧 Key 需要重新复制。',
          'The old key stops working at once and DSH switches to the new one; copy it again wherever you pasted the old one.',
        )}>
          <Button variant="outline" size="sm" onClick={() => { setConfirming(false) }}>{t('取消', 'Cancel')}</Button>
          <Button variant="primary" size="sm" onClick={() => { void rotate() }}>{t('确认轮换', 'Rotate')}</Button>
        </ControlRow>
      )}
    </>
  )
}

/** The account's local files, a button each with no more said, as the Settings dialog's 打开配置文件 does. */
export function AnywhereLocalFileRows({ state, t, act }: { state: AnywhereAccountSnapshot; t: Copy; act: Act }) {
  const [opening, setOpening] = useState(false)
  const [failed, setFailed] = useState(false)
  const open = async (): Promise<void> => {
    setOpening(true)
    setFailed(false)
    try {
      setFailed((await callHost(ANYWHERE_ACCOUNT_ROUTES.openConfig, {})).error !== undefined)
    } catch {
      setFailed(true)
    } finally {
      setOpening(false)
    }
  }
  return (
    <ControlRow label={t('本地文件', 'Local files')}>
      {failed && <span className="dshAnywhereActionError" role="alert">{t('无法打开配置文件', 'Could not open the configuration file')}</span>}
      {state.local.revealFiles && (
        <Button variant="outline" size="sm" onClick={() => { void act(ANYWHERE_ACCOUNT_ROUTES.revealFile, { file: 'credentials' }) }}>
          {t('显示凭据文件', 'Show credentials file')}
        </Button>
      )}
      <Button variant="outline" size="sm" disabled={opening} onClick={() => { void open() }}>{t('打开配置文件', 'Open configuration file')}</Button>
    </ControlRow>
  )
}
