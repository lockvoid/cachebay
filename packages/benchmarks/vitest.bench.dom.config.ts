// vitest.bench.dom.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import relay from 'vite-plugin-relay';

export default defineConfig({
  plugins: [
    react(),
    relay,            // ← no parentheses
  ],
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['suites/**/*.dom.bench.ts'],
    benchmark: { time: 300, warmupTime: 150, minSamples: 5, concurrent: false },
  },
});
