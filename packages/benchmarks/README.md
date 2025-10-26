# Benchmarks

Performance benchmarks comparing Cachebay against Apollo, Relay, and Urql.

## Structure

```
bench/
├── api/              # API-level benchmarks (mitata)
│   ├── normalizeDocument.bench.ts
│   ├── materializeDocument.bench.ts
│   ├── readQuery.bench.ts
│   └── watchQuery.bench.ts
└── suites/           # DOM benchmarks (vitest)
    └── nested-query.dom.bench.ts
```

## Running Locally

### API Benchmarks (mitata)
```bash
# Run single benchmark
BENCH_FILE=normalizeDocument pnpm bench:api

# Save baseline
BENCH_FILE=normalizeDocument pnpm bench:api:baseline

# Compare against baseline
BENCH_FILE=normalizeDocument pnpm bench:api:compare
```

### DOM Benchmarks (vitest)
```bash
# Run benchmark
pnpm bench:suite bench/suites/nested-query.dom.bench.ts

# Save baseline
BENCH_NAME=nested-query pnpm bench:suite:baseline bench/suites/nested-query.dom.bench.ts

# Compare against baseline (shows [1.27x] ⇑ or [0.98x] ⇓)
BENCH_NAME=nested-query pnpm bench:suite:compare bench/suites/nested-query.dom.bench.ts
```

## CI Workflow

### Main Branch
When code is pushed to `main`:
1. Runs all benchmarks
2. Saves baseline results to GitHub artifacts (90 days retention)
3. Posts commit comment with results

### Pull Requests
When a PR is opened/updated:
1. Downloads baseline from main branch
2. Runs benchmarks and compares against baseline
3. Posts/updates PR comment with comparison results
4. Shows improvements (`[1.27x] ⇑`) and regressions (`[0.98x] ⇓`)

## Baseline Files

Baseline files are committed to `.bench-results/`:
- `*-baseline.json` - DOM benchmark baselines (vitest)
- `api-baseline.txt` - API benchmark baseline (mitata)

Current/compare results are gitignored.

## Adding New Benchmarks

### API Benchmark
1. Create `bench/api/my-benchmark.bench.ts`
2. Use mitata: `import { bench, run } from 'mitata'`
3. Add to CI workflows in `.github/workflows/`

### DOM Benchmark
1. Create `bench/suites/my-benchmark.dom.bench.ts`
2. Use vitest: `import { bench } from 'vitest'`
3. Update CI with new `BENCH_NAME`

## Results Interpretation

### Vitest Comparison
- `[1.27x] ⇑` - 27% faster than baseline (improvement)
- `[0.98x] ⇓` - 2% slower than baseline (regression)
- `(baseline)` - Original baseline result

### Mitata Output
- Shows `ms/iter`, `min`, `max`, `mean`, `p75`, `p99`
- Summary shows relative performance (e.g., "1.49x faster than relay")

## Testing GitHub Workflows Locally

You can simulate the CI workflow locally to test before pushing:

### 1. Simulate Main Branch (Save Baseline)
```bash
cd packages/benchmarks

# Install Playwright
pnpm exec playwright install chromium

# Run DOM benchmarks
BENCH_NAME=nested-query pnpm bench:suite:baseline bench/suites/nested-query.dom.bench.ts

# Run API benchmarks
BENCH_FILE=normalizeDocument pnpm bench:api:baseline
BENCH_FILE=materializeDocument pnpm bench:api:baseline
BENCH_FILE=readQuery pnpm bench:api:baseline
BENCH_FILE=watchQuery pnpm bench:api:baseline

# Check results
ls -la .bench-results/
```

### 2. Simulate PR (Compare Against Baseline)
```bash
# Make some code changes to cachebay...

# Run DOM comparison
BENCH_NAME=nested-query pnpm bench:suite:compare bench/suites/nested-query.dom.bench.ts

# Run API comparison
BENCH_FILE=normalizeDocument pnpm bench:api:compare
BENCH_FILE=materializeDocument pnpm bench:api:compare
BENCH_FILE=readQuery pnpm bench:api:compare
BENCH_FILE=watchQuery pnpm bench:api:compare

# Check comparison results
cat .bench-results/api-current.txt
```

### 3. Using act (GitHub Actions locally)
Install [act](https://github.com/nektos/act) to run workflows locally:

```bash
# Install act
brew install act

# Run main workflow
act push -W .github/workflows/benchmark-main.yml

# Run PR workflow
act pull_request -W .github/workflows/benchmark-pr.yml
```

**Note:** `act` may have limitations with artifacts and some GitHub-specific features.

## Troubleshooting

### Playwright Installation
If benchmarks fail with browser errors:
```bash
pnpm --filter benchmarks exec playwright install chromium
```

### Missing Baseline
If comparison fails with "No baseline found":
1. Run baseline script first
2. Check `.bench-results/` directory exists
3. Verify baseline files are present

### Performance Variance
Benchmarks can vary ±5-10% between runs due to:
- System load
- CPU throttling
- Background processes

Run multiple times and look for consistent trends.
