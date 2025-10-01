import { defineConfig } from 'vitest/config';
import { URL, fileURLToPath } from 'node:url';

export default defineConfig({
  test: {
    environment: 'happy-dom',

    globals: true,

    coverage: {
      provider: "v8",

      reporter: [
        "text",
        "lcov",
      ],

      include: [
        "src/**/*",
      ],
    },
  },

  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./', import.meta.url)),
    },
  },
});
