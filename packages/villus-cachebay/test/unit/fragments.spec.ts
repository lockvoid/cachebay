import { describe, it, expect } from 'vitest';
import { createCache } from '../../src/index';
import { tick } from '../helpers';

/**
 * Unit tests for fragment API: identify, readFragment, writeFragment.
 */
describe('Cachebay fragments', () => {
  it('identify returns normalized key', () => {
    const cache = createCache({
      keys: () => ({
        User: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    const key = cache.identify({ __typename: 'User', id: 1, name: 'A' });
    expect(key).toBe('User:1');
  });

  it('writeFragment upserts and readFragment reads back (materialized by default)', async () => {
    const cache = createCache({
      keys: () => ({ User: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    // Nothing yet (raw snapshot)
    expect(cache.readFragment('User:1', false)).toBeUndefined();

    // Upsert
    const { revert } = cache.writeFragment({ __typename: 'User', id: 1, name: 'Alice' });

    const u1 = cache.readFragment('User:1');
    expect(u1).toBeTruthy();
    expect(u1!.name).toBe('Alice');

    // Update and verify reactivity path (shallow check)
    cache.writeFragment({ __typename: 'User', id: 1, name: 'Alice Updated' });
    await tick();
    const u2 = cache.readFragment('User:1');
    expect(u2!.name).toBe('Alice Updated');

    // Revert last write by writing previous snapshot
    revert?.();
    const u3raw = cache.readFragment('User:1', false);
    // After revert first write, entity should be gone
    expect(u3raw).toBeUndefined();
  });

  it('readFragment can return raw snapshot when materialized=false', () => {
    const cache = createCache({
      keys: () => ({ User: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });
    cache.writeFragment({ __typename: 'User', id: 2, name: 'Bob' }).commit?.();

    const raw = cache.readFragment('User:2', false);
    expect(raw).toBeTruthy();
    expect(raw!.name).toBe('Bob');
  });
});
