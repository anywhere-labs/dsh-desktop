import { defineConfig } from 'vitest/config'

export default defineConfig({ test: { include: ['tests/**/*.spec.ts'], testTimeout: 20_000,
  server: { deps: { inline: ['@deepseek-ai/dsh-experimental-computer-use-cua-driver-native', '@deepseek-ai/dsh-host-open-in-app', '@deepseek-ai/dsh-native-command'] } },
} })
