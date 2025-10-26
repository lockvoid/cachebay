#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks and comparing against baselines..."

BENCH_NAME=infinite-feed pnpm bench:suite:compare bench/suites/infinite-feed.dom.bench.ts

echo "✅ DOM comparison complete! Check results above."
