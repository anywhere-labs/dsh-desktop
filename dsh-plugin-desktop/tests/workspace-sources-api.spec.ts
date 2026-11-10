import { describe, expect, it } from 'vitest'
import { addDesktopWorkspaceSource } from '../src/client/workspace-sources-api.ts'

const request = (body: string, status: number, contentType = 'application/json') =>
  async (): Promise<Response> => new Response(body, { status, headers: { 'content-type': contentType } })

describe('Workspace sources API errors', () => {
  it('preserves the Host validation reason and HTTP status', async () => {
    await expect(addDesktopWorkspaceSource('/workspace', request(
      JSON.stringify({ error: 'source folders must not overlap' }), 400,
    ))).rejects.toThrow('HTTP 400: source folders must not overlap')
  })

  it('preserves plain-text authorization failures', async () => {
    await expect(addDesktopWorkspaceSource('/workspace', request('forbidden', 403, 'text/plain')))
      .rejects.toThrow('HTTP 403: forbidden')
  })
})
