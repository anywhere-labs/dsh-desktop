/**
 * A control on the official Plugins page that replaces an installed third-party bundle with another version or
 * source, for the bundles the page's own Update does not cover: a Git branch or an unpinned Git spec, a local
 * directory, and a tarball. It draws a dialog of its own because the page's install dialog refuses a package the
 * profile already declares, and the manager refuses to install over it under HMR.
 */
import { useEffect, useRef, useState } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { BundleInfo } from '@deepseek-ai/dsh-api-remotes/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import { Button, Modal, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import {
  switchBundleVersion, versionSwitchTarget, type VersionSwitchOutcome, type VersionSwitchStep,
} from './plugin-version-switch.ts'

export const VERSION_SWITCH_ITEM = 'desktop-next-version-switch'

type Translate = (cn: string, en: string) => string

const STEP_TEXT: Readonly<Record<VersionSwitchStep, { zh: string; en: string }>> = {
  checking: { zh: '正在检查目标版本', en: 'Checking the target' },
  removing: { zh: '正在移除当前版本', en: 'Removing the current version' },
  installing: { zh: '正在安装新版本', en: 'Installing the new version' },
  restoring: { zh: '正在装回原来的来源', en: 'Installing the previous source again' },
}

/**
 * The bundle the open detail page is about, re-read on every profile change.
 * @param context - the client context, for the manager's Remote.
 * @param name - the package the page shows, or undefined for a page that is not a bundle's.
 * @returns the listed bundle, or undefined before the first answer.
 */
function useBundle(context: Context, name: string | undefined): BundleInfo | undefined {
  const [bundle, setBundle] = useState<BundleInfo | undefined>(undefined)
  useEffect(() => {
    if (name === undefined) { setBundle(undefined); return undefined }
    let disposed = false
    const load = (): void => {
      void context.remote.pluginManager.listBundles().then(result => {
        if (disposed) return
        if (result.ok) setBundle(result.value.find(row => row.name === name))
      }).catch(() => {
        // A refused read leaves the page without this control, as an unlisted bundle does.
      })
    }
    load()
    const off = context.remote.$on('plugin-manager/changed', load)
    return () => { disposed = true; off() }
  }, [context, name])
  return bundle
}

/**
 * The dialog's own state: the spec typed, the steps that ran, and how an attempt ended.
 * @param context - the client context, for the manager's Remote.
 * @param name - the package the page shows.
 * @param enabled - the bundle's switch, kept across the replacement.
 * @param source - the spec the profile saved, which the field starts from and the failed target falls back to.
 * @returns the state and the actions the dialog binds.
 */
function useVersionSwitch(context: Context, name: string, enabled: boolean, source: string | undefined) {
  const [open, setOpen] = useState(false)
  const [spec, setSpec] = useState(source ?? '')
  const [steps, setSteps] = useState<readonly VersionSwitchStep[]>([])
  const [outcome, setOutcome] = useState<VersionSwitchOutcome | undefined>(undefined)
  const [running, setRunning] = useState(false)
  const pending = useRef(false)
  useEffect(() => { if (!open) setSpec(source ?? '') }, [open, source])
  const start = async (): Promise<void> => {
    if (pending.current || source === undefined) return
    pending.current = true
    setRunning(true); setSteps([]); setOutcome(undefined)
    try {
      setOutcome(await switchBundleVersion(context.remote.pluginManager, { name, source, enabled }, spec,
        step => { setSteps(previous => previous.includes(step) ? previous : [...previous, step]) }))
    } catch (failure) {
      setOutcome({ status: 'refused', reason: failure instanceof Error ? failure.message : String(failure) })
    } finally {
      pending.current = false
      setRunning(false)
    }
  }
  return { open, setOpen, spec, setSpec, steps, outcome, running, start }
}

/**
 * The outcome in the person's words, or undefined while an attempt runs.
 * @param outcome - how the last attempt ended.
 * @param translate - the zh/en chooser of the registered entry.
 * @returns the sentence to show, and whether it reports trouble.
 */
function outcomeText(outcome: VersionSwitchOutcome | undefined, translate: Translate): { text: string; failed: boolean } | undefined {
  if (outcome === undefined) return undefined
  switch (outcome.status) {
    case 'installed': return { text: translate('已更换到新的版本。', 'Replaced with the new version.'), failed: false }
    case 'refused': return { text: translate(`目标版本没有被接受，profile 没有任何改动：${outcome.reason}`, `The target was not accepted, so the profile is unchanged: ${outcome.reason}`), failed: true }
    case 'not-removed': return { text: translate(`当前版本没能移除，profile 没有任何改动：${outcome.reason}`, `The current version could not be removed, so the profile is unchanged: ${outcome.reason}`), failed: true }
    case 'restored': return { text: translate(`新版本没有装上，原来的来源已装回：${outcome.reason}`, `The new version did not install; the previous source is installed again: ${outcome.reason}`), failed: true }
    case 'lost': return { text: translate(`新版本没有装上，原来的来源也没能装回。请在 profile 里重新安装 ${outcome.previous}：${outcome.restoreReason}`, `The new version did not install, and neither did the previous source. Install ${outcome.previous} again in the profile: ${outcome.restoreReason}`), failed: true }
  }
}

/** The head control the official page renders before its own switch and uninstall. */
export function VersionSwitchActions({ context, t, subject }: PropsLocale<'desktop-next'> & PropsRuntime<'plugins.detail.actions'> & { context: Context }) {
  const zh = t('language') === 'zh'
  const translate: Translate = (cn, en) => zh ? cn : en
  const name = subject.kind === 'bundle' ? subject.pkg.name : undefined
  const bundle = useBundle(context, name)
  const target = versionSwitchTarget(bundle)
  const { open, setOpen, spec, setSpec, steps, outcome, running, start } = useVersionSwitch(
    context, target?.name ?? '', target?.enabled ?? false, target?.source,
  )
  if (target === undefined) return null
  const result = outcomeText(outcome, translate)
  return <div className="dshNextPluginDetail" data-next-version-switch={target.name}>
    <div className="dshNextPluginActions">
      <Button variant="outline" size="sm" disabled={running} onClick={() => { setOpen(true) }}>
        {translate('更换版本', 'Change version')}
      </Button>
    </div>
    {result === undefined ? null : <span role={result.failed ? 'alert' : 'status'} className={result.failed ? 'dshDesktopSettingsError' : 'dshDesktopSettingsHint'}>{result.text}</span>}
    <Modal open={open} onClose={() => { if (!running) setOpen(false) }}
      title={translate(`更换 ${target.name} 的版本`, `Change the version of ${target.name}`)}
      closeLabel={translate('关闭', 'Close')} className="dshNextPermissionsDialog">
      <div className="dshNextPermissionList">
        <div className="dshNextPermissionRow" role="group" aria-label={translate('当前版本', 'Current version')}>
          <div className="dshNextPermissionCopy">
            <strong>{translate('当前来源', 'Current source')}</strong>
            <p className="dshDesktopSettingsHint">{translate(
              '桌面端不能直接装到一个已安装的包上：这个插件要换版本，会先移除当前版本，再安装你填写的来源；新版本没装上时，原来的来源会自动装回。',
              'The desktop app cannot install over a package it already lists: changing this plugin removes the current version, installs the source below, and installs the previous source again when the new one does not install.',
            )}</p>
            <code className="dshNextMarketSourceUrl">{target.source}</code>
            {target.version === undefined ? null : <span className="dshNextPermissionStatus"><StateDot state="done" />{target.version}</span>}
          </div>
        </div>
        <label className="dshDesktopSettingsField">
          <span>{translate('新版本来源', 'New version source')}</span>
          <input className="dshDesktopSettingsInput" value={spec} disabled={running} autoComplete="off" spellCheck={false}
            placeholder="github:owner/repo#branch · D:\plugins\pkg · https://host/pkg.tgz · name@1.2.3"
            onChange={event => { setSpec(event.currentTarget.value) }} />
          <span className="dshDesktopSettingsHint">{translate(
            'Git 分支、锁定了其他 commit 的 Git 地址、本地目录、tarball 地址，或 name@version。与当前来源相同也可以，用来拉到分支上的新提交。',
            'A Git branch, a Git spec pinned to another commit, a local directory, a tarball URL, or name@version. The current source works too, to fetch the branch\'s latest commit.',
          )}</span>
        </label>
        {steps.map(step => <div key={step} className="dshNextPermissionRow" role="status">
          <div className="dshNextPermissionCopy"><StateDot state="done" /> {translate(STEP_TEXT[step].zh, STEP_TEXT[step].en)}</div>
        </div>)}
        <div className="dshNextPluginActions">
          <Button variant="primary" size="sm" disabled={running || spec.trim() === ''} onClick={() => { void start() }}>
            {running ? translate('正在更换…', 'Changing…') : translate('更换版本', 'Change version')}
          </Button>
          <Button variant="outline" size="sm" disabled={running} onClick={() => { setOpen(false) }}>
            {translate('关闭', 'Close')}
          </Button>
        </div>
      </div>
    </Modal>
  </div>
}
