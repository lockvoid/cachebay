# Benchmarks

Performance benchmarks for Cachebay development and optimization. Track performance regressions and identify optimization opportunities in Cachebay’s implementation. Comparisons with Apollo, Urql, and Relay are included **as reference points only**.

**Important notes on comparisons (neutral & practical):**

* **Synthetic harness.** Results come from a fixed local setup and are primarily for  regression tracking within this repo
* **Not universal truth.** Real-world performance varies with schema shape, component structure, pagination patterns, transports, device, browser, and network conditions.

## TL;DR

```bash
# API benchmarks (HappyDOM)
pnpm bench:api

# DOM benchmarks (Chromium)
pnpm bench:chromium
```

## CI/CD

Benchmarks run automatically via [CodSpeed](https://codspeed.io):

* **Main branch**: Measures performance baseline
* **Pull requests**: Compares against baseline

## DOM: Infinite feed (Chromium)

```text
✓  chromium  bench/dom/infinite-feed.bench.ts > DOM Nested query (happy-dom): interfaces, custom keys, nested pagination > network-only 34959ms
    name                             hz     min       max      mean     p75       p99      p995      p999     rme  samples
  · cachebay(vue, network-only)  2.4998  392.80    411.00    400.04  402.10    411.00    411.00    411.00  ±0.92%       10
  · apollo(vue, network-only)    0.9950  968.10  1,235.40  1,005.00  983.00  1,235.40  1,235.40  1,235.40  ±5.78%       10
  · urql(vue, network-only)      1.0983  867.00  1,153.60    910.49  897.50  1,153.60  1,153.60  1,153.60  ±6.82%       10
  · relay(react, network-only)   1.7104  540.10    773.60    584.66  573.20    773.60    773.60    773.60  ±8.29%       10

✓  chromium  bench/dom/infinite-feed.bench.ts > DOM Nested query (happy-dom): interfaces, custom keys, nested pagination > cache-first 35555ms
    name                            hz     min       max      mean       p75       p99      p995      p999      rme  samples
  · cachebay(vue, cache-first)  2.4743  398.10    410.50    404.16    408.00    410.50    410.50    410.50   ±0.75%       10
  · apollo(vue, cache-first)    0.9689  994.80  1,287.50  1,032.11  1,009.00  1,287.50  1,287.50  1,287.50   ±6.23%       10
  · urql(vue, cache-first)      1.0745  882.70  1,133.80    930.63    917.20  1,133.80  1,133.80  1,133.80   ±5.63%       10
  · relay(react, cache-first)   1.6715  541.80    834.50    598.25    582.20    834.50    834.50    834.50  ±10.17%       10

✓  chromium  bench/dom/infinite-feed.bench.ts > DOM Nested query (happy-dom): interfaces, custom keys, nested pagination > cache-and-network 36917ms
    name                                  hz       min       max      mean       p75       p99      p995      p999      rme  samples
  · cachebay(vue, cache-and-network)  2.2952    428.70    442.50    435.69    440.10    442.50    442.50    442.50   ±0.81%       10
  · apollo(vue, cache-and-network)    0.9309  1,025.70  1,350.10  1,074.21  1,058.60  1,350.10  1,350.10  1,350.10   ±6.55%       10
  · urql(vue, cache-and-network)      1.0350    901.70  1,186.30    966.22    952.50  1,186.30  1,186.30  1,186.30   ±5.86%       10
  · relay(react, cache-and-network)   1.6495    560.10    887.80    606.26    595.40    887.80    887.80    887.80  ±11.81%       10

┌───────────┬──────────┬────────────────────┬────────────────────┬───────────────┐
│ iteration │ name     │ totalRenderTime    │ totalNetworkTime   │ totalEntities │
├───────────┼──────────┼────────────────────┼────────────────────┼───────────────┤
│ 36        │ cachebay │ 14911.399999976158 │ 14910.899999976158 │ 324000        │
├───────────┼──────────┼────────────────────┼────────────────────┼───────────────┤
│ 36        │ apollo   │ 37189.300000190735 │ 37188.70000016689  │ 324000        │
├───────────┼──────────┼────────────────────┼────────────────────┼───────────────┤
│ 36        │ urql     │ 33531.2999997139   │ 33530.2000002861   │ 324000        │
├───────────┼──────────┼────────────────────┼────────────────────┼───────────────┤
│ 36        │ relay    │ 19513.300000429153 │ 15560.799998998642 │ 268860        │
└───────────┴──────────┴────────────────────┴────────────────────┴───────────────┘
```

**Summary**

```text
BENCH  Summary

  chromium  cachebay(vue, network-only) - bench/dom/infinite-feed.bench.ts > DOM Nested query (happy-dom): interfaces, custom keys, nested pagination > network-only
   1.46x faster than relay(react, network-only)
   2.28x faster than urql(vue, network-only)
   2.51x faster than apollo(vue, network-only)

  chromium  cachebay(vue, cache-first) - bench/dom/infinite-feed.bench.ts > DOM Nested query (happy-dom): interfaces, custom keys, nested pagination > cache-first
   1.48x faster than relay(react, cache-first)
   2.30x faster than urql(vue, cache-first)
   2.55x faster than apollo(vue, cache-first)

  chromium  cachebay(vue, cache-and-network) - bench/dom/infinite-feed.bench.ts > DOM Nested query (happy-dom): interfaces, custom keys, nested pagination > cache-and-network
   1.39x faster than relay(react, cache-and-network)
   2.22x faster than urql(vue, cache-and-network)
   2.47x faster than apollo(vue, cache-and-network)
```

## DOM: User Profile (Chromium)

Single entity with nested data (HappyDOM harness; Chromium runner).

```
 ✓  chromium  bench/dom/user-profile.bench.ts > DOM User Profile (happy-dom): single entity with nested data > network-only 408ms
     name                                hz     min      max    mean     p75     p99    p995     p999      rme  samples
   · Cachebay (vue, network-only)  5,952.38  0.0000   0.8000  0.1680  0.2000  0.8000  0.8000   0.8000   ±8.58%      250
   · Apollo (vue, network-only)    1,188.78  0.7000   2.1000  0.8412  0.9000  1.9000  2.1000   2.1000   ±2.89%      250
   · Urql (vue, network-only)      9,090.91  0.0000   1.7000  0.1100  0.1000  0.3000  0.3000   1.7000  ±13.22%      250
   · Relay (react, network-only)   4,882.81  0.0000  12.2000  0.2048  0.2000  0.4000  0.7000  12.2000  ±46.33%      250

 ✓  chromium  bench/dom/user-profile.bench.ts > DOM User Profile (happy-dom): single entity with nested data > cache-first 317ms
     name                               hz     min     max    mean     p75     p99    p995    p999      rme  samples
   · Cachebay (vue, cache-first)  7,692.31  0.0000  1.7000  0.1300  0.2000  0.3000  0.3000  1.7000  ±11.12%      250
   · Apollo (vue, cache-first)    1,296.01  0.6000  3.7000  0.7716  0.8000  2.5000  2.7000  3.7000   ±4.52%      250
   · Urql (vue, cache-first)      9,541.98  0.0000  2.1000  0.1048  0.1000  0.2000  0.2000  2.1000  ±16.48%      250
   · Relay (react, cache-first)   6,756.76  0.0000  2.6000  0.1480  0.2000  0.5000  0.6000  2.6000  ±14.33%      250

 ✓  chromium  bench/dom/user-profile.bench.ts > DOM User Profile (happy-dom): single entity with nested data > cache-and-network 312ms
     name                                      hz     min     max    mean     p75     p99    p995    p999      rme  samples
   · Cachebay (vue, cache-and-network)   7,530.12  0.0000  2.8000  0.1328  0.2000  0.3000  0.3000  2.8000  ±16.81%      250
   · Apollo (vue, cache-and-network)     1,290.66  0.6000  7.1000  0.7748  0.8000  2.5000  2.7000  7.1000   ±7.11%      250
   · Urql (vue, cache-and-network)      10,416.67  0.0000  1.9000  0.0960  0.1000  0.2000  0.2000  1.9000  ±16.52%      250
   · Relay (react, cache-and-network)    7,418.40  0.0000  2.8000  0.1348  0.2000  0.2000  0.8000  2.8000  ±17.04%      250
```

### Summary

```
 BENCH  Summary

   chromium  Urql (vue, network-only) - bench/dom/user-profile.bench.ts > DOM User Profile (happy-dom): single entity with nested data > network-only
    1.53x faster than Cachebay (vue, network-only)
    1.86x faster than Relay (react, network-only)
    7.65x faster than Apollo (vue, network-only)

   chromium  Urql (vue, cache-first) - bench/dom/user-profile.bench.ts > DOM User Profile (happy-dom): single entity with nested data > cache-first
    1.24x faster than Cachebay (vue, cache-first)
    1.41x faster than Relay (react, cache-first)
    7.36x faster than Apollo (vue, cache-first)

   chromium  Urql (vue, cache-and-network) - bench/dom/user-profile.bench.ts > DOM User Profile (happy-dom): single entity with nested data > cache-and-network
    1.38x faster than Cachebay (vue, cache-and-network)
    1.40x faster than Relay (react, cache-and-network)
    8.07x faster than Apollo (vue, cache-and-network)
```
