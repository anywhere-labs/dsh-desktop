import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceSourcesResponse } from './workspace-sources-api.ts'

export type WorkspaceSourcesSnapshot = WorkspaceSourcesResponse
export type WorkspaceSourcesState = Record<string, WorkspaceSourcesSnapshot>

/** Declare the shared, root-scoped source snapshot store for the edit and Files actions. */
export function createWorkspaceSourcesStore() {
  return defineStore({
    init: (): WorkspaceSourcesState => ({}),
    actions: {
      publish(draft, workspacePath: string, snapshot: WorkspaceSourcesSnapshot) {
        draft[workspacePath] = snapshot
      },
    },
  })
}

export type WorkspaceSourcesStore = ReturnType<typeof createWorkspaceSourcesStore>
