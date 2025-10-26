#!/bin/bash
set -e

echo "⚡ Running API benchmarks and comparing against baselines..."

BENCH_FILE=normalizeDocument pnpm bench:api:compare
BENCH_FILE=materializeDocument pnpm bench:api:compare
BENCH_FILE=readQuery pnpm bench:api:compare
BENCH_FILE=watchQuery pnpm bench:api:compare

echo "✅ API comparison complete! Results in .bench-results/api-current.txt"
