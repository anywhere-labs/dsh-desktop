import { defineStore } from '@deepseek-ai/dsh-client-store'
import type { WorkspaceSourcesResponse } from './workspace-sources-api.ts'

export type WorkspaceSourcesSnapshot = WorkspaceSourcesResponse
export type WorkspaceSourcesState = Record<string, WorkspaceSourcesSnapshot>

/** Declare one slot's source snapshot store; each slot scope mounts its own handle. */
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
