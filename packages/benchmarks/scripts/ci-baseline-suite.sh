#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks and saving baselines..."

mkdir -p .bench-results

BENCH_NAME=infinite-feed pnpm bench:suite:baseline bench/suites/infinite-feed.dom.bench.ts
BENCH_NAME=user-profile pnpm bench:suite:baseline bench/suites/user-profile.dom.bench.ts

echo "✅ DOM baselines saved to .bench-results/"
