import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    entry: {
      bench: './api/materializeDocument.bench.ts',
    },
  },
  output: {
    target: 'node',
    distPath: {
      root: '.bench-dist',
    },
    minify: false,
    format: 'cjs',
    filename: {
      js: '[name].cjs',
    },
  },
  tools: {
    swc: {
      jsc: {
        parser: {
          syntax: 'typescript',
        },
        experimental: {
          plugins: [
            [
              '@swc/plugin-relay',
              {
                rootDir: __dirname,
                artifactDirectory: './src/__generated__',
              },
            ],
          ],
        },
      },
    },
    rspack: {
      externals: {
        mitata: 'commonjs mitata',
      },
    },
  },
  performance: {
    chunkSplit: {
      strategy: 'all-in-one',
    },
  },
});
