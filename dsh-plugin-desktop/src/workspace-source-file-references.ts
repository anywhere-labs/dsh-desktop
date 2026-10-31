import { basename, resolve } from 'node:path'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { FileReferenceCandidate, FileReferenceService } from '@deepseek-ai/dsh-file-reference'
import {
  DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
  DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  DEFAULT_FILE_SEARCH_MAX_RESULTS,
  WorkspaceFileSearch,
} from '@deepseek-ai/dsh-file-reference-local/search'
import type { WorkspaceSourceRoots } from './workspace-source-roots.ts'

/** Hidden query-only path segment used to drill attached roots without creating a model-facing alias. */
export const WORKSPACE_SOURCE_REFERENCE_PREFIX = '.dsh-sources'

const searchConfig = {
  maxResults: DEFAULT_FILE_SEARCH_MAX_RESULTS,
  maxEntries: DEFAULT_FILE_SEARCH_MAX_ENTRIES,
  excludedDirectories: DEFAULT_FILE_SEARCH_EXCLUDED_DIRECTORIES,
}

type FileReferences = Pick<FileReferenceService, 'list'>
type RootedCandidate = FileReferenceCandidate & { readonly referencePath: string }
type RootSearches = Map<string, WorkspaceFileSearch>

/** Extra index lifecycle controls installed with the Desktop file-reference decorator. */
export interface WorkspaceSourceFileReferencesInstallation {
  /** Invalidate attached-root indexes after a completed tool result. */
  invalidate(agent: Agent): void
  /** Release an Agent's cached attached-root indexes. */
  disposeAgent(agent: Agent): void
  /** Restore the original provider and release every cached index. */
  dispose(): void
}

/**
 * Add candidates from Host-authorized attached roots to the existing `@` provider.
 * Relative user queries keep their original primary-root semantics; attached-root
 * drill paths are temporary `.dsh-sources/<alias>/…` queries, while selected file
 * mentions carry the canonical absolute path to keep reads stable across tab root switches.
 * @param fileReferences - composed Host file-reference provider.
 * @param sourceRoots - Host-owned Workspace-to-root associations.
 * @param platform - runtime platform; Windows attachments remain unsupported.
 * @returns cache lifecycle controls and a disposer that restores the provider.
 */
export function installWorkspaceSourceFileReferences(
  fileReferences: FileReferences,
  sourceRoots: WorkspaceSourceRoots,
  platform: NodeJS.Platform = process.platform,
): WorkspaceSourceFileReferencesInstallation {
  const descriptor = Object.getOwnPropertyDescriptor(fileReferences, 'list')
  const originalList = fileReferences.list.bind(fileReferences)
  const searches = new Map<Agent, RootSearches>()
  let disposed = false

  const rootsForAgent = (agent: Agent): readonly { root: string; alias: string; queryRoot: string }[] => {
    if (platform === 'win32') return []
    const primaryRoot = agent.session.header.cwd
    if (primaryRoot === undefined) return []
    let roots: readonly string[]
    try {
      roots = sourceRoots.attachedRoots(primaryRoot)
    } catch {
      return []
    }
    const used = new Set<string>()
    const entries = roots.map((root) => {
      const name = basename(root) || root
      let alias = name
      let ordinal = 2
      while (used.has(alias)) {
        alias = `${name} (${String(ordinal)})`
        ordinal += 1
      }
      used.add(alias)
      return { root, alias, queryRoot: `${WORKSPACE_SOURCE_REFERENCE_PREFIX}/${alias}` }
    })
    const live = new Set(entries.map(entry => entry.root))
    const current = searches.get(agent)
    if (current !== undefined) {
      for (const [root, search] of current) {
        if (live.has(root)) continue
        search.dispose()
        current.delete(root)
      }
    }
    return entries
  }

  const searchFor = (agent: Agent, root: string): WorkspaceFileSearch => {
    let perRoot = searches.get(agent)
    if (perRoot === undefined) {
      perRoot = new Map()
      searches.set(agent, perRoot)
    }
    let search = perRoot.get(root)
    if (search === undefined) {
      search = new WorkspaceFileSearch(root, searchConfig)
      perRoot.set(root, search)
    }
    return search
  }

  const rootCandidate = (entry: { root: string; alias: string; queryRoot: string }): RootedCandidate => ({
    path: entry.queryRoot,
    referencePath: entry.root,
    kind: 'directory',
  })

  const rootedCandidates = (
    entry: { root: string; alias: string; queryRoot: string },
    candidates: readonly FileReferenceCandidate[],
  ): RootedCandidate[] => candidates.map(candidate => ({
    path: candidate.path === '' ? entry.queryRoot : `${entry.queryRoot}/${candidate.path}`,
    referencePath: candidate.path === '' ? entry.root : resolve(entry.root, candidate.path),
    kind: candidate.kind,
  }))

  const list: FileReferenceService['list'] = async (agent, rawQuery, signal) => {
    signal.throwIfAborted()
    const entries = rootsForAgent(agent)
    if (entries.length === 0) return originalList(agent, rawQuery, signal)

    const query = rawQuery.replaceAll('\\', '/')
    const prefix = `${WORKSPACE_SOURCE_REFERENCE_PREFIX}/`
    if (query === WORKSPACE_SOURCE_REFERENCE_PREFIX || query === prefix) {
      return entries.map(rootCandidate)
    }
    if (query.startsWith(prefix)) {
      const rest = query.slice(prefix.length)
      const slash = rest.indexOf('/')
      const alias = slash < 0 ? rest : rest.slice(0, slash)
      const entry = entries.find(candidate => candidate.alias === alias)
      if (entry === undefined) return []
      if (slash < 0) {
        const candidates = await searchFor(agent, entry.root).list('', signal)
        return [rootCandidate(entry), ...rootedCandidates(entry, candidates)]
      }
      const relativeQuery = rest.slice(slash + 1)
      const candidates = await searchFor(agent, entry.root).list(relativeQuery, signal)
      return rootedCandidates(entry, candidates)
    }

    const primary = await originalList(agent, rawQuery, signal)
    if (query.includes('/')) return primary
    const attached = await Promise.all(entries.map(async (entry) => {
      const root = entry.alias.toLocaleLowerCase('en-US')
      const roots = root.includes(query.toLocaleLowerCase('en-US')) ? [rootCandidate(entry)] : []
      const candidates = await searchFor(agent, entry.root).list(rawQuery, signal)
      return [...roots, ...rootedCandidates(entry, candidates)]
    }))
    return [...primary, ...attached.flat()]
  }

  if (platform !== 'win32') {
    Object.defineProperty(fileReferences, 'list', {
      configurable: true,
      writable: true,
      value: list,
    })
  }

  return {
    invalidate(agent) {
      for (const search of searches.get(agent)?.values() ?? []) search.invalidate()
    },
    disposeAgent(agent) {
      for (const search of searches.get(agent)?.values() ?? []) search.dispose()
      searches.delete(agent)
    },
    dispose() {
      if (disposed) return
      disposed = true
      for (const perRoot of searches.values()) {
        for (const search of perRoot.values()) search.dispose()
      }
      searches.clear()
      if (platform !== 'win32' && fileReferences.list === list) {
        if (descriptor === undefined) delete (fileReferences as { list?: FileReferenceService['list'] }).list
        else Object.defineProperty(fileReferences, 'list', descriptor)
      }
    },
  }
}
