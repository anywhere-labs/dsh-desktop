export interface VideoAssetInput {
  assetId: string
  kind: string
  name: string
  mimeType: string
  size: number
  authorized: boolean
}

export interface VideoGenerationRequest {
  providerId?: string
  model?: string
  workspaceId?: string
  projectId: string
  node: string
  idempotencyKey: string
  confirmed: boolean
  approvalId: string
  prompt: string
  assets: VideoAssetInput[]
  settings: Record<string, unknown>
}

export interface VideoJob {
  runId?: string
  state?: string
  output?: unknown
  outputUrl?: string
  error?: string
  detail?: string | string[]
  artifacts?: Array<{ artifactType: string; uri: string; qaStatus: string; metadata?: unknown }>
}

export interface ProviderDescriptor {
  providerId: string
  displayName: string
  enabled?: boolean
  models?: Array<{ modelKey: string; displayName: string }>
}

export function createVideoApi(base: string) {
  const url = (path: string) => `${base.replace(/\/$/, '')}${path}`
  async function request(path: string, init?: RequestInit) {
    const response = await fetch(url(path), init)
    const body = await response.json() as Record<string, unknown>
    if (!response.ok) throw new Error(typeof body.detail === 'string' ? body.detail : Array.isArray(body.detail) ? body.detail.join('；') : '视频工作台 API 请求失败')
    return body
  }
  return {
    async capabilities() {
      return request('/api/video-workbench/capabilities') as Promise<{ providers?: ProviderDescriptor[]; platformSpecs?: Record<string, unknown> }>
    },
    async preflight(payload: VideoGenerationRequest) {
      return request('/api/video-workbench/preflight', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) as Promise<{ allowed?: boolean; errors?: string[] }>
    },
    async generate(payload: VideoGenerationRequest) {
      return request('/api/video-workbench/generate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) }) as Promise<VideoJob>
    },
    async job(runId: string) {
      return request(`/api/video-workbench/jobs/${encodeURIComponent(runId)}`) as Promise<VideoJob>
    },
    async artifacts(runId: string) {
      return request(`/api/video-workbench/jobs/${encodeURIComponent(runId)}/artifacts`) as Promise<{ artifacts?: VideoJob['artifacts'] }>
    },
  }
}
