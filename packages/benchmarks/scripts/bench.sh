#!/bin/bash
# Quick benchmark runner
# Usage: pnpm bench api/readQuery.bench.ts

if [ -z "$1" ]; then
  echo "Usage: pnpm bench <file>"
  exit 1
fi

BENCH_FILE="$1"

# Update rsbuild config entry point
cat > rsbuild.config.ts.tmp << EOF
import { defineConfig } from '@rsbuild/core';

export default defineConfig({
  source: {
    entry: {
      bench: './${BENCH_FILE}',
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
EOF

mv rsbuild.config.ts.tmp rsbuild.config.ts

# Run relay compiler
pnpm relay

# Build and run
rsbuild build --config rsbuild.config.ts
NODE_ENV=production node .bench-dist/bench.cjs
