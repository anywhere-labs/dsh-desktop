import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InjectFace, PropsLocale, PropsRuntime, TranslateNS } from '@deepseek-ai/dsh-client-ui-slots'
import type { GitReviewBranch, GitReviewCommit, GitReviewCommitFiles, GitReviewDiff, GitReviewDiffCategory, GitReviewDiffFile, GitReviewFile, GitReviewLastTurnFile, GitReviewStatus, GitReviewWorkspace, GitReviewWorktree } from '../git-review-contract.ts'
import type { GitReviewClient, GitReviewLastTurnView } from './git-review-api.ts'
import {
  IconChevronDownOutlineRegular,
  IconFolderOpenOutlineRegular,
  IconPlusOutlineRegular,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { addDesktopWorkspaceSource, readDesktopWorkspaceSources } from './workspace-sources-api.ts'
import { GIT_REVIEW_LOCALE_NAMESPACE } from './git-review-locales.ts'
import { formatGitReviewTurnDiff, gitReviewNoteKey, parseGitReviewDiffLines, readGitReviewNotes, statusFromGitReviewTurnDiff, writeGitReviewNotes, type GitReviewNotes } from './git-review-view.ts'

export const GIT_REVIEW_TAB_ID = 'desktop-git-review'
export const GIT_REVIEW_TAB_KIND = 'desktop-git-review'

type Category = 'last-turn' | 'unstaged' | 'untracked' | 'staged' | 'committed' | 'branches'
interface DiffTarget {
  readonly key: string
  readonly category: GitReviewDiffCategory
  readonly path?: string
  readonly index?: number
  readonly commitId?: string
  readonly title: string
}

interface ReviewRootTree {
  readonly path: string
  readonly worktrees: readonly GitReviewWorktree[]
  readonly error?: boolean
}

export interface GitReviewPanelInjected {
  readonly client: GitReviewClient
  readonly openFile: (sessionId: SessionId, cwd: string, path: string) => void
  readonly platform: string
}

export type GitReviewPanelProps = PropsRuntime<'sidebar.right.pane.tab'> & PropsLocale<typeof GIT_REVIEW_LOCALE_NAMESPACE> & InjectFace<GitReviewPanelInjected>

function categoryLabel(category: Category, t: GitReviewPanelProps['t']): string {
  switch (category) {
    case 'last-turn': return t('lastTurn')
    case 'unstaged': return t('unstaged')
    case 'untracked': return t('untracked')
    case 'staged': return t('staged')
    case 'committed': return t('committed')
    case 'branches': return t('branches')
  }
}

function countFor(category: Category, status: GitReviewStatus | undefined, lastTurn: GitReviewLastTurnView | undefined): number {
  switch (category) {
    case 'last-turn': return lastTurn?.filesTotal ?? lastTurn?.files.length ?? 0
    case 'unstaged': return (status?.unstaged.length ?? 0) + (status?.omittedFiles?.unstaged ?? 0)
    case 'untracked': return (status?.untracked.length ?? 0) + (status?.omittedFiles?.untracked ?? 0)
    case 'staged': return (status?.staged.length ?? 0) + (status?.omittedFiles?.staged ?? 0)
    case 'committed': return status?.commits.length ?? 0
    case 'branches': return status?.branches.length ?? 0
  }
}

function omittedStatusFiles(category: Category, status: GitReviewStatus | undefined): number {
  if (status?.omittedFiles === undefined) return 0
  if (category === 'unstaged') return status.omittedFiles.unstaged
  if (category === 'untracked') return status.omittedFiles.untracked
  if (category === 'staged') return status.omittedFiles.staged
  return 0
}

function totalCounts(category: Category, status: GitReviewStatus | undefined, lastTurn: GitReviewLastTurnView | undefined, commitFiles?: GitReviewCommitFiles): { additions: number; deletions: number; count: number } {
  const files: readonly GitReviewFile[] = category === 'last-turn' ? lastTurn?.files ?? []
    : category === 'unstaged' ? status?.unstaged ?? []
      : category === 'untracked' ? status?.untracked ?? []
        : category === 'staged' ? status?.staged ?? []
          : category === 'committed' ? commitFiles?.files ?? [] : []
  return {
    additions: files.reduce((sum, file) => sum + file.additions, 0),
    deletions: files.reduce((sum, file) => sum + file.deletions, 0),
    count: countFor(category, status, lastTurn),
  }
}

function fileDiffText(diff: GitReviewDiff | undefined): string {
  if (diff === undefined) return ''
  if (diff.turnDiff !== undefined) {
    if (diff.turnDiff.kind !== 'text') return ''
    return diff.turnDiff.hunks.map(hunk => `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@\n${hunk.lines.join('\n')}`).join('\n')
  }
  return diff.diff
}

function statusForFile(file: GitReviewFile, category: Category, diff?: GitReviewDiff): string {
  if (category === 'last-turn') return statusFromGitReviewTurnDiff(diff?.turnDiff) ?? 'M'
  if (category === 'untracked') return 'A'
  return file.status || 'M'
}

/** Use the selected root as the resource-address base, not the primary Workspace root. */
export function gitReviewFileOpenCoordinates(root: string, relativePath: string): { cwd: string; path: string } {
  return { cwd: root, path: absoluteFilePath(root, relativePath) }
}

function absoluteFilePath(root: string, relativePath: string): string {
  const separator = root.includes('\\') ? '\\' : '/'
  const base = root.replace(/[\\/]+$/u, '')
  return `${base}${separator}${relativePath.replace(/[\\/]+/gu, separator)}`
}

function fileLabel(file: GitReviewFile): string { return file.display ?? file.path }

function rootLabel(root: string, primaryRoot: string, t: GitReviewPanelProps['t']): string {
  const leaf = root.split(/[\\/]+/u).filter(Boolean).at(-1) ?? root
  return `${root === primaryRoot ? t('primaryRoot') : t('attachedRoot')} — ${leaf}`
}

export function GitReviewRootSelector({
  roots,
  activeRoot,
  primaryRoot,
  expandedRoots,
  onChooseRoot,
  onToggleRoot,
  onRetryWorktrees,
  t,
}: {
  roots: readonly ReviewRootTree[]
  activeRoot: string
  primaryRoot: string
  expandedRoots: ReadonlySet<string>
  onChooseRoot: (root: string) => void
  onToggleRoot: (root: string) => void
  onRetryWorktrees: () => void
  t: TranslateNS<typeof GIT_REVIEW_LOCALE_NAMESPACE>
}) {
  return <nav className="dshGitReviewRootTree" aria-label={t('sourceRoot')}>
    {roots.map(root => {
      const expanded = expandedRoots.has(root.path)
      const worktrees = root.worktrees.filter(worktree => worktree.path !== root.path)
      const containsActive = activeRoot === root.path || worktrees.some(worktree => worktree.path === activeRoot)
      return <div className="dshGitReviewRootNode" data-active={containsActive} key={root.path}>
        <div className="dshGitReviewRootRow">
          <button type="button" className="dshGitReviewRootSelect" aria-current={activeRoot === root.path ? 'page' : undefined}
            title={root.path} onClick={() => onChooseRoot(root.path)}>
            <IconFolderOpenOutlineRegular className="dshGitReviewRootIcon" aria-hidden="true" />
            <span className="dshGitReviewRootDetails">
              <span className="dshGitReviewRootName">{root.path.split(/[\\/]+/u).filter(Boolean).at(-1) ?? root.path}</span>
              <span className="dshGitReviewRootPath">{root.path}</span>
            </span>
            <span className="dshGitReviewRootBadge">{root.path === primaryRoot ? t('primaryRoot') : t('attachedRoot')}</span>
          </button>
          {worktrees.length > 0 && <button type="button" className="dshGitReviewRootToggle" aria-expanded={expanded}
            aria-label={`${expanded ? t('collapseWorktrees') : t('expandWorktrees')}: ${rootLabel(root.path, primaryRoot, t)}`}
            onClick={() => onToggleRoot(root.path)}>
            <IconChevronDownOutlineRegular aria-hidden="true" />
          </button>}
        </div>
        {root.error === true && <div className="dshGitReviewWorktreeStatus" role="alert">
          <span>{t('worktreesUnavailable')}</span>
          <button type="button" className="dshGitReviewWorktreeRetry" onClick={onRetryWorktrees}>{t('retryWorktrees')}</button>
        </div>}
        {root.error !== true && worktrees.length === 0 && <p className="dshGitReviewWorktreeEmpty" role="status">{t('noWorktrees')}</p>}
        {expanded && worktrees.length > 0 && <div className="dshGitReviewRootChildren">
          {worktrees.map(worktree => <button type="button" className="dshGitReviewWorktree" key={worktree.path}
            aria-current={activeRoot === worktree.path ? 'page' : undefined} title={worktree.path}
            onClick={() => onChooseRoot(worktree.path)}>
            <span className="dshGitReviewWorktreeMarker" aria-hidden="true" />
            <span className="dshGitReviewWorktreeDetails">
              <span className="dshGitReviewWorktreeName">{worktree.branch ?? worktree.path.split(/[\\/]+/u).filter(Boolean).at(-1) ?? worktree.path}</span>
              <span className="dshGitReviewWorktreePath">{worktree.path}</span>
            </span>
            {worktree.detached && <span className="dshGitReviewRootBadge">{t('detached')}</span>}
          </button>)}
        </div>}
      </div>
    })}
  </nav>
}

function DiffRows({
  diff, worktreePath, path, scope, notes, activeNoteKey, noteDraft, allowNotes = true,
  onAddNote, onDraftChange, onSaveNote, onCancelNote, t,
}: {
  diff: GitReviewDiff
  worktreePath: string
  path: string
  scope: string
  notes: GitReviewNotes
  activeNoteKey?: string
  noteDraft: string
  allowNotes?: boolean
  onAddNote: (key: string) => void
  onDraftChange: (value: string) => void
  onSaveNote: () => void
  onCancelNote: () => void
  t: GitReviewPanelProps['t']
}): ReactNode {
  if (diff.turnDiff !== undefined && diff.turnDiff.kind !== 'text') {
    return <p className="dshGitReviewStatus">{diff.turnDiff.kind === 'binary' ? t('binary') : t('oversized')}</p>
  }
  const text = fileDiffText(diff)
  if (text.length === 0) return <p className="dshGitReviewStatus">{t('noChanges')}</p>
  const rows = parseGitReviewDiffLines(text)
  return <div className="dshGitReviewDiff" role="table" aria-label={path}>
    {rows.map((row, index) => {
      const line = row.newLine ?? row.oldLine
      const noteKey = line === undefined ? undefined : gitReviewNoteKey(worktreePath, path, line, scope)
      const note = noteKey === undefined ? undefined : notes[noteKey]
      return <div className="dshGitReviewDiffLine" data-kind={row.kind} role="row" key={`${index}:${row.text}`}>
        <span className="dshGitReviewLineNo" role="cell">{row.oldLine ?? ''}</span>
        <span className="dshGitReviewLineNo" role="cell">{row.newLine ?? ''}</span>
        <span role="cell">{allowNotes && line !== undefined && noteKey !== undefined && row.kind !== 'hunk' && row.kind !== 'meta'
          ? <button type="button" className="dshGitReviewLineAdd" aria-label={`${t('addNote')} ${line}`} title={t('addNote')} onClick={() => onAddNote(noteKey)}>+</button> : null}</span>
        <code className="dshGitReviewCode" role="cell">{row.text || ' '}</code>
        {note !== undefined && noteKey !== undefined && line !== undefined && <div className="dshGitReviewNote" role="note">
          <span>{note}</span>
          <button type="button" className="dshGitReviewAction" onClick={() => onAddNote(`remove:${noteKey}`)} aria-label={`${t('removeNote')} ${line}`}>{t('removeNote')}</button>
        </div>}
        {allowNotes && noteKey !== undefined && activeNoteKey === noteKey && <form className="dshGitReviewNote" onSubmit={event => { event.preventDefault(); onSaveNote() }}>
          <textarea autoFocus value={noteDraft} maxLength={4_000} aria-label={t('notePlaceholder')} placeholder={t('notePlaceholder')} onChange={event => onDraftChange(event.currentTarget.value)} />
          <div className="dshGitReviewNoteActions"><button type="submit" disabled={noteDraft.trim().length === 0}>{t('saveNote')}</button><button type="button" onClick={onCancelNote}>{t('cancel')}</button><p className="dshGitReviewNoteLocal">{t('noteLocalOnly')}</p></div>
        </form>}
      </div>
    })}
  </div>
}

export function GitReviewPanel({ sessionId, useSessions, client, openFile, platform, t }: GitReviewPanelProps): ReactNode {
  const sessions = useSessions(snapshot => snapshot.byId)
  const [workspace, setWorkspace] = useState<GitReviewWorkspace>()
  const [rootTrees, setRootTrees] = useState<readonly ReviewRootTree[]>([])
  const [sourceRoots, setSourceRoots] = useState<readonly string[]>([])
  const [treeRefreshVersion, setTreeRefreshVersion] = useState(0)
  const [expandedRoots, setExpandedRoots] = useState<ReadonlySet<string>>(() => new Set())
  const [sourceRoot, setSourceRoot] = useState('')
  const [category, setCategory] = useState<Category>('last-turn')
  const [status, setStatus] = useState<GitReviewStatus>()
  const [commitFiles, setCommitFiles] = useState<GitReviewCommitFiles>()
  const [commitFilesLoading, setCommitFilesLoading] = useState(false)
  const [lastTurn, setLastTurn] = useState<GitReviewLastTurnView>()
  const [workspaceLoading, setWorkspaceLoading] = useState(true)
  const [rootBusy, setRootBusy] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [target, setTarget] = useState<DiffTarget>()
  const [diff, setDiff] = useState<GitReviewDiff>()
  const [diffLoading, setDiffLoading] = useState(false)
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [layout, setLayout] = useState<'single' | 'split'>('single')
  const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set())
  const [notes, setNotes] = useState<GitReviewNotes>(() => readGitReviewNotes())
  const [noteKey, setNoteKey] = useState<string>()
  const [noteDraft, setNoteDraft] = useState('')
  const [notice, setNotice] = useState('')
  const activeRoot = sourceRoot || workspace?.path || ''
  const roots = rootTrees
  const activeRootRef = useRef(activeRoot)
  const rootTreesRef = useRef(rootTrees)
  activeRootRef.current = activeRoot
  rootTreesRef.current = rootTrees
  const categories: readonly Category[] = ['last-turn', 'unstaged', 'untracked', 'staged', 'committed', 'branches']

  useEffect(() => {
    const controller = new AbortController()
    let active = true
    setWorkspaceLoading(true)
    setWorkspace(undefined)
    setRootTrees([])
    setSourceRoots([])
    setExpandedRoots(new Set())
    setSourceRoot('')
    setError('')
    void client.workspace(sessionId, controller.signal).then(async nextWorkspace => {
      const nextSources = await readDesktopWorkspaceSources(nextWorkspace.path)
      if (controller.signal.aborted || !active) return
      const rootPaths = [...new Set([nextWorkspace.path, ...(platform === 'win32' ? [] : nextSources.sources)])]
      setWorkspace(nextWorkspace)
      setSourceRoots(rootPaths)
      setExpandedRoots(new Set([nextWorkspace.path]))
      setSourceRoot(nextWorkspace.path)
    }).catch(cause => {
      if (!controller.signal.aborted && active) setError(cause instanceof Error ? cause.message : t('error'))
    }).finally(() => { if (!controller.signal.aborted && active) setWorkspaceLoading(false) })
    return () => { active = false; controller.abort() }
  }, [client, platform, sessionId, t])

  useEffect(() => {
    if (workspace === undefined || sourceRoots.length === 0) {
      setRootTrees([])
      return
    }
    const controller = new AbortController()
    void Promise.all(sourceRoots.map(async path => {
      try {
        const tree = await client.worktrees(sessionId, path, controller.signal)
        return { path: tree.root, worktrees: tree.worktrees }
      } catch {
        return { path, worktrees: [], error: true }
      }
    })).then(nextTrees => {
      if (controller.signal.aborted) return
      setRootTrees(nextTrees)
      const selectedRoot = activeRootRef.current
      const oldParent = rootTreesRef.current.find(root => root.worktrees.some(worktree => worktree.path === selectedRoot))?.path
      const stillAvailable = sourceRoots.includes(selectedRoot)
        || nextTrees.some(root => root.worktrees.some(worktree => worktree.path === selectedRoot))
      const parentLookupFailed = oldParent !== undefined && nextTrees.some(root => root.path === oldParent && root.error === true)
      if (!stillAvailable && !parentLookupFailed) {
        setSourceRoot(oldParent !== undefined && sourceRoots.includes(oldParent) ? oldParent : workspace.path)
      }
    })
    return () => { controller.abort() }
  }, [client, sessionId, sourceRoots, treeRefreshVersion, workspace])

  useEffect(() => {
    if (workspace === undefined || activeRoot.length === 0) {
      setLoading(false)
      setStatus(undefined)
      setLastTurn(undefined)
      return
    }
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setStatus(undefined)
    setCommitFiles(undefined)
    setCommitFilesLoading(false)
    setLastTurn(undefined)
    setTarget(undefined)
    setDiff(undefined)
    setNoteKey(undefined)
    setNoteDraft('')
    void Promise.all([
      client.status(sessionId, activeRoot, controller.signal),
      client.lastTurn(sessionId, activeRoot, controller.signal),
    ]).then(([nextStatus, nextLastTurn]) => {
      if (controller.signal.aborted) return
      setStatus(nextStatus)
      setLastTurn(nextLastTurn)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('error'))
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => { controller.abort() }
  }, [activeRoot, client, refreshVersion, sessionId, t, workspace])

  const chooseRoot = async (root: string): Promise<void> => {
    if (workspace === undefined || rootBusy || root === activeRoot) return
    setRootBusy(true)
    setError('')
    setSourceRoot(root)
    setCategory('last-turn')
    setTarget(undefined)
    setDiff(undefined)
    setCollapsedKeys(new Set())
    setExpandedRoots(current => new Set([...current, root]))
    setRootBusy(false)
  }

  const addRoot = async (): Promise<void> => {
    if (workspace === undefined || platform === 'win32' || rootBusy) return
    setRootBusy(true)
    setError('')
    try {
      const next = await addDesktopWorkspaceSource(workspace.path)
      if (next.cancelled !== true) {
        setSourceRoots([...new Set([workspace.path, ...(platform === 'win32' ? [] : next.sources)])])
        setSourceRoot(next.selectedRoot)
        setCategory('last-turn')
        setTarget(undefined)
        setDiff(undefined)
        setCollapsedKeys(new Set())
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('rootError'))
    } finally {
      setRootBusy(false)
    }
  }

  useEffect(() => {
    const commitId = category === 'committed' ? target?.commitId : undefined
    if (commitId === undefined || workspace === undefined || activeRoot.length === 0) {
      setCommitFiles(undefined)
      setCommitFilesLoading(false)
      return
    }
    const controller = new AbortController()
    setCommitFiles(undefined)
    setCommitFilesLoading(true)
    void client.commitFiles(sessionId, activeRoot, commitId, controller.signal).then(result => {
      if (!controller.signal.aborted) setCommitFiles(result)
    }).catch(cause => {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('diffUnavailable'))
    }).finally(() => { if (!controller.signal.aborted) setCommitFilesLoading(false) })
    return () => { controller.abort() }
  }, [activeRoot, category, client, sessionId, target?.commitId, refreshVersion, t, workspace])

  useEffect(() => {
    const commitId = category === 'committed' ? target?.commitId : undefined
    if (category === 'branches' || workspace === undefined || activeRoot.length === 0 || (category === 'committed' && commitId === undefined)) {
      setDiff(undefined)
      setDiffLoading(false)
      return
    }
    const controller = new AbortController()
    setDiff(undefined)
    setDiffLoading(true)
    void client.diff({ sessionId, sourceRoot: activeRoot, category, ...(commitId === undefined ? {} : { commitId }), signal: controller.signal })
      .then(result => { if (!controller.signal.aborted) setDiff(result) })
      .catch(cause => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t('diffUnavailable')) })
      .finally(() => { if (!controller.signal.aborted) setDiffLoading(false) })
    return () => { controller.abort() }
  }, [activeRoot, category, client, sessionId, target?.commitId, refreshVersion, t, workspace])

  useEffect(() => { writeGitReviewNotes(notes) }, [notes])
  const files: readonly GitReviewFile[] = category === 'last-turn' ? lastTurn?.files ?? []
    : category === 'unstaged' ? status?.unstaged ?? []
      : category === 'untracked' ? status?.untracked ?? []
        : category === 'staged' ? status?.staged ?? []
          : category === 'committed' ? commitFiles?.files ?? [] : []
  const diffByPath = useMemo(() => new Map<string, GitReviewDiff>((diff?.files ?? []).map((item: GitReviewDiffFile) => [item.path, {
    diff: item.diff ?? '', ...(item.turnDiff === undefined ? {} : { turnDiff: item.turnDiff }),
  }] as const)), [diff])
  const totals = totalCounts(category, status, lastTurn, commitFiles)
  const isFileCategory = category === 'last-turn' || category === 'unstaged' || category === 'untracked' || category === 'staged'
    || (category === 'committed' && target?.commitId !== undefined)
  const keyForFile = (index: number, file: GitReviewFile): string => category === 'committed'
    ? `committed:${activeRoot}:${target?.commitId ?? ''}:${index}:${file.path}` : `${activeRoot}:${category}:${index}:${file.path}`
  const countLabel = category === 'committed' ? t('commitCount') : category === 'branches' ? t('branchCount') : t('changes')

  useEffect(() => {
    if (target !== undefined) return
    if (category === 'last-turn') {
      const file = lastTurn?.files[0]
      if (lastTurn?.available && file !== undefined) setTarget({ key: keyForFile(0, file), category: 'last-turn', path: file.path, index: file.sourceIndex, title: file.display })
      return
    }
    if (status === undefined) return
    if (category === 'committed') {
      const commit = status.commits[0]
      if (commit !== undefined) setTarget({ key: `committed:${commit.id}`, category: 'committed', commitId: commit.id, title: commit.subject })
      return
    }
    if (category === 'unstaged' || category === 'untracked' || category === 'staged') {
      const file = category === 'unstaged' ? status.unstaged[0] : category === 'untracked' ? status.untracked[0] : status.staged[0]
      if (file !== undefined) setTarget({ key: keyForFile(0, file), category, path: file.path, title: fileLabel(file) })
    }
  }, [category, lastTurn, status, target])

  useEffect(() => {
    if (category !== 'committed' || target?.commitId === undefined || target.path !== undefined
      || commitFiles?.commitId !== target.commitId || commitFiles.files.length === 0) return
    const file = commitFiles.files[0]
    if (file === undefined) return
    const key = keyForFile(0, file)
    setTarget({ key, category: 'committed', commitId: target.commitId, path: file.path, title: fileLabel(file) })
  }, [category, commitFiles, target])

  const selectCategory = (next: Category): void => { setCategory(next); setTarget(undefined); setDiff(undefined); setError(''); setCollapsedKeys(new Set()); setNoteKey(undefined); setNoteDraft('') }
  const selectFile = (file: GitReviewFile, index: number): void => {
    const key = keyForFile(index, file)
    const display = fileLabel(file)
    setError('')
    if (target?.key === key) {
      setCollapsedKeys(current => { const next = new Set(current); if (next.has(key)) next.delete(key); else next.add(key); return next })
      return
    }
    setCollapsedKeys(current => { const next = new Set(current); next.delete(key); return next })
    setNoteKey(undefined)
    setNoteDraft('')
    setTarget({ key, category: category as GitReviewDiffCategory, path: file.path,
      ...(category === 'last-turn' ? { index: (file as GitReviewLastTurnFile).sourceIndex } : {}), ...(category === 'committed' && target?.commitId !== undefined ? { commitId: target.commitId } : {}), title: display })
  }
  const toggleAllFiles = (): void => {
    const allCollapsed = files.length > 0 && files.every((file, index) => collapsedKeys.has(keyForFile(index, file)))
    setCollapsedKeys(current => {
      const next = new Set(current)
      for (const [index, file] of files.entries()) {
        const key = keyForFile(index, file)
        if (allCollapsed) next.delete(key)
        else next.add(key)
      }
      return next
    })
  }

  const beginNote = (key: string): void => {
    if (key.startsWith('remove:')) {
      const actualKey = key.slice('remove:'.length)
      setNotes(current => { const next = { ...current }; delete next[actualKey]; return next })
      return
    }
    setNoteKey(key)
    setNoteDraft(notes[key] ?? '')
  }
  const saveNote = (): void => {
    if (noteKey === undefined || noteDraft.trim().length === 0) return
    setNotes(current => ({ ...current, [noteKey]: noteDraft.trim().slice(0, 4_000) }))
    setNoteKey(undefined)
    setNoteDraft('')
    setNotice(t('noteSaved'))
    window.setTimeout(() => setNotice(''), 2_500)
  }

  const selectCommit = (commit: GitReviewCommit): void => {
    setError('')
    setCommitFiles(undefined)
    setCommitFilesLoading(true)
    setCollapsedKeys(new Set())
    setNoteKey(undefined)
    setNoteDraft('')
    setTarget({ key: `committed:${commit.id}`, category: 'committed', commitId: commit.id, title: commit.subject })
  }

  const getFileSession = (file: GitReviewFile): { sessionId: SessionId | undefined; cwd: string; path: string } => {
    const ownerSessionId = category === 'last-turn' ? lastTurn?.sessionId : sessionId
    const ownerSession = ownerSessionId === undefined ? undefined : sessions[ownerSessionId]
    const address = activeRoot.length > 0 ? gitReviewFileOpenCoordinates(activeRoot, file.path) : { cwd: '', path: '' }
    return {
      sessionId: ownerSession === undefined ? undefined : ownerSessionId,
      ...address,
    }
  }

  const doCopy = async (): Promise<void> => {
    const text = category === 'last-turn'
      ? (diff?.files ?? []).map(file => formatGitReviewTurnDiff(file.turnDiff)).filter(Boolean).join('\n')
      : (diff?.files ?? []).map(file => file.diff ?? '').filter(Boolean).join('\n') || diff?.diff || ''
    if (text.length === 0) return
    try {
      await navigator.clipboard.writeText(text)
      setNotice(t('copied'))
    } catch { setNotice(t('copyFailed')) }
    window.setTimeout(() => setNotice(''), 2_500)
  }

  if (workspace === undefined) return <main className="dshGitReview" data-desktop-git-review>
    <p className="dshGitReviewNotice" role={workspaceLoading ? 'status' : undefined}>{workspaceLoading ? t('loading') : error || t('noWorkspace')}</p>
  </main>

  const turnInfo = lastTurn?.available && lastTurn.sessionId !== undefined
    ? t('turnInfo', { session: String(lastTurn.sessionId).slice(0, 8), turn: String(lastTurn.turn ?? 0) }) : ''
  const allFilesCollapsed = files.length > 0 && files.every((file, index) => collapsedKeys.has(keyForFile(index, file)))
  const activeFile = target?.path === undefined ? undefined : files.find(file => file.path === target.path)
  const fileRoot = status?.worktreePath ?? activeRoot
  const noteScope = category === 'last-turn' ? `${activeRoot}:last-turn:${lastTurn?.sessionId ?? ''}:${lastTurn?.seq ?? 0}`
    : category === 'committed' ? `${activeRoot}:committed:${target?.commitId ?? ''}` : `${activeRoot}:${category}`
  const fileHeader = (file: GitReviewFile, index: number): ReactNode => {
    const key = keyForFile(index, file)
    const display = fileLabel(file)
    const selected = target?.key === key
    const session = getFileSession(file)
    const fileDiff = diffByPath.get(file.path) ?? (selected && diff?.files === undefined ? diff : undefined)
    const fileStatus = statusForFile(file, category, fileDiff)
    const expanded = !collapsedKeys.has(key) && (layout === 'single' || selected)
    const sessionReady = fileStatus !== 'D' && session.sessionId !== undefined && session.cwd.length > 0 && sessions[session.sessionId] !== undefined
    return <div className="dshGitReviewFile" key={key}>
      <div className="dshGitReviewFileHeader">
        <button type="button" className="dshGitReviewFileHead" aria-expanded={expanded} onClick={() => selectFile(file, index)}>
          <span className="dshGitReviewChevron" aria-hidden="true">›</span>
          <span className="dshGitReviewFileName" title={display}>{display}</span>
          <span className="dshGitReviewBadges">
            <span className="dshGitReviewAdd">+{file.additions}</span>
            <span className="dshGitReviewDel">−{file.deletions}</span>
            <span className="dshGitReviewBadge">{fileStatus}</span>
          </span>
        </button>
        <button type="button" className="dshGitReviewOpenFile" disabled={!sessionReady} title={!sessionReady ? t('sessionUnavailable') : t('openFile')}
          aria-label={`${t('openFile')}: ${display}`} onClick={() => { if (session.sessionId !== undefined) openFile(session.sessionId, session.cwd, session.path) }}>{t('openFile')}</button>
      </div>
      {!collapsedKeys.has(key) && layout === 'single' && <div className="dshGitReviewDiffWrap">
        {selected && diffLoading && <p className="dshGitReviewStatus" role="status">{t('loadingDiff')}</p>}
        {fileDiff !== undefined && <DiffRows diff={fileDiff} worktreePath={fileRoot} path={file.path} scope={noteScope} notes={notes} {...(noteKey === undefined ? {} : { activeNoteKey: noteKey })} noteDraft={noteDraft} onAddNote={beginNote} onDraftChange={setNoteDraft} onSaveNote={saveNote} onCancelNote={() => setNoteKey(undefined)} t={t} />}
        {fileDiff === undefined && !diffLoading && diff !== undefined && <p className="dshGitReviewStatus">{t('diffOmitted')}</p>}
        {selected && !diffLoading && diff === undefined && !error && <p className="dshGitReviewStatus">{t('diffUnavailable')}</p>}
      </div>}
    </div>
  }

  const targetFileRow = target?.path === undefined ? undefined : files.find((file, index) => keyForFile(index, file) === target.key)
  const targetSession = targetFileRow === undefined ? undefined : getFileSession(targetFileRow)
  const targetDiff = target?.path === undefined ? undefined : diffByPath.get(target.path) ?? (diff?.files === undefined ? diff : undefined)

  return <main className="dshGitReview" data-desktop-git-review data-layout={layout}>
    <header className="dshGitReviewTop">
      <h1 className="dshGitReviewTitle">{t('title')}</h1>
      {status?.repository === true && <>
        <span className="dshGitReviewBranch" title={status.branch ?? ''}>{status.branch ?? '—'}</span>
        {(status.ahead > 0 || status.behind > 0) && <span className="dshGitReviewBranchDelta">
          {status.ahead > 0 && `${t('ahead')} ${status.ahead}`}{status.ahead > 0 && status.behind > 0 ? ' · ' : ''}{status.behind > 0 && `${t('behind')} ${status.behind}`}
        </span>}
      </>}
      <div className="dshGitReviewTotals" aria-label={`${totals.count} ${countLabel}`}>
        <span>{totals.count} {countLabel}</span>{isFileCategory && <><span className="dshGitReviewAdd">+{totals.additions}</span><span className="dshGitReviewDel">−{totals.deletions}</span></>}
      </div>
      <span className="dshGitReviewTopSpacer" />
      <label className="sr-only" htmlFor="dsh-git-review-layout">{t('layout')}</label>
      <select id="dsh-git-review-layout" className="dshGitReviewControl" value={layout} aria-label={t('layout')} onChange={event => setLayout(event.currentTarget.value as 'single' | 'split')}>
        <option value="single">{t('single')}</option><option value="split">{t('split')}</option>
      </select>
    </header>

    {workspaceLoading && <p className="dshGitReviewRootLoading" role="status">{t('loading')}</p>}
    {workspace !== undefined && <section className="dshGitReviewSources" aria-labelledby="dsh-git-review-sources-title">
      <div className="dshGitReviewSourcesHeader">
        <div className="dshGitReviewSourcesHeading">
          <h2 id="dsh-git-review-sources-title" className="dshGitReviewSourcesTitle">{t('sourceRoot')}</h2>
          <span className="dshGitReviewSourcesPath" title={activeRoot}>{activeRoot}</span>
        </div>
        {platform !== 'win32' && <button type="button" className="dshGitReviewAddRoot" onClick={() => { void addRoot() }} disabled={rootBusy || workspaceLoading}>
          <IconPlusOutlineRegular aria-hidden="true" />{t('addRoot')}
        </button>}
      </div>
      <GitReviewRootSelector
        roots={roots}
        activeRoot={activeRoot}
        primaryRoot={workspace.path}
        expandedRoots={expandedRoots}
        onChooseRoot={root => { void chooseRoot(root) }}
        onToggleRoot={root => setExpandedRoots(current => {
          const next = new Set(current)
          if (next.has(root)) next.delete(root)
          else next.add(root)
          return next
        })}
        onRetryWorktrees={() => setTreeRefreshVersion(value => value + 1)}
        t={t}
      />
    </section>}

    <div className="dshGitReviewToolbar">
      <label className="sr-only" htmlFor="dsh-git-review-category">{t('category')}</label>
      <select id="dsh-git-review-category" className="dshGitReviewScope" value={category} aria-label={t('category')} onChange={event => selectCategory(event.currentTarget.value as Category)}>
        {categories.map(item => <option key={item} value={item}>{categoryLabel(item, t)} · {countFor(item, status, lastTurn)}</option>)}
      </select>
      <span className="dshGitReviewTopSpacer" />
      <button type="button" className="dshGitReviewAction" onClick={toggleAllFiles} disabled={!isFileCategory || files.length === 0}>{allFilesCollapsed ? t('expandAll') : t('collapseAll')}</button>
      <button type="button" className="dshGitReviewAction" onClick={() => { setRefreshVersion(value => value + 1); setTreeRefreshVersion(value => value + 1); setError('') }}>{t('refresh')}</button>
      <button type="button" className="dshGitReviewAction" onClick={() => { void doCopy() }} disabled={diff === undefined || diffLoading}>{t('copyAll')}</button>
    </div>
    {category === 'last-turn' && turnInfo.length > 0 && <div className="dshGitReviewMeta"><strong>{t('lastTurn')}</strong><span>{turnInfo}</span><span>{new Date(lastTurn?.time ?? 0).toLocaleString()}</span></div>}
    {category === 'last-turn' && (lastTurn?.omittedFiles ?? 0) > 0 && <p className="dshGitReviewNotice" role="note">
      {t('turnFilesOmitted', { shown: String(lastTurn?.files.length ?? 0), total: String(lastTurn?.filesTotal ?? 0), omitted: String(lastTurn?.omittedFiles ?? 0) })}
    </p>}
    {omittedStatusFiles(category, status) > 0 && <p className="dshGitReviewNotice" role="note">
      {t('statusFilesOmitted', { total: String(countFor(category, status, lastTurn)), shown: String(files.length), omitted: String(omittedStatusFiles(category, status)) })}
    </p>}
    {loading && <p className="dshGitReviewNotice" role="status">{t('loading')}</p>}
    {error && <p className="dshGitReviewNotice" role="alert">{error}</p>}
    {status?.repository === false && category !== 'last-turn' && <p className="dshGitReviewNotice">{t('noRepository')}</p>}

    {(status?.repository === true || category === 'last-turn') && <section className="dshGitReviewBody">
      <div className="dshGitReviewList">
        {category === 'committed' && (status?.commits ?? []).map((commit: GitReviewCommit) => <button type="button" key={commit.id} className="dshGitReviewCommit" onClick={() => selectCommit(commit)} aria-pressed={target?.commitId === commit.id}>
          <span className="dshGitReviewCommitSubject">{commit.subject}</span><span className="dshGitReviewCommitMeta">{commit.id.slice(0, 8)} · {commit.author}</span>
        </button>)}
        {category === 'committed' && commitFilesLoading && <p className="dshGitReviewStatus" role="status">{t('loading')}</p>}
        {category === 'branches' && (status?.branches ?? []).map((branch: GitReviewBranch) => <div className="dshGitReviewBranch" key={branch.name}>
          <span className="dshGitReviewCommitSubject">{branch.current ? '✓ ' : ''}{branch.name}</span>{branch.remote && <span className="dshGitReviewBadge">{t('remote')}</span>}{branch.current && <span className="dshGitReviewBadge">{t('current')}</span>}
        </div>)}
        {isFileCategory && files.length > 0 && <div className="dshGitReviewFiles">{files.map(fileHeader)}</div>}
        {((isFileCategory && files.length === 0 && !(category === 'committed' && commitFilesLoading))
          || (category === 'committed' && (status?.commits.length ?? 0) === 0)
          || (category === 'branches' && (status?.branches.length ?? 0) === 0)) && <p className="dshGitReviewStatus">{category === 'last-turn' && lastTurn?.available !== true ? t('noLastTurn') : t('noChanges')}</p>}
      </div>
      {layout === 'split' && <div className="dshGitReviewSide">
        {isFileCategory && target?.path !== undefined && !collapsedKeys.has(target.key) && <>
          <div className="dshGitReviewMeta"><strong>{target.title}</strong>{activeFile !== undefined && <span className="dshGitReviewAdd">+{activeFile.additions}</span>}{activeFile !== undefined && <span className="dshGitReviewDel">−{activeFile.deletions}</span>}
            {targetSession?.sessionId !== undefined && <button type="button" className="dshGitReviewOpenFile" onClick={() => openFile(targetSession.sessionId as SessionId, targetSession.cwd, targetSession.path)}>{t('openFile')}</button>}</div>
          {diffLoading && <p className="dshGitReviewStatus" role="status">{t('loadingDiff')}</p>}
          {!diffLoading && targetDiff !== undefined && <DiffRows diff={targetDiff} worktreePath={fileRoot} path={target.path} scope={noteScope} notes={notes} {...(noteKey === undefined ? {} : { activeNoteKey: noteKey })} noteDraft={noteDraft} onAddNote={beginNote} onDraftChange={setNoteDraft} onSaveNote={saveNote} onCancelNote={() => setNoteKey(undefined)} t={t} />}
          {!diffLoading && diff !== undefined && targetDiff === undefined && <p className="dshGitReviewStatus">{t('diffOmitted')}</p>}
        </>}
        {target === undefined && <p className="dshGitReviewStatus">{category === 'committed' ? t('selectCommit') : t('selectFile')}</p>}
      </div>}
    </section>}
    {notice.length > 0 && <div className="dshGitReviewToast" role="status">{notice}</div>}
  </main>
}
