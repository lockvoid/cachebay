#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks and comparing against baselines..."

BENCH_NAME=infinite-feed pnpm bench:dom:compare bench/dom/infinite-feed.dom.bench.ts
BENCH_NAME=user-profile pnpm bench:dom:compare bench/dom/user-profile.dom.bench.ts

echo "✅ DOM comparison complete! Check results above."
