import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { GIT_REVIEW_TAB_ID, GIT_REVIEW_TAB_KIND } from './GitReviewPanel.tsx'
import type { GitReviewLocaleKey } from './git-review-locales.ts'

export const GIT_REVIEW_DELIVERABLES_REDIRECT_ID = 'desktop-git-review-deliverables-redirect'
export const GIT_REVIEW_DELIVERABLES_REDIRECT_KIND = 'desktop-git-review-deliverables-redirect'

/** Start-page entry and page identity for the Session-scoped Git Review panel. */
export function createGitReviewTabDefinition(t: (key: GitReviewLocaleKey) => string): SidebarRightTabDefinition {
  return {
    id: GIT_REVIEW_TAB_ID,
    kind: GIT_REVIEW_TAB_KIND,
    priority: 'builtin',
    title: () => t('title'),
    guide: [{ id: 'review', order: 40, title: () => t('guideTitle'), description: () => t('guideDescription') }],
  }
}

/**
 * Takes over the address used by the upstream changed-files card while Desktop
 * is composed. The address remains unchanged for compatibility, but the body
 * is our Session-scoped Git Review page and therefore starts at “last turn”.
 */
export function createGitReviewDeliverablesRedirectDefinition(t: (key: GitReviewLocaleKey) => string): SidebarRightTabDefinition {
  return {
    id: GIT_REVIEW_DELIVERABLES_REDIRECT_ID,
    kind: GIT_REVIEW_DELIVERABLES_REDIRECT_KIND,
    patterns: ['dsh-resource://changes-review/**'],
    priority: 'extension',
    title: () => t('title'),
  }
}
