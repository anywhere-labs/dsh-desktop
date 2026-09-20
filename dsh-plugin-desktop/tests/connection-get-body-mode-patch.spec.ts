import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-client-connection@0.1.5-rc.2.patch',
  import.meta.url,
), 'utf8')

describe('connection GET/HEAD body-mode patch (#962)', () => {
  it('never hands undici a GET/HEAD Request with a body', () => {
    for (const marker of [
      'const effectiveBodyMode = method === "GET" || method === "HEAD" ? "buffered" : bodyMode;',
      'if (effectiveBodyMode === "buffered") {',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('defaults undeclared GET/HEAD routes to buffered at registration', () => {
    expect(patch).toContain('requestBody: route.requestBody ?? (methods.has("GET") || methods.has("HEAD") ? "buffered" : "streaming")')
  })

  it('exposes requestBody as optional so plugin authors can compile against it', () => {
    expect(patch).toContain('readonly requestBody?: ConnectionRequestBodyMode')
  })
})
