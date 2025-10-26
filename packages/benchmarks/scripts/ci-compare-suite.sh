#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks and comparing against baselines..."

BENCH_NAME=nested-query pnpm bench:suite:compare bench/suites/nested-query.dom.bench.ts

echo "✅ DOM comparison complete! Check results above."
