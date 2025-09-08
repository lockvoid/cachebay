import { describe, it, expect, afterEach } from 'vitest';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, type Route, tick } from '@/test/helpers';

/* -----------------------------------------------------------------------------
 * Shared query & helpers
 * -------------------------------------------------------------------------- */

const COLORS = /* GraphQL */ `
  query Colors($first:Int,$after:String,$last:Int,$before:String) {
    colors(first:$first, after:$after, last:$last, before:$before) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;

/** Seed Relay options once so modifyOptimistic().connections(...) knows paths. */
async function seedRelayOptions(cache: any) {
  const routes: Route[] = [{
    when: ({ body }) => body.includes('query Colors'),
    delay: 0,
    respond: () => ({
      data: {
        __typename: 'Query',
        colors: { __typename: 'ColorConnection', edges: [], pageInfo: {} },
      },
    }),
  }];

  const fx = createFetchMock(routes);
  const client = createClient({ url: '/seed', use: [cache as any, fx.plugin] });
  await client.execute({ query: COLORS, variables: {} });
  await fx.waitAll(); fx.restore();
}

/** Convenience readers for the `inspect.connection` shape (array of buckets). */
const edgesKeys = (buckets: any) =>
  Array.isArray(buckets) && buckets[0]?.edges
    ? buckets[0].edges.map((e: any) => e.key)
    : [];

const pInfo = (buckets: any) =>
  (Array.isArray(buckets) && buckets[0]?.pageInfo) ? buckets[0].pageInfo : {};

/* -----------------------------------------------------------------------------
 * Tests
 * -------------------------------------------------------------------------- */

describe('Integration • Optimistic updates (entities & connections)', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void }> = [];

  afterEach(async () => {
    while (mocks.length) {
      const m = mocks.pop()!;
      await m.waitAll?.();
      m.restore?.();
    }
  });

  /* ───────────────────────────── Entities ───────────────────────────── */

  it('Entity: write+commit, then revert restores previous snapshot', async () => {
    const cache = createCache({
      keys: () => ({ T: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    expect((cache as any).hasFragment('T:1')).toBe(false);

    const t = (cache as any).modifyOptimistic((c: any) => {
      c.write({ __typename: 'T', id: 1, name: 'A' }, 'merge');
    });
    t.commit?.(); await tick();

    expect((cache as any).hasFragment('T:1')).toBe(true);
    expect((cache as any).readFragment('T:1')?.name).toBe('A');

    t.revert?.(); await tick();
    expect((cache as any).hasFragment('T:1')).toBe(false);
  });

  it('Entity layering (order: T1 -> T2 -> revert T1 -> revert T2)', async () => {
    const cache = createCache({
      keys: () => ({ T: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      c.write({ __typename: 'T', id: 1, name: 'A' }, 'merge');
    });
    const T2 = (cache as any).modifyOptimistic((c: any) => {
      c.write({ __typename: 'T', id: 1, name: 'B' }, 'merge');
    });

    T1.commit?.(); T2.commit?.(); await tick();
    expect((cache as any).readFragment('T:1')?.name).toBe('B');

    T1.revert?.(); await tick();
    expect((cache as any).readFragment('T:1')?.name).toBe('B');

    T2.revert?.(); await tick();
    expect((cache as any).hasFragment('T:1')).toBe(false);
  });

  it('Entity layering (order: T1 -> T2 -> revert T2 -> revert T1) returns baseline', async () => {
    const cache = createCache({
      keys: () => ({ T: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      c.write({ __typename: 'T', id: 1, name: 'A' }, 'merge');
    });
    const T2 = (cache as any).modifyOptimistic((c: any) => {
      c.write({ __typename: 'T', id: 1, name: 'B' }, 'merge');
    });

    T1.commit?.(); T2.commit?.(); await tick();
    expect((cache as any).readFragment('T:1')?.name).toBe('B');

    T2.revert?.(); await tick();
    expect((cache as any).readFragment('T:1')?.name).toBe('A');

    T1.revert?.(); await tick();
    expect((cache as any).hasFragment('T:1')).toBe(false);
  });

  /* ─────────────────────────── Connections ─────────────────────────── */

  it('Connection: addNode at end/start, removeNode, updatePageInfo', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    await seedRelayOptions(cache);

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });

      // end
      conn.addNode({ __typename: 'Color', id: 1, name: 'A1' }, { cursor: 'c1', position: 'end' });
      conn.addNode({ __typename: 'Color', id: 2, name: 'A2' }, { cursor: 'c2', position: 'end' });

      // start
      conn.addNode({ __typename: 'Color', id: 0, name: 'A0' }, { cursor: 'c0', position: 'start' });

      // pageInfo
      conn.updatePageInfo({ endCursor: 'c2', hasNextPage: true });

      // remove middle then add back at end
      conn.removeNode({ __typename: 'Color', id: 1 });
      conn.addNode({ __typename: 'Color', id: 1, name: 'A1' }, { cursor: 'c1r', position: 'end' });
    });
    t.commit?.(); await tick();

    const conns = (cache as any).inspect.connection('Query', 'colors');
    expect(edgesKeys(conns)).toEqual(['Color:0', 'Color:2', 'Color:1']); // A1 re-added at end
    expect(pInfo(conns)).toMatchObject({ endCursor: 'c2', hasNextPage: true });
  });

  it('Connection: dedup on add; re-add after remove inserts at specified position', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    await seedRelayOptions(cache);

    const t1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'A1' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Color', id: 2, name: 'A2' }, { cursor: 'c2' });
    });
    t1.commit?.(); await tick();

    const t2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode(
        { __typename: 'Color', id: 1, name: 'A1-upd' },
        { cursor: 'c1b', edge: { score: 99 }, position: 'end' },
      );
    });
    t2.commit?.(); await tick();

    const t3 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.removeNode({ __typename: 'Color', id: 1 });
      conn.addNode(
        { __typename: 'Color', id: 1, name: 'A1-back' },
        { cursor: 'c1c', position: 'start' },
      );
    });
    t3.commit?.(); await tick();

    const conns = (cache as any).inspect.connection('Query', 'colors');
    expect(edgesKeys(conns)).toEqual(['Color:1', 'Color:2']); // A1 back at start

    const first = edgesKeys(conns)[0];
    expect(first).toBe('Color:1');

    // Latest cursor on entry
    const a1 = (Array.isArray(conns) ? conns[0]?.edges : [])?.find((e: any) => e.key === 'Color:1');
    expect(a1?.cursor).toBe('c1c');
  });

  it('Connection: invalid nodes (missing id/__typename) are ignored safely', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    await seedRelayOptions(cache);

    const t = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ id: 1, name: 'NoTypename' } as any, { cursor: 'x' });        // invalid
      conn.addNode({ __typename: 'Color', name: 'NoId' } as any, { cursor: 'y' }); // invalid
    });
    t.commit?.(); await tick();

    const conns = (cache as any).inspect.connection('Query', 'colors');
    expect(edgesKeys(conns).length).toBe(0);
  });

  it('Connection layering: T1 adds, T2 adds; revert T1 preserves T2; revert T2 returns to baseline', async () => {
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({ Query: { colors: relay() } }),
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });

    await seedRelayOptions(cache);

    const T1 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 1, name: 'A1' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Color', id: 2, name: 'A2' }, { cursor: 'c2' });
      conn.updatePageInfo({ endCursor: 'c2', hasNextPage: true });
    });

    const T2 = (cache as any).modifyOptimistic((c: any) => {
      const [conn] = c.connections({ parent: 'Query', field: 'colors' });
      conn.addNode({ __typename: 'Color', id: 3, name: 'A3' }, { cursor: 'c3' });
      conn.updatePageInfo({ endCursor: 'c3', hasNextPage: false });
    });

    T1.commit?.(); T2.commit?.(); await tick();

    let conns = (cache as any).inspect.connection('Query', 'colors');
    expect(edgesKeys(conns)).toEqual(['Color:1', 'Color:2', 'Color:3']);
    expect(pInfo(conns)).toMatchObject({ endCursor: 'c3', hasNextPage: false });

    // Revert T1 -> only A3 remains
    T1.revert?.(); await tick();
    conns = (cache as any).inspect.connection('Query', 'colors');
    expect(edgesKeys(conns)).toEqual(['Color:3']);

    // Revert T2 -> baseline
    T2.revert?.(); await tick();
    conns = (cache as any).inspect.connection('Query', 'colors');
    expect(edgesKeys(conns).length).toBe(0);
    expect(pInfo(conns)).toMatchObject({});
  });
});
