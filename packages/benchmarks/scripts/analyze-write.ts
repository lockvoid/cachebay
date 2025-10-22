// Analyze writeQuery performance with timing breakdown
import { performance } from 'node:perf_hooks';

// ---- cachebay ----
import { createCachebay } from "../../../cachebay/src/core/client";

// ---- relay ----
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import RelayWriteQuery from "../src/__generated__/relayWriteQueryDefRelayWriteQuery.graphql";

// ---- shared ----
import { makeResponse, buildPages, CACHEBAY_QUERY } from "../api/utils";

function createCachebay() {
  return createCachebay({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
}

function createRelayEnvironment() {
  return new Environment({
    network: Network.create(() => Promise.resolve({ data: {} })),
    store: new Store(new RecordSource()),
  });
}

// Prepare data
const USERS_TOTAL = 1000;
const PAGE_SIZE = 10;
const allUsers = Object.freeze(makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 }));
const pages = buildPages(allUsers, PAGE_SIZE);

console.log(`\n📊 Analyzing writeQuery performance`);
console.log(`Dataset: ${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})\n`);

function analyzeCachebay() {
  console.log('🔍 Cachebay Analysis:');

  const timings = {
    createCachebay: 0,
    writeQueries: [] as number[],
    total: 0,
  };

  const start = performance.now();

  // Measure cache creation
  const t0 = performance.now();
  const cache = createCachebay();
  timings.createCachebay = performance.now() - t0;

  // Measure each writeQuery
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const t1 = performance.now();
    cache.writeQuery({
      query: CACHEBAY_QUERY,
      variables: p.vars,
      data: p.data,
    });
    timings.writeQueries.push(performance.now() - t1);
  }

  timings.total = performance.now() - start;

  const avgWrite = timings.writeQueries.reduce((a, b) => a + b, 0) / timings.writeQueries.length;
  const minWrite = Math.min(...timings.writeQueries);
  const maxWrite = Math.max(...timings.writeQueries);

  console.log(`  Cache creation: ${timings.createCachebay.toFixed(3)}ms`);
  console.log(`  Write avg: ${avgWrite.toFixed(3)}ms (min: ${minWrite.toFixed(3)}ms, max: ${maxWrite.toFixed(3)}ms)`);
  console.log(`  Total: ${timings.total.toFixed(2)}ms`);
  console.log(`  First 10 writes: ${timings.writeQueries.slice(0, 10).map(t => t.toFixed(2)).join(', ')}ms`);
  console.log(`  Last 10 writes: ${timings.writeQueries.slice(-10).map(t => t.toFixed(2)).join(', ')}ms\n`);

  return timings.total;
}

function analyzeRelay() {
  console.log('🔍 Relay Analysis:');

  const timings = {
    createEnv: 0,
    commitPayloads: [] as number[],
    total: 0,
  };

  const start = performance.now();

  // Measure environment creation
  const t0 = performance.now();
  const relay = createRelayEnvironment();
  timings.createEnv = performance.now() - t0;

  // Measure each commitPayload
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const t1 = performance.now();
    const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, p.vars);
    relay.commitPayload(operation, p.data);
    timings.commitPayloads.push(performance.now() - t1);
  }

  timings.total = performance.now() - start;

  const avgCommit = timings.commitPayloads.reduce((a, b) => a + b, 0) / timings.commitPayloads.length;
  const minCommit = Math.min(...timings.commitPayloads);
  const maxCommit = Math.max(...timings.commitPayloads);

  console.log(`  Environment creation: ${timings.createEnv.toFixed(3)}ms`);
  console.log(`  Commit avg: ${avgCommit.toFixed(3)}ms (min: ${minCommit.toFixed(3)}ms, max: ${maxCommit.toFixed(3)}ms)`);
  console.log(`  Total: ${timings.total.toFixed(2)}ms`);
  console.log(`  First 10 commits: ${timings.commitPayloads.slice(0, 10).map(t => t.toFixed(2)).join(', ')}ms`);
  console.log(`  Last 10 commits: ${timings.commitPayloads.slice(-10).map(t => t.toFixed(2)).join(', ')}ms\n`);

  return timings.total;
}

// Run analysis
const cachebayTime = analyzeCachebay();
const relayTime = analyzeRelay();

console.log('📈 Summary:');
console.log(`  Cachebay: ${cachebayTime.toFixed(2)}ms`);
console.log(`  Relay: ${relayTime.toFixed(2)}ms`);
console.log(`  Difference: ${(cachebayTime - relayTime).toFixed(2)}ms (${(cachebayTime / relayTime).toFixed(2)}x slower)`);
console.log('\n💡 Next steps:');
console.log('  1. Load profile-*.cpuprofile files in Chrome DevTools');
console.log('  2. Look for hot functions in the flame graph');
console.log('  3. Focus on functions that take >5% of total time');
