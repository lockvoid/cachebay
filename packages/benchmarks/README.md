# Benchmarks

Performance benchmarks for Cachebay development and optimization. Track performance regressions and identify optimization opportunities in Cachebay's implementation. Comparisons with Apollo, Urql, and Relay are included as reference points.

## TL;DR

```bash
# API benchmarks (HappyDOM)
pnpm bench:api

# DOM benchmarks (Chromium)
pnpm bench:chromium
```

## CI/CD

Benchmarks run automatically via [CodSpeed](https://codspeed.io):
- **Main branch**: Measures performance baseline
- **Pull requests**: Compares against baseline
