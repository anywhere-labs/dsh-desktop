import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // Retry only a failed loopback connect, so a loaded host cannot fail a spec
    // whose request never reached the server it just started.
    setupFiles: ['./tests/fetch-retry.ts'],
    globalSetup: process.platform === 'win32' ? ['../scripts/prepare-test-electron.mjs'] : [],
    // Keep patched packages in Vitest's module graph so mocks reach their
    // fs/promises and undici imports instead of using the live filesystem/network.
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-host-directory-picker-browse', '@deepseek-ai/dsh-native-command', 'dshmarket'],
      },
    },
    // Profile integration tests create a full package-junction closure; higher
    // Windows file concurrency makes their latency depend on NTFS/Defender load.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
    // A stalled loopback round trip or a slow handshake can exceed the 5s
    // default on a loaded Windows host, without the behavior under test failing.
    testTimeout: process.platform === 'win32' ? 30_000 : undefined,
  },
})
