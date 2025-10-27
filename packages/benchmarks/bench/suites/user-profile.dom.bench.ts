import { bench, describe } from "vitest";
import { createReactRelayUserProfileApp } from "../../src/ui/react-relay-user-profile-app";
import { createVueApolloUserProfileApp } from "../../src/ui/vue-apollo-user-profile-app";
import { createVueCachebayUserProfileApp } from "../../src/ui/vue-cachebay-user-profile-app";
import { createVueUrqlUserProfileApp } from "../../src/ui/vue-urql-user-profile-app";
import { createUserProfileYoga } from "../../src/server/user-profile-server";
import { makeUserProfileDataset } from "../../src/utils/seed-user-profile";
import Table from 'cli-table3';

const DEBUG = true;

const BENCH_OPTIONS = {
  iterations: 5000,
  warmupIterations: 50,
  throws: true,
  warmupTime: 0,
  time: 0,
};

type BenchResult = {
  name: string;
  mean: number;
  stdDev: number;
  min: number;
  max: number;
};

const results: BenchResult[] = [];

function formatTime(ms: number): string {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function formatMultiplier(baseline: number, current: number): string {
  const multiplier = current / baseline;
  const arrow = multiplier > 1.1 ? '⇑' : multiplier < 0.9 ? '⇓' : '→';
  return `[${multiplier.toFixed(2)}x] ${arrow}`;
}

function printResultsTable() {
  if (!DEBUG || results.length === 0) return;

  const table = new Table({
    head: ['Library', 'Mean', 'Std Dev', 'Min', 'Max', 'vs Cachebay'],
    colWidths: [20, 15, 15, 15, 15, 20],
  });

  const baseline = results.find(r => r.name.includes('Cachebay'));
  if (!baseline) return;

  for (const result of results) {
    const isCachebay = result.name.includes('Cachebay');
    table.push([
      result.name,
      formatTime(result.mean),
      formatTime(result.stdDev),
      formatTime(result.min),
      formatTime(result.max),
      isCachebay ? 'baseline' : formatMultiplier(baseline.mean, result.mean),
    ]);
  }

  console.log('\n' + table.toString() + '\n');
}

describe('DOM User Profile (happy-dom): single entity with nested data', () => {
  const dataset = makeUserProfileDataset({ userCount: 1000 });
  const testUserId = 'u1'; // Always load the same user

  describe('network-only', () => {
    bench('Cachebay (vue, network-only)', async () => {
      const app = createVueCachebayUserProfileApp('network-only', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Cachebay (network-only)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Apollo (vue, network-only)', async () => {
      const app = createVueApolloUserProfileApp('network-only', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Apollo (network-only)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Urql (vue, network-only)', async () => {
      const app = createVueUrqlUserProfileApp('network-only', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Urql (network-only)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Relay (react, network-only)', async () => {
      const app = createReactRelayUserProfileApp('network-only', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Relay (network-only)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
          printResultsTable();
        }
      },
    });
  });

  describe('cache-first', () => {
    bench('Cachebay (vue, cache-first)', async () => {
      const app = createVueCachebayUserProfileApp('cache-first', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Cachebay (cache-first)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Apollo (vue, cache-first)', async () => {
      const app = createVueApolloUserProfileApp('cache-first', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Apollo (cache-first)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Urql (vue, cache-first)', async () => {
      const app = createVueUrqlUserProfileApp('cache-first', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Urql (cache-first)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Relay (react, cache-first)', async () => {
      const app = createReactRelayUserProfileApp('cache-first', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Relay (cache-first)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
          printResultsTable();
        }
      },
    });
  });

  describe('cache-and-network', () => {
    bench('Cachebay (vue, cache-and-network)', async () => {
      const app = createVueCachebayUserProfileApp('cache-and-network', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Cachebay (cache-and-network)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Apollo (vue, cache-and-network)', async () => {
      const app = createVueApolloUserProfileApp('cache-and-network', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Apollo (vue, cache-and-network)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Urql (vue, cache-and-network)', async () => {
      const app = createVueUrqlUserProfileApp('cache-and-network', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Urql (vue, cache-and-network)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
        }
      },
    });

    bench('Relay (react, cache-and-network)', async () => {
      const app = createReactRelayUserProfileApp('cache-and-network', 0);
      await app.mount();
      await app.ready();
      await app.unmount();
    }, {
      ...BENCH_OPTIONS,
      setup: (task) => {
        if (DEBUG && task.result) {
          results.push({
            name: 'Relay (cache-first)',
            mean: task.result.mean,
            stdDev: task.result.stdDev ?? 0,
            min: task.result.min ?? 0,
            max: task.result.max ?? 0,
          });
          printResultsTable();
        }
      },
    });
  });
});
