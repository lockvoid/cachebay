import { defineConfig } from 'vitest/config';
import { URL, fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'happy-dom',

    globals: true,
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
