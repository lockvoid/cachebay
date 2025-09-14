// test/unit/features/optimistic-edgecases.test.ts
import { describe, it, expect } from 'vitest';
import { createGraph } from '@/src/core/graph';
import { createModifyOptimistic } from '@/src/features/optimistic';

/**
 * Build the same connection selection key as createModifyOptimistic uses.
 * - Drops cursor args (after/before/first/last)
 * - Stable order "k:JSON(v)|k2:JSON(v2)"
 * - Empty args -> "()"
 *
 * Examples:
 *   buildConnKey('Query','posts',{})            -> "Query.posts()"
 *   buildConnKey('Query','posts',{first:2})     -> 'Query.posts(first:2)'
 *   buildConnKey('Query','posts',{first:2,after:'c2'}) -> 'Query.posts(first:2)'
 */
function buildConnKey(
  parentKey: string,
  field: string,
  vars?: Record<string, any>
): string {
  const filtered: Record<string, any> = { ...(vars || {}) };
  delete filtered.after;
  delete filtered.before;
  delete filtered.first;
  delete filtered.last;

  const parts = Object.keys(filtered)
    .sort()
    .map((k) => `${k}:${JSON.stringify(filtered[k])}`)
    .join('|');

  // empty -> ()
  return `${parentKey}.${field}(${parts})`;
}

describe('features/optimistic — edge cases (Posts)', () => {
  const makeGraph = () =>
    createGraph({
      reactiveMode: 'shallow',
      keys: { Post: (o: any) => (o?.id != null ? String(o.id) : null) },
      interfaces: {},
    });

  it('deduplicates nodes by entity key and updates cursor/edge in place', () => {
    const graph = makeGraph();
    const modifyOptimistic = createModifyOptimistic({ graph });

    const txn = modifyOptimistic((c) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      // add Post:1
      conn.addNode({ __typename: 'Post', id: 1, title: 'A1' }, { cursor: 'c1' });
      // same entity again with new cursor + meta → update, not duplicate
      conn.addNode(
        { __typename: 'Post', id: 1, title: 'A1-new' },
        { cursor: 'c1b', edge: { score: 42 } },
      );
    });

    txn.commit?.();

    const key = buildConnKey('Query', 'posts', {});
    const skel = graph.getSelection(key)!;
    const view = graph.materializeSelection(key)!;

    expect(Array.isArray(skel.edges) ? skel.edges.length : 0).toBe(1);
    expect(skel.edges[0].cursor).toBe('c1b');
    // edge meta is flattened
    expect((skel.edges[0] as any).score).toBe(42);

    // materialized node is a proxy of Post:1
    expect(view.edges[0].node.__typename).toBe('Post');
    expect(view.edges[0].node.id).toBe('1');

    // entity snapshot merged
    expect(graph.getEntity('Post:1')!.title).toBe('A1-new');
  });

  it('removeNode is a no-op when entity missing and works by id+typename', () => {
    const graph = makeGraph();
    const modifyOptimistic = createModifyOptimistic({ graph });

    const txn = modifyOptimistic((c) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });

      // Remove non-existing -> no throw
      conn.removeNode({ __typename: 'Post', id: 999 });

      // Add then remove
      conn.addNode({ __typename: 'Post', id: 1, title: 'A' }, { cursor: 'c1' });
      conn.removeNode({ __typename: 'Post', id: 1 });
    });

    txn.commit?.();

    const key = buildConnKey('Query', 'posts', {});
    const skel = graph.getSelection(key)!;
    const view = graph.materializeSelection(key)!;

    // Edge removed from the skeleton & view
    expect(Array.isArray(skel.edges) ? skel.edges.length : 0).toBe(0);
    expect(Array.isArray(view.edges) ? view.edges.length : 0).toBe(0);

    // Entity remains (no GC during optimistic ops)
    expect(graph.getEntity('Post:1')).toBeTruthy();
  });

  it('default addNode position is end; explicit start inserts at the front', () => {
    const graph = makeGraph();
    const modifyOptimistic = createModifyOptimistic({ graph });

    const txn = modifyOptimistic((c) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      // default → end
      conn.addNode({ __typename: 'Post', id: 1, title: 'P1' }, { cursor: 'c1' });
      conn.addNode({ __typename: 'Post', id: 2, title: 'P2' }, { cursor: 'c2' });
      // explicit start → first
      conn.addNode({ __typename: 'Post', id: 0, title: 'P0' }, { cursor: 'c0', position: 'start' });
    });

    txn.commit?.();

    const key = buildConnKey('Query', 'posts', {});
    const view = graph.materializeSelection(key)!;
    const ids = (view.edges || []).map((e: any) => e.node.id);
    expect(ids).toEqual(['0', '1', '2']);
  });

  it('ignores invalid nodes (missing __typename or id)', () => {
    const graph = makeGraph();
    const modifyOptimistic = createModifyOptimistic({ graph });

    const txn = modifyOptimistic((c) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ id: 1, title: 'NoType' } as any, { cursor: 'x' });
      conn.addNode({ __typename: 'Post', title: 'NoId' } as any, { cursor: 'y' });
    });

    txn.commit?.();

    const key = buildConnKey('Query', 'posts', {});
    const skel = graph.getSelection(key);
    const edgesLen = skel && Array.isArray(skel.edges) ? skel.edges.length : 0;
    expect(edgesLen).toBe(0);
    expect(graph.getEntity('Post:1')).toBeUndefined();
  });

  it('re-adding after removal places the node according to the latest position hint', () => {
    const graph = makeGraph();
    const modifyOptimistic = createModifyOptimistic({ graph });

    const txn = modifyOptimistic((c) => {
      const [conn] = c.connections({ parent: 'Query', field: 'posts' });
      conn.addNode({ __typename: 'Post', id: 1, title: 'P1' }, { cursor: 'c1' });
      conn.removeNode({ __typename: 'Post', id: 1 });
      conn.addNode(
        { __typename: 'Post', id: 1, title: 'P1-again' },
        { cursor: 'c1b', position: 'start' }
      );
    });

    txn.commit?.();

    const key = buildConnKey('Query', 'posts', {});
    const view = graph.materializeSelection(key)!;
    const ids = (view.edges || []).map((e: any) => e.node.id);
    expect(ids).toEqual(['1']);
    expect(graph.getEntity('Post:1')!.title).toBe('P1-again');
  });

  it('adds and removes nodes and patches pageInfo (via selection skeleton)', () => {
    const graph = makeGraph();
    const modifyOptimistic = createModifyOptimistic({ graph });

    const txn = modifyOptimistic((c) => {
      const [conn] = c.connections({
        parent: 'Query',
        field: 'posts',
        variables: { first: 2 },
      });
      conn.addNode({ __typename: 'Post', id: 1, title: 'A' }, { cursor: 'c1' });
      conn.patch({ endCursor: 'c1', hasNextPage: true });
      conn.removeNode({ __typename: 'Post', id: 1 });
    });

    txn.commit?.();

    const key = buildConnKey('Query', 'posts', { first: 2 });
    const skel = graph.getSelection(key)!;
    expect(skel.pageInfo).toEqual({ endCursor: 'c1', hasNextPage: true });

    const view = graph.materializeSelection(key)!;
    expect(Array.isArray(view.edges) ? view.edges.length : 0).toBe(0);
  });
});
