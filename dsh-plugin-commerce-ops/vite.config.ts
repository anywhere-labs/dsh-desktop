import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/commerce-ops-workbench/',
  server: {
    host: '127.0.0.1',
    port: 3031,
    strictPort: true,
    hmr: false,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:43120',
        changeOrigin: true,
      },
    },
  },
})
