#!/bin/bash
set -e

echo "⚡ Running API benchmarks (baseline)..."

mkdir -p .bench-results

pnpm bench:happydom bench/api/normalizeDocument.bench.ts > .bench-results/normalizeDocument-baseline.txt
pnpm bench:happydom bench/api/materializeDocument.bench.ts > .bench-results/materializeDocument-baseline.txt
pnpm bench:happydom bench/api/readQuery.bench.ts > .bench-results/readQuery-baseline.txt
pnpm bench:happydom bench/api/watchQuery.bench.ts > .bench-results/watchQuery-baseline.txt
pnpm bench:happydom bench/api/writeQuery.bench.ts > .bench-results/writeQuery-baseline.txt

echo "✅ API baselines saved to .bench-results/"
