import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/ws': {
        target: 'ws://localhost:2567',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      '@red-attack/shared': new URL('../shared/src', import.meta.url).pathname,
    },
  },
});
