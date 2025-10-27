#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks (current)..."

mkdir -p .bench-results

pnpm bench:chromium bench/dom/infinite-feed.bench.ts > .bench-results/infinite-feed-current.txt
pnpm bench:chromium bench/dom/user-profile.bench.ts > .bench-results/user-profile-current.txt

echo ""
echo "✅ DOM benchmarks complete! Compare baseline vs current in .bench-results/"
