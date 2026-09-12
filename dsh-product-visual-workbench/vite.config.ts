import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: '/product-visual-workbench/',
  server: {
    host: "127.0.0.1",
    port: 3018,
    strictPort: true,
    // The workbench is often kept open across browser history navigation.
    // Disable the dev-only HMR socket so BFCache restores do not report a
    // failed WebSocket as an application error. Refresh still loads changes.
    hmr: false,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.BACKEND_PORT || "3029"}`,
        changeOrigin: true,
      },
    },
  },
});
