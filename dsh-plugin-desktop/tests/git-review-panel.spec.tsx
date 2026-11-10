import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { describe, expect, it, vi } from 'vitest'
import { fileAddressFor, sessionFileAddress } from '@deepseek-ai/dsh-util-workspace-path'
import { GitReviewPanel, GitReviewRootSelector, gitReviewFileOpenCoordinates, type GitReviewPanelProps } from '../src/client/GitReviewPanel.tsx'
import {
  createGitReviewDeliverablesRedirectDefinition,
  createGitReviewTabDefinition,
} from '../src/client/git-review-tab.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', () => ({
  IconChevronDownOutlineRegular: () => null,
  IconFolderOpenOutlineRegular: () => null,
  IconPlusOutlineRegular: () => null,
}))

describe('Desktop Git Review guide and turn entry', () => {
  it('contributes an active guide card that opens its Session-scoped page', () => {
    const definition = createGitReviewTabDefinition(key => key)
    expect(definition).toMatchObject({
      id: 'desktop-git-review',
      kind: 'desktop-git-review',
      priority: 'builtin',
      guide: [{ id: 'review', order: 40 }],
    })
    expect(definition.guide?.[0]?.title()).toBe('guideTitle')
    expect(definition.guide?.[0]?.description?.()).toBe('guideDescription')
  })

  it('takes over the upstream changed-files address with the Session-scoped Review page', () => {
    const definition = createGitReviewDeliverablesRedirectDefinition(key => key)
    expect(definition).toMatchObject({
      id: 'desktop-git-review-deliverables-redirect',
      kind: 'desktop-git-review-deliverables-redirect',
      patterns: ['dsh-resource://changes-review/**'],
      priority: 'extension',
    })
    expect(definition.title('dsh-resource://changes-review/session/s1/1/1')).toBe('title')
  })

  it('addresses files relative to the selected root for nested and attached roots', () => {
    const sessionId = 'session-1' as SessionId
    for (const root of ['/home/fate/project/nested-root', '/mnt/shared/project']) {
      const coordinates = gitReviewFileOpenCoordinates(root, 'src/file.ts')
      expect(fileAddressFor(sessionId, coordinates.cwd, coordinates.path))
        .toBe(sessionFileAddress(sessionId, 'src/file.ts'))
    }
  })

  it('renders attached roots and nested worktrees as accessible, styled choices', () => {
    const props = {
      roots: [
        {
          path: '/work/project',
          worktrees: [
            { path: '/work/project', branch: 'main', detached: false, locked: false },
            { path: '/work/project/.worktrees/fix-ui', branch: 'feature/ui', detached: false, locked: false },
          ],
        },
        { path: '/work/shared', worktrees: [] },
        { path: '/work/broken', worktrees: [], error: true },
      ],
      activeRoot: '/work/project/.worktrees/fix-ui',
      primaryRoot: '/work/project',
      expandedRoots: new Set(['/work/project', '/work/broken']),
      onChooseRoot: vi.fn(),
      onToggleRoot: vi.fn(),
      onRetryWorktrees: vi.fn(),
      t: (key: string) => key,
    } as unknown as Parameters<typeof GitReviewRootSelector>[0]

    const markup = renderToStaticMarkup(createElement(GitReviewRootSelector, props))

    expect(markup).toContain('class="dshGitReviewRootTree"')
    expect(markup).toContain('primaryRoot')
    expect(markup).toContain('attachedRoot')
    expect(markup).toContain('feature/ui')
    expect(markup).toContain('aria-expanded="true"')
    expect(markup).toContain('dshGitReviewWorktreeStatus')
    expect(markup).toContain('worktreesUnavailable')
    expect(markup).toContain('retryWorktrees')
    expect(markup).toContain('noWorktrees')
    expect(markup).toContain('aria-current="page"')
  })

  it('renders a loading state while the owner Session Workspace is resolved', () => {
    const props = {
      sessionId: 'session-1' as SessionId,
      useSessions: (select: (value: { byId: Record<string, never> }) => unknown) => select({ byId: {} }),
      client: { workspace: vi.fn(), status: vi.fn(), commitFiles: vi.fn(), lastTurn: vi.fn(), diff: vi.fn() },
      openFile: vi.fn(),
      platform: 'linux',
      t: (key: string) => key,
    } as unknown as GitReviewPanelProps

    const markup = renderToStaticMarkup(createElement(GitReviewPanel, props))
    expect(markup).toContain('role="status"')
    expect(markup).toContain('loading')
  })
})
