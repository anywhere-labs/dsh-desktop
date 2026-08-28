import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts'],
    // This patched host package is exercised with a mocked node:fs/promises.
    // Keep it in Vitest's module graph so the builtin mock reaches its imports.
    server: {
      deps: {
        inline: ['@deepseek-ai/dsh-host-directory-picker-browse'],
      },
    },
    // Profile integration tests create a full package-junction closure; higher
    // Windows file concurrency makes their latency depend on NTFS/Defender load.
    maxWorkers: process.platform === 'win32' ? 2 : undefined,
  },
})
