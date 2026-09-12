import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { registerCommerceOpsWorkbenchPage, type CommerceWebServer } from '../src/host/routes.js'

describe('commerce ops workbench page route', () => {
  it('registers the workbench page under a prefix and a redirect for the bare path', () => {
    const registrations: Array<{ kind: 'exact' | 'prefix'; path: string }> = []
    const webServer: CommerceWebServer = {
      port: 43120,
      register: route => { registrations.push({ kind: route.kind, path: route.path }); return () => undefined },
    }
    const disposer = registerCommerceOpsWorkbenchPage(webServer)
    const paths = registrations.map(route => `${route.kind}:${route.path}`)
    expect(paths).toContain('prefix:/commerce-ops-workbench')
    expect(paths).toContain('exact:/commerce-ops-workbench')
    disposer()
  })
})
