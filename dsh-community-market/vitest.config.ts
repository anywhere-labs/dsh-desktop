import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.{ts,tsx}'],
    // Retry only a failed loopback connect, so a loaded host cannot fail a spec
    // whose request never reached the server it just started.
    setupFiles: ['./tests/fetch-retry.ts', './tests/setup.tsx'],
    // Route and asset specs open loopback listeners; one file at a time on
    // Windows keeps their latency independent of socket-table contention.
    maxWorkers: process.platform === 'win32' ? 1 : undefined,
    // A stalled loopback round trip can exceed the 5s default on a loaded
    // Windows host, without the behavior under test failing.
    testTimeout: process.platform === 'win32' ? 30_000 : undefined,
  },
})
