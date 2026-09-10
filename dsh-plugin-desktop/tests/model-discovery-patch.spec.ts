import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const patch = readFileSync(new URL(
  '../../patches/dsh-llm-pi-ai@0.1.5-rc.1.patch',
  import.meta.url,
), 'utf8')

describe('pi-ai model discovery network-first patch', () => {
  it('probes the configured endpoint before answering from the catalog', () => {
    for (const marker of [
      'if (!hasEndpoint || !LISTABLE_PROTOCOLS.has(api)) return catalogAnswer(request, api);',
      'return await probeEndpoint(request, stored, api, url, apiKey);',
      'return mergeCatalogCapacities(readListing(body), request);',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('keeps the catalog as the offline fallback and the capacity enricher', () => {
    for (const marker of [
      'function catalogListing(request) {',
      'function mergeCatalogCapacities(live, request) {',
      'function catalogAnswer(request, api) {',
      'if (installed !== void 0) return installed;',
      '-\t\tif (installed.size > 0) return [...installed.values()].map((model) => ({',
    ]) {
      expect(patch).toContain(marker)
    }
  })

  it('never masks a refused key or a caller abort', () => {
    for (const marker of [
      'error.message.includes("answered 401") || error.message.includes("answered 403")',
      'request.signal?.aborted !== true',
    ]) {
      expect(patch).toContain(marker)
    }
  })
})
