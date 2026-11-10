import { useEffect, useState } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-files/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { InjectFace, PropsLocale, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconChevronDownOutlineRegular,
  IconCloseOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconPlusOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  addDesktopWorkspaceSource,
  readDesktopWorkspaceSources,
  updateDesktopWorkspaceSource,
} from './workspace-sources-api.ts'
import type { WorkspaceSourcesResponse } from './workspace-sources-api.ts'
import {
  createWorkspaceRootSelection,
  createWorkspaceSourcesQueue,
  workspaceRootForPath,
} from './workspace-root-selection.ts'
import { createWorkspaceSourcesStore } from './workspace-sources-store.ts'
import type { WorkspaceSourcesStore } from './workspace-sources-store.ts'
import { installWorkspaceSourcesStyles } from './workspace-sources-styles.ts'

const classes = {
  editor: 'dshWorkspaceSourcesEditor',
  editorHeader: 'dshWorkspaceSourcesEditorHeader',
  editorHeading: 'dshWorkspaceSourcesEditorHeading',
  editorTitle: 'dshWorkspaceSourcesEditorTitle',
  note: 'dshWorkspaceSourcesNote',
  windowsNote: 'dshWorkspaceSourcesWindowsNote',
  status: 'dshWorkspaceSourcesStatus',
  error: 'dshWorkspaceSourcesError',
  folderList: 'dshWorkspaceSourcesFolderList',
  folderRow: 'dshWorkspaceSourcesFolderRow',
  primaryRow: 'dshWorkspaceSourcesPrimaryRow',
  attachedRow: 'dshWorkspaceSourcesAttachedRow',
  folderIconWrap: 'dshWorkspaceSourcesFolderIconWrap',
  folderIcon: 'dshWorkspaceSourcesFolderIcon',
  folderDetails: 'dshWorkspaceSourcesFolderDetails',
  folderName: 'dshWorkspaceSourcesFolderName',
  folderPath: 'dshWorkspaceSourcesFolderPath',
  primary: 'dshWorkspaceSourcesPrimaryBadge',
  attached: 'dshWorkspaceSourcesAttachedBadge',
  add: 'dshWorkspaceSourcesAdd',
  detach: 'dshWorkspaceSourcesDetach',
  empty: 'dshWorkspaceSourcesEmpty',
  emptyIcon: 'dshWorkspaceSourcesEmptyIcon',
  rootAction: 'dshWorkspaceSourcesRootAction',
  rootActionIcon: 'dshWorkspaceSourcesRootActionIcon',
  rootActionChevron: 'dshWorkspaceSourcesRootActionChevron',
  rootSelect: 'dshWorkspaceSourcesRootSelect',
} as const

type PublishWorkspaceSources = (
  workspacePath: string,
  snapshot: WorkspaceSourcesResponse,
) => void

type LoadWorkspaceSources = (
  workspacePath: string,
  publish: PublishWorkspaceSources,
) => Promise<void>

type MutateWorkspaceSources = (
  workspacePath: string,
  sourcePath: string | undefined,
  publish: PublishWorkspaceSources,
) => Promise<void>

interface WorkspaceSourcesBaseInjected {
  readonly platform: string
  readonly load: LoadWorkspaceSources
}

interface WorkspaceSourcesEditorInjected extends WorkspaceSourcesBaseInjected {
  readonly add: LoadWorkspaceSources
  readonly remove: MutateWorkspaceSources
}

interface WorkspaceSourcesRootActionInjected extends WorkspaceSourcesBaseInjected {
  readonly selectRoot: ReturnType<typeof createWorkspaceRootSelection>
}

export type WorkspaceSourcesEditorProps = PropsRuntime<'sidebar.workspaces.workspace.edit'>
  & PropsLocale<'desktop.settings'>
  & PropsStore<WorkspaceSourcesStore>
  & InjectFace<WorkspaceSourcesEditorInjected>

export type WorkspaceSourcesRootActionProps = Omit<PropsRuntime<'sidebar.right.tab.files.actions'>, 'useSession' | 'sessionId' | 'useProjection'>
  & PropsLocale<'desktop.settings'>
  & PropsStore<WorkspaceSourcesStore>
  & InjectFace<WorkspaceSourcesRootActionInjected>
  & { readonly workspacePath?: string; readonly onRootChange?: (path: string) => Promise<void> }

function basename(path: string): string {
  const parts = path.split(/[\\/]/u).filter(Boolean)
  return parts.at(-1) ?? path
}

function displayRoot(path: string, primary: boolean, t: WorkspaceSourcesRootActionProps['t']): string {
  const kind = primary ? t('workspaceSourcesPrimary') : t('workspaceSourcesAttached')
  return `${kind} · ${basename(path)}`
}

function describeFailure(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Manage Desktop-owned additional roots from the browser-owned Workspace Edit dialog. */
export function WorkspaceSourcesEditor({ path, t, actions, platform, useStore, load, add, remove }: WorkspaceSourcesEditorProps) {
  const snapshot = useStore(state => state[path])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  const publish = actions.publish

  useEffect(() => {
    let active = true
    void load(path, publish).then(() => {
      if (active) setFailure(undefined)
    }).catch(error => {
      if (active) setFailure(describeFailure(error))
    })
    return () => { active = false }
  }, [load, path, publish])

  const run = (operation: () => Promise<void>): void => {
    setBusy(true)
    setFailure(undefined)
    void operation().catch(error => setFailure(describeFailure(error))).finally(() => setBusy(false))
  }
  const sources = snapshot?.sources ?? []

  return (
    <section className={classes.editor} aria-label={t('workspaceSources')}>
      <div className={classes.editorHeader}>
        <div className={classes.editorHeading}>
          <h3 className={classes.editorTitle}>{t('workspaceSources')}</h3>
          <p className={classes.note}>{t('workspaceSourcesNote')}</p>
        </div>
        {platform !== 'win32' && (
          <button
            type="button"
            className={classes.add}
            disabled={busy || snapshot === undefined}
            onClick={() => { void run(() => add(path, publish)) }}
          >
            <IconPlusOutlineRegular aria-hidden="true" />
            <span>{t('workspaceSourcesAdd')}</span>
          </button>
        )}
      </div>

      {platform === 'win32' && <p className={classes.windowsNote}>{t('workspaceSourcesWindowsNote')}</p>}
      {snapshot === undefined
        ? <p className={classes.status} role="status">{t('workspaceSourcesLoading')}</p>
        : (
          <ul className={classes.folderList} aria-label={t('workspaceSourcesList')}>
            <li className={`${classes.folderRow} ${classes.primaryRow}`} title={path}>
              <span className={classes.folderIconWrap} aria-hidden="true"><IconFolderOpenOutlineRegular className={classes.folderIcon} /></span>
              <span className={classes.folderDetails}>
                <span className={classes.folderName}>{basename(path)}</span>
                <span className={classes.folderPath}>{path}</span>
              </span>
              <span className={classes.primary}>{t('workspaceSourcesPrimary')}</span>
            </li>
            {sources.map(source => (
              <li key={source} className={`${classes.folderRow} ${classes.attachedRow}`} title={source}>
                <span className={classes.folderIconWrap} aria-hidden="true"><IconFolderOpenOutlineRegular className={classes.folderIcon} /></span>
                <span className={classes.folderDetails}>
                  <span className={classes.folderName}>{basename(source)}</span>
                  <span className={classes.folderPath}>{source}</span>
                </span>
                <span className={classes.attached}>{t('workspaceSourcesAttached')}</span>
                <button
                  type="button"
                  className={classes.detach}
                  aria-label={`${t('workspaceSourcesDetach')}: ${source}`}
                  title={t('workspaceSourcesDetach')}
                  disabled={busy}
                  onClick={() => { void run(() => remove(path, source, publish)) }}
                >
                  <IconCloseOutlineRegular aria-hidden="true" />
                </button>
              </li>
            ))}
            {sources.length === 0 && (
              <li className={classes.empty}>
                <span className={classes.emptyIcon} aria-hidden="true"><IconFolderOpenOutlineRegular /></span>
                <span>{t('workspaceSourcesEmpty')}</span>
              </li>
            )}
          </ul>
        )}
      {busy && <p className={classes.status} role="status">{t('workspaceSourcesWorking')}</p>}
      {failure !== undefined && <p className={classes.error} role="alert">{t('workspaceSourcesActionFailed')} <span>{failure}</span></p>}
    </section>
  )
}

/** Switch only the Files tree root; the Workspace identity and Session cwd remain untouched. */
export function WorkspaceSourcesRootAction({
  absolutePath,
  t,
  actions,
  platform,
  load,
  selectRoot,
  useStore,
}: WorkspaceSourcesRootActionProps) {
  // The supported Files action owner exposes the current absolute root only.
  // Persist source selection against that root; the next Files mount adopts it.
  const workspacePath = absolutePath
  const snapshot = useStore(state => state[workspacePath])
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  const publish = actions.publish

  useEffect(() => {
    let active = true
    void load(workspacePath, publish).then(() => {
      if (active) setFailure(undefined)
    }).catch(error => {
      if (active) setFailure(describeFailure(error))
    })
    return () => { active = false }
  }, [load, publish, workspacePath])

  const roots = platform === 'win32'
    ? [workspacePath]
    : [workspacePath, ...(snapshot?.sources ?? [])]
  const currentRoot = workspaceRootForPath(absolutePath, roots, platform)
  const selectedRoot = platform !== 'win32' && snapshot !== undefined && roots.includes(snapshot.selectedRoot)
    ? snapshot.selectedRoot
    : workspacePath

  const changeRoot = (root: string): void => {
    setBusy(true)
    setFailure(undefined)
    void selectRoot(workspacePath, root, async () => {}, value => publish(workspacePath, value))
      .catch(error => { setFailure(describeFailure(error)) })
      .finally(() => { setBusy(false) })
  }

  return (
    <>
      <label className={classes.rootAction} title={currentRoot ?? workspacePath}>
        <span aria-hidden="true"><IconFolderOpenOutlineRegular className={classes.rootActionIcon} /></span>
        <select
          className={classes.rootSelect}
          aria-label={t('workspaceSourcesBrowse')}
          value={selectedRoot}
          disabled={busy || snapshot === undefined}
          onChange={event => { changeRoot(event.currentTarget.value) }}
        >
          {roots.map((root, index) => (
            <option key={root} value={root}>
              {displayRoot(root, index === 0, t)}
            </option>
          ))}
        </select>
        <span aria-hidden="true"><IconChevronDownOutlineRegular className={classes.rootActionChevron} /></span>
      </label>
      {busy && <span className={classes.status} role="status">{t('workspaceSourcesWorking')}</span>}
      {failure !== undefined && (
        <span className={classes.error} role="alert">
          {t('workspaceSourcesActionFailed')} {failure}
        </span>
      )}
    </>
  )
}

export type { WorkspaceSourcesResponse }

/** Register the same source snapshot at the Workspace editor and Files toolbar. */
export function applyDesktopWorkspaceSources(ctx: ClientContext, platform: string): void {
  ctx.effect(() => installWorkspaceSourcesStyles('dsh-plugin-desktop'), 'dsh-plugin-desktop: Workspace Sources styles')
  const store = createWorkspaceSourcesStore()
  const queue = createWorkspaceSourcesQueue()
  const load: LoadWorkspaceSources = (workspacePath, publishSnapshot) =>
    queue(workspacePath, async () => {
      publishSnapshot(workspacePath, await readDesktopWorkspaceSources(workspacePath))
    })
  const add: LoadWorkspaceSources = (workspacePath, publishSnapshot) =>
    queue(workspacePath, async () => {
      publishSnapshot(workspacePath, await addDesktopWorkspaceSource(workspacePath))
    })
  const remove: MutateWorkspaceSources = (workspacePath, sourcePath, publishSnapshot) => {
    if (sourcePath === undefined) return Promise.reject(new Error('missing Workspace source path'))
    return queue(workspacePath, async () => {
      publishSnapshot(workspacePath, await updateDesktopWorkspaceSource('remove', workspacePath, sourcePath))
    })
  }
  const selectRoot = createWorkspaceRootSelection(
    readDesktopWorkspaceSources,
    updateDesktopWorkspaceSource,
    queue,
  )
  const editorInjected = () => ({ platform, load, add, remove })
  const rootActionInjected = () => ({ platform, load, selectRoot })

  ctx.slots.inject('sidebar.workspaces.workspace.edit', () => ctx.slots.register({
    name: 'sidebar.workspaces.workspace.edit',
    locale: 'desktop.settings',
    store,
    inject: editorInjected,
  }, WorkspaceSourcesEditor))
  ctx.slots.inject('sidebar.right.tab.files.actions', () => ctx.slots.register({
    name: 'sidebar.right.tab.files.actions',
    id: 'desktop-workspace-sources',
    order: 100,
    locale: 'desktop.settings',
    store,
    inject: rootActionInjected,
  }, WorkspaceSourcesRootAction))
}
