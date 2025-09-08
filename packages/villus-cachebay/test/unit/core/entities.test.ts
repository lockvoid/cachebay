import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { tick } from '@/test/helpers';

describe('internals — interface-aware entity access', () => {
  it('read/has/list work via interface key', () => {
    const cache = createCache({
      interfaces: { Node: ['User', 'Asset'] },
      keys: () => ({
        User: (o: any) => (o?.id != null ? String(o.id) : null),
        Asset: (o: any) => (o?.id != null ? String(o.id) : null),
      }),
    });

    (cache as any).writeFragment({ __typename: 'User', id: 1, name: 'A' }).commit?.();

    expect((cache as any).hasFragment('Node:1')).toBe(true);
    expect((cache as any).readFragment('Node:1')?.name).toBe('A');

    const keys = (cache as any).listEntityKeys('Node');
    expect(keys).toEqual(['User:1']);

    const ents = (cache as any).listEntities('Node');
    expect(ents.length).toBe(1);
  });

  it('writeFragment + readFragment roundtrip; delete via optimistic modifier', async () => {
    const cache = createCache({
      keys: () => ({ Thing: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    // Write entity
    const tx = (cache as any).writeFragment({ __typename: 'Thing', id: 1, name: 'A' });
    tx.commit?.();
    await tick();

    expect((cache as any).hasFragment('Thing:1')).toBe(true);
    expect((cache as any).readFragment('Thing:1')?.name).toBe('A');

    // Update entity
    const tx2 = (cache as any).writeFragment({ __typename: 'Thing', id: 1, name: 'A+' });
    tx2.commit?.();
    await tick();
    expect((cache as any).readFragment('Thing:1')?.name).toBe('A+');

    // Delete optimistically
    const t = (cache as any).modifyOptimistic((c: any) => {
      c.delete('Thing:1');
    });
    t.commit?.();
    await tick();

    expect((cache as any).hasFragment('Thing:1')).toBe(false);
  });

  it('listEntityKeys / listEntities reflect materialized and raw snapshots', async () => {
    const cache = createCache({
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    (cache as any).writeFragment({ __typename: 'Color', id: 2, name: 'Blue' }).commit?.();
    (cache as any).writeFragment({ __typename: 'Color', id: 1, name: 'Black' }).commit?.();
    await tick();

    const keys = (cache as any).listEntityKeys('Color');
    expect(keys.sort()).toEqual(['Color:1', 'Color:2']);

    const mats = (cache as any).listEntities('Color');
    expect(Array.isArray(mats)).toBe(true);
    expect(mats.length).toBe(2);

    const raws = (cache as any).listEntities('Color', false);
    expect(Array.isArray(raws)).toBe(true);
    expect(raws.length).toBe(2);
  });
});
