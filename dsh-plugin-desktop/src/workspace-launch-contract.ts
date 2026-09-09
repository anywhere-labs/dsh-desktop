/** Private Desktop renderer routes for operator-supplied launch directories. */
export const WORKSPACE_LAUNCH_NEXT = '/_dsh/desktop/workspace-launch/next'
export const WORKSPACE_LAUNCH_COMPLETE = '/_dsh/desktop/workspace-launch/complete'
export interface WorkspaceLaunchRequest { readonly id: string; readonly path: string }
