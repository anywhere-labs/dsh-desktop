import { AbstractApiClient } from '@deepseek-ai/dsh-host-apiproxy/client'
import { describe, expect, it } from 'vitest'

class AbortIgnoringClient extends AbstractApiClient {
  requestSignal: AbortSignal | undefined

  protected doFetch(_input: URL, init?: RequestInit): Promise<Response> {
    this.requestSignal = init?.signal ?? undefined
    return new Promise<Response>(() => {})
  }
}

describe('Host API prompt deadline', () => {
  it('settles an image prompt when the transport ignores abort', async () => {
    const client = new AbortIgnoringClient(20)

    await expect(client.sessions.prompt({
      sessionId: 'issue-641-session' as never,
      mode: 'queue',
      content: [
        { type: 'image', mediaType: 'image/png', data: 'iVBORw0KGgo=' },
        { type: 'text', text: 'Describe this image.' },
      ],
    })).rejects.toMatchObject({ name: 'TimeoutError' })
    expect(client.requestSignal?.aborted).toBe(true)
  }, 250)
})
