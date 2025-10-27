# Benchmarks

This package contains performance benchmarks for Cachebay, comparing it against Apollo Client, Urql, and Relay.

## Running Benchmarks Locally

### API Benchmarks (HappyDOM)
```bash
pnpm bench:api
```

Runs low-level API benchmarks:
- `normalizeDocument` - Write operations
- `materializeDocument` - Read operations  
- `readQuery` - Cache reads
- `watchQuery` - Reactive queries
- `writeQuery` - Imperative cache writes

### DOM Benchmarks (Chromium)
```bash
pnpm bench:chromium
```

Runs real browser benchmarks:
- `infinite-feed` - Nested pagination with interfaces
- `user-profile` - Single entity with nested data

## CI/CD with CodSpeed

Benchmarks are automatically tracked using [CodSpeed](https://codspeed.io).

### How It Works

#### Flow Diagram
```
Main Branch (publish.yml):
  Run benchmarks → CodSpeedHQ/action@v2 → Upload to CodSpeed Cloud
                                           ↓
                                    Stored as BASELINE
                                           ↓
PR (benchmark-pr.yml):                     ↓
  Run benchmarks → CodSpeedHQ/action@v2 → Upload to CodSpeed Cloud
                                           ↓
                                    Compare vs BASELINE
                                           ↓
                                    Post PR Comment
```

#### Step by Step

1. **On main branch push (via publish.yml)**: 
   - GitHub Actions runs benchmarks
   - `CodSpeedHQ/action@v2` uploads results to **CodSpeed cloud**
   - CodSpeed stores this as the **baseline** for main branch
   - This happens during the publish workflow

2. **On PR (via benchmark-pr.yml)**:
   - GitHub Actions runs benchmarks on PR code
   - `CodSpeedHQ/action@v2` uploads results to **CodSpeed cloud**
   - CodSpeed **automatically compares** PR results vs main baseline
   - Posts performance report as PR comment

3. **CodSpeed Dashboard**:
   - View historical performance trends
   - Compare across commits and releases
   - Get alerts for regressions

#### Key Point: The `CodSpeedHQ/action@v2` Does the Upload!

Without the CodSpeed action, benchmarks just run locally. The action:
- ✅ Captures benchmark results
- ✅ Uploads to CodSpeed cloud
- ✅ Triggers comparison (on PRs)
- ✅ Posts PR comments

### Setup Requirements

1. Sign up at [codspeed.io](https://codspeed.io)
2. Install CodSpeed GitHub App on your repository
3. Add `CODSPEED_TOKEN` to repository secrets (Settings → Secrets → Actions)
4. CodSpeed will automatically track benchmarks on next push/PR

### Benefits

- 📊 **Visual dashboards** - Track performance over time
- 🚨 **Regression detection** - Automatic alerts for slowdowns  
- 💬 **PR integration** - Performance reports in pull requests
- 📈 **Historical data** - Compare across commits and releases
- 🎯 **Zero config** - Works with Vitest benchmarks out of the box
- ☁️ **Cloud storage** - No need to commit baseline files

## Benchmark Structure

```
bench/
├── api/              # Low-level API benchmarks
│   ├── normalizeDocument.bench.ts
│   ├── materializeDocument.bench.ts
│   ├── readQuery.bench.ts
│   ├── watchQuery.bench.ts
│   └── writeQuery.bench.ts
└── dom/              # Browser integration benchmarks
    ├── infinite-feed.bench.ts
    └── user-profile.bench.ts
```

## Adding New Benchmarks

1. Create a new `.bench.ts` file in `bench/api/` or `bench/dom/`
2. Use Vitest's `bench()` function
3. CodSpeed will automatically track it on next CI run

Example:
```typescript
import { bench, describe } from 'vitest';

describe('My Feature', () => {
  bench('operation name', () => {
    // Your benchmark code
  });
});
```
