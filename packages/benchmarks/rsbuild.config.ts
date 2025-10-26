import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    entry: {
      bench: './bench/api/index.ts',
    },
  },
  output: {
    target: 'node',
    distPath: {
      root: 'dist',
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
