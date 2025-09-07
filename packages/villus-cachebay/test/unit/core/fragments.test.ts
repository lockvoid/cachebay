import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { tick } from '@/test/helpers';

describe('Cachebay fragments', () => {
  it('identify returns normalized key', () => {
    const cache = createCache({
      keys: () => ({ User: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const key = (cache as any).identify({ __typename: 'User', id: 1, name: 'A' });
    expect(key).toBe('User:1');
  });

  it('writeFragment -> commit and revert work; hasFragment checks presence', async () => {
    const cache = createCache({
      keys: () => ({ User: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const tx = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Ann' });
    tx.commit?.();
    await tick();

    expect((cache as any).hasFragment('User:1')).toBe(true);
    expect((cache as any).readFragment('User:1')?.name).toBe('Ann');

    const tx2 = (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'Ann B.' });
    tx2.commit?.();
    await tick();
    expect((cache as any).readFragment('User:1')?.name).toBe('Ann B.');

    // revert the last change
    tx2.revert?.();
    await tick();
    expect((cache as any).readFragment('User:1')?.name).toBe('Ann');
  });

  it('readFragment can return raw snapshot when materialized=false', async () => {
    const cache = createCache({
      keys: () => ({ User: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const tx = (cache as any).writeFragment({ __typename: 'User', id: 2, name: 'Bob' });
    tx.commit?.();
    await tick();

    const raw = (cache as any).readFragment('User:2', false);
    expect(raw).toBeTruthy();
    expect(raw!.name).toBe('Bob');
  });
});
