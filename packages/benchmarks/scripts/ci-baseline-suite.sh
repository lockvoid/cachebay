#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks and saving baselines..."

mkdir -p .bench-results

BENCH_NAME=nested-query pnpm bench:suite:baseline bench/suites/nested-query.dom.bench.ts

echo "✅ DOM baselines saved to .bench-results/nested-query-baseline.json"
