import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import relay from 'vite-plugin-relay';

export default defineConfig(({ mode }) => ({
  mode: mode || 'production',

  globals: true,

  plugins: [
    react(),
    relay,
  ],

  esbuild: {
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
      headless: true,
    },

    include: [
      'bench/dom/**/*.bench.ts',
    ],

    benchmark: {
      warmupTime: 150,
      concurrent: false
    },

    reporters: process.env.DEBUG === 'true' ? ['verbose'] : ['default'],
  },
}));
