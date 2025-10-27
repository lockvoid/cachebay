#!/bin/bash
set -e

echo "🌐 Running DOM benchmarks (baseline)..."

mkdir -p .bench-results

pnpm bench:chromium bench/dom/infinite-feed.bench.ts > .bench-results/infinite-feed-baseline.txt
pnpm bench:chromium bench/dom/user-profile.bench.ts > .bench-results/user-profile-baseline.txt

echo "✅ DOM baselines saved to .bench-results/"
