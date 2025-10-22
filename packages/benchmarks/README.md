# Benchmarks

Performance benchmarks for cachebay comparing against Apollo Client and Relay.

## Running Benchmarks

### Mitata Benchmarks (Recommended)

Run any benchmark file using Mitata for better isolation and accuracy:

```bash
# Run specific benchmark
pnpm bench api/readQuery.bench.ts

# Run with Node.js flags (e.g., expose GC)
pnpm bench -- --expose-gc api/readQuery.bench.ts
```

**Benefits of Mitata:**
- Better isolation (each iteration gets fresh instances)
- More accurate measurements (setup code excluded from timing)
- Better statistics (min/max, p75/p99, memory usage)
- Visual output with ASCII charts

### Vitest Benchmarks (Legacy)

```bash
# Run all vitest benchmarks
vitest bench --run

# Run specific API benchmark
pnpm api:readQuery
pnpm api:writeQuery
```

## Benchmark Types

### API Benchmarks (`api/`)
- **COLD paths**: First read from populated cache (measures LRU cache miss)
- **HOT paths**: Repeated reads (measures LRU cache hit)

### Suite Benchmarks (`suites/`)
- End-to-end DOM benchmarks with real servers

## Writing Benchmarks

### Mitata Generator Pattern

Use generator functions to separate setup from measurement:

```typescript
import { bench, group, run } from 'mitata';

group('My Benchmarks', () => {
  bench('my benchmark', function* () {
    // Setup (not timed)
    const cache = createCachebay();
    cache.populate();

    // Benchmark (timed)
    yield () => {
      const result = cache.read();
      sink(result);
    };
  });
});

await run();
```

**Key points:**
- Setup code before `yield` is not timed
- Only the function passed to `yield` is measured
- Each iteration gets a fresh setup
- Always sink results to prevent DCE

## Current Performance

### readQuery Benchmarks

**COLD (first read):**
- Cachebay: ~1.5 µs
- Apollo: ~22 ms
- **14,600x faster**

**HOT (cached):**
- Cachebay: ~1.3 µs
- Apollo: ~22 ms (no caching) / ~1.8 µs (with caching)
- **17,000x faster** (vs no caching)
- **1.4x faster** (vs with caching)
