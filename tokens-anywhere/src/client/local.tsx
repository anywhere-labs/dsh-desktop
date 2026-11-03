/**
 * The account on this computer: its key, copied or rotated, and what it writes into DSH's local files, each behind a
 * switch: the key into the credentials document, the models into the active Profile's configuration.
 */
import { useEffect, useRef, useState } from 'react'
import { Button, IconCopyOutlineRegular, IconFolderOpenOutlineRegular, IconRefreshOutlineRegular, writeClipboard } from '@deepseek-ai/dsh-client-ui-primitives'
import { ANYWHERE_ACCOUNT_ROUTES, type AnywhereAccountSnapshot, type AnywhereLocalFile } from '../account.ts'
import { ToggleRow } from './controls.tsx'
import { ControlRow } from './models.tsx'
import type { Copy, RouteReply } from './shared.ts'

type Act = (path: string, body?: object) => Promise<RouteReply | undefined>

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

/** What the account writes into DSH's local files; the models need the stored key, so the two switches move together. */
export function AnywhereLocalFileRows({ state, t, act }: { state: AnywhereAccountSnapshot; t: Copy; act: Act }) {
  const local = state.local
  const [pending, setPending] = useState<{ storeKey?: boolean; writeModels?: boolean }>()
  const set = async (change: { storeKey?: boolean; writeModels?: boolean }): Promise<void> => {
    setPending(change)
    await act(ANYWHERE_ACCOUNT_ROUTES.local, change)
    setPending(undefined)
  }
  // Shown as they will be once saved: the key off takes the models with it, the models on bring the key back.
  const storeKey = pending?.storeKey ?? (pending?.writeModels === true || local.storeKey)
  const writeModels = pending?.writeModels ?? (pending?.storeKey !== false && local.writeModels)
  const reveal = (file: AnywhereLocalFile) => local.revealFiles ? (
    <Button variant="ghost" size="sm" icon={<IconFolderOpenOutlineRegular size={14} />}
      onClick={() => { void act(ANYWHERE_ACCOUNT_ROUTES.revealFile, { file }) }}>{t('显示文件', 'Show file')}</Button>
  ) : undefined
  return (
    <>
      <ToggleRow
        label={t('保存 Key', 'Keep the key')}
        description={t(
          '把专用 Key 存进 DSH 的凭据文件（.credentials.yaml），模型调用要用到它。关闭后从文件里删除，模型也一并移除。',
          'Keeps the key in DSH\'s credentials file (.credentials.yaml), where model requests read it. Off, it is deleted from the file and the models go too.',
        )}
        checked={storeKey}
        disabled={!local.writable || pending !== undefined}
        onChange={(next) => { void set({ storeKey: next }) }}
        action={reveal('credentials')}
      />
      <ToggleRow
        label={t('写入模型配置', 'Write the models')}
        description={t(
          '把 Tokens Anywhere 的模型写进当前 Profile 的配置文件（cordis.patch.yml），模型选择器里才会出现它们。关闭后移除这些模型，包括自定义的配置；账户仍保持登录。',
          'Writes the Tokens Anywhere models into the current Profile\'s configuration (cordis.patch.yml), so the model picker offers them. Off, they are removed, custom configuration included; the account stays signed in.',
        )}
        checked={writeModels}
        disabled={!local.writable || pending !== undefined}
        onChange={(next) => { void set({ writeModels: next }) }}
        action={reveal('profile-config')}
      />
    </>
  )
}
