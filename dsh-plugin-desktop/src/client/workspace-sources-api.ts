/** Same-origin Desktop API for per-Workspace attached source roots. */

export const DESKTOP_WORKSPACE_SOURCES_PATH = '/_dsh/desktop/workspace-sources'

export interface WorkspaceSourcesResponse {
  readonly sources: readonly string[]
  readonly selectedRoot: string
  readonly cancelled?: true
}

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseSources(value: unknown): WorkspaceSourcesResponse {
  if (!isRecord(value)
    || (Object.keys(value).length !== 2 && Object.keys(value).length !== 3)
    || (Object.keys(value).length === 3 && value.cancelled !== true)
    || !Array.isArray(value.sources)
    || value.sources.some(source => typeof source !== 'string' || source.length === 0)
    || typeof value.selectedRoot !== 'string'
    || value.selectedRoot.length === 0) {
    throw new Error('DSH Desktop received an invalid workspace sources response')
  }
  const sources = value.sources as string[]
  if (new Set(sources).size !== sources.length) {
    throw new Error('DSH Desktop received duplicate workspace sources')
  }
  return value.cancelled === true
    ? { sources, selectedRoot: value.selectedRoot, cancelled: true }
    : { sources, selectedRoot: value.selectedRoot }
}

async function readSourcesResponse(response: Response): Promise<WorkspaceSourcesResponse> {
  if (!response.ok) {
    let detail = ''
    try {
      const body = await response.clone().text()
      try {
        const value: unknown = JSON.parse(body)
        if (isRecord(value) && typeof value.error === 'string') detail = value.error.slice(0, 240)
      } catch {
        detail = body.trim().slice(0, 240)
      }
    } catch {}
    throw new Error(`DSH Desktop could not update workspace sources (HTTP ${response.status}${detail ? `: ${detail}` : ''})`)
  }
  return parseSources(await response.json())
}

/** Read attached roots and the selected browser root for one primary Workspace. */
export async function readDesktopWorkspaceSources(
  workspacePath: string,
  request: FetchLike = window.fetch.bind(window),
): Promise<WorkspaceSourcesResponse> {
  const query = `?workspacePath=${encodeURIComponent(workspacePath)}`
  const response = await request(`${DESKTOP_WORKSPACE_SOURCES_PATH}${query}`, {
    method: 'GET',
    headers: { accept: 'application/json' },
  })
  return await readSourcesResponse(response)
}

async function updateWorkspaceSources(
  mutation: object,
  request: FetchLike,
): Promise<WorkspaceSourcesResponse> {
  const response = await request(DESKTOP_WORKSPACE_SOURCES_PATH, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(mutation),
  })
  return await readSourcesResponse(response)
}

/** Attach one source root through the Host-owned native picker. */
export async function addDesktopWorkspaceSource(
  workspacePath: string,
  request: FetchLike = window.fetch.bind(window),
): Promise<WorkspaceSourcesResponse> {
  return await updateWorkspaceSources({ action: 'add', workspacePath }, request)
}

/** Detach or select a source root without changing the Workspace. */
export async function updateDesktopWorkspaceSource(
  action: 'remove' | 'select',
  workspacePath: string,
  sourcePath: string,
  request: FetchLike = window.fetch.bind(window),
): Promise<WorkspaceSourcesResponse> {
  return await updateWorkspaceSources({ action, workspacePath, sourcePath }, request)
}
