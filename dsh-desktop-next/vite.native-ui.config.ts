import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  root: fileURLToPath(new URL('./src/native-ui', import.meta.url)),
  base: './',
  plugins: [react(), tailwindcss()],
  // Shared components live in another workspace; hooks must use this renderer's React.
  resolve: { dedupe: ['react', 'react-dom'] },
  // Native documents allow only same-origin assets, including fonts from official UI atoms.
  build: { outDir: fileURLToPath(new URL('./lib/native-ui', import.meta.url)), emptyOutDir: true, assetsInlineLimit: 0 },
})
