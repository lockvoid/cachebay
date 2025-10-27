// vitest.bench.dom.config.ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import relay from 'vite-plugin-relay';

export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    relay,            // ← no parentheses
  ],
  mode: mode || 'production',
  esbuild: {
    // Force production optimizations
    minify: true,
    treeShaking: true,
  },
  build: {
    minify: 'esbuild',
    target: 'esnext',
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    '__DEV__': false,
  },
  resolve: {
    conditions: ['production', 'default'],
  },
  optimizeDeps: {
    exclude: ['node:http', 'node:buffer', 'node:stream'],
  },
  test: {
    browser: {
      enabled: true,
      name: 'chromium',
      provider: 'playwright',
      headless: process.env.HEADLESS !== 'false', // Set HEADLESS=false to see browser
    },
    globals: true,
    include: ['suites/**/*.dom.bench.ts'],
    benchmark: { time: 300, warmupTime: 150, minSamples: 5, concurrent: false },
    silent: false,  // Allow console output
    reporters: process.env.DEBUG === 'true' ? ['verbose'] : ['default'],
  },
}));
