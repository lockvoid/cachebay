#!/bin/bash
set -e

echo "⚡ Running API benchmarks and saving baselines..."

mkdir -p .bench-results

BENCH_FILE=normalizeDocument pnpm bench:api:baseline
BENCH_FILE=materializeDocument pnpm bench:api:baseline
BENCH_FILE=readQuery pnpm bench:api:baseline
BENCH_FILE=watchQuery pnpm bench:api:baseline

echo "✅ API baselines saved to .bench-results/api-baseline.txt"
