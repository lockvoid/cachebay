import { traverseFast } from '@/src/core/utils';
import { bench } from 'vitest';

const tree = {
  id: 'root',

  children: [
    { id: 'child1', children: [] },
    { id: 'child2', children: [] },
  ],
};

describe('Utils', () => {
  bench('traverseFast', () => {
    traverseFast(tree, () => { });
  }, { warmupTime: 200, warmupIterations: 1_000_000 });
});
