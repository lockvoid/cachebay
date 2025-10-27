#!/bin/bash
set -e

echo "⚡ Running API benchmarks (current)..."

mkdir -p .bench-results

pnpm bench:happydom bench/api/normalizeDocument.bench.ts > .bench-results/normalizeDocument-current.txt
pnpm bench:happydom bench/api/materializeDocument.bench.ts > .bench-results/materializeDocument-current.txt
pnpm bench:happydom bench/api/readQuery.bench.ts > .bench-results/readQuery-current.txt
pnpm bench:happydom bench/api/watchQuery.bench.ts > .bench-results/watchQuery-current.txt
pnpm bench:happydom bench/api/writeQuery.bench.ts > .bench-results/writeQuery-current.txt

echo ""
echo "✅ API benchmarks complete! Compare baseline vs current in .bench-results/"
