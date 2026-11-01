import { defineConfig } from 'vite';

const FRONTEND_PORT = 5194;
const BACKEND_PORT = Number(process.env.FORMMORPHEUS_BACKEND_PORT) || 9494;

export default defineConfig({
  root: '.',
  publicDir: 'public',
  server: {
    port: FRONTEND_PORT,
    host: false,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${BACKEND_PORT}`, changeOrigin: true, ws: true },
    },
  },
  preview: {
    port: FRONTEND_PORT + 1,
    host: false,
    strictPort: true,
    proxy: {
      '/api': { target: `http://127.0.0.1:${BACKEND_PORT}`, changeOrigin: true, ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
    // CSS is lowered for Safari 16 (macOS 13 webviews), which makes the minifier write the -webkit-backdrop-filter twins
    cssTarget: ['chrome105', 'safari16', 'firefox110'],
    chunkSizeWarningLimit: 1200,
  },
});
