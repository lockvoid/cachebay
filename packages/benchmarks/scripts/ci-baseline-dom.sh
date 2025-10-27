#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks and saving baselines..."

mkdir -p .bench-results

BENCH_NAME=infinite-feed pnpm bench:dom:baseline bench/dom/infinite-feed.dom.bench.ts
BENCH_NAME=user-profile pnpm bench:dom:baseline bench/dom/user-profile.dom.bench.ts

echo ""
echo "DOM baselines saved to .bench-results"
