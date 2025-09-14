// test/unit/resolvers/relay.test.ts
import { describe, it, expect } from 'vitest';
import { relay } from '@/src/resolvers/relay';

// Minimal deps for relay (graph-only; views/resolvers optional)
function createDeps() {
  const entityStore = new Map<string, any>();

  const putEntity = (node: any, writePolicy?: 'merge' | 'replace') => {
    const t = node?.__typename;
    const id = node?.id;
    if (!t || id == null) return null;
    const key = `${t}:${id}`;
    if (writePolicy === 'replace') {
      const dst: any = {};
      for (const k of Object.keys(node)) {
        if (k === '__typename' || k === 'id') continue;
        dst[k] = node[k];
      }
      entityStore.set(key, dst);
    } else {
      const dst = entityStore.get(key) || {};
      for (const k of Object.keys(node)) {
        if (k === '__typename' || k === 'id') continue;
        dst[k] = node[k];
      }
      entityStore.set(key, dst);
    }
    return key;
  };

  return {
    deps: {
      graph: {
        putEntity,
        identify: (obj: any) =>
          obj && obj.__typename === 'Query' ? null : (obj && obj.id != null ? `${obj.__typename}:${obj.id}` : null),
      },
    },
    entityStore,
  };
}

const makeCtx = ({
  parentTypename = 'Query',
  field = 'assets',
  connectionValue,
  variables = {},
}: {
  parentTypename?: string;
  field?: string;
  connectionValue: any;
  variables?: Record<string, any>;
}) => {
  const hint: any = { stale: false };
  const holder = { v: connectionValue };
  return {
    parentTypename,
    field,
    parent: { __typename: parentTypename },
    value: holder.v,
    variables,
    set: (nv: any) => { holder.v = nv; },
    hint,
  };
};

describe('relay resolver (view-agnostic)', () => {
  it('replace: initializes list with page 1', () => {
    const { deps } = createDeps();
    const fn = relay({ paginationMode: 'replace' }).bind(deps);

    fn(makeCtx({
      connectionValue: {
        __typename: 'AssetConnection',
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1', 'Asset:2']);
    expect(state.pageInfo).toEqual({ endCursor: 'c2', hasNextPage: true });
    expect(state.initialized).toBe(true);
  });

  it('append: adds page 2 after page 1', () => {
    const { deps } = createDeps();
    const fn = relay({ paginationMode: 'append' }).bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    }));

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c3', node: { __typename: 'Asset', id: '3', name: 'A3' } },
          { cursor: 'c4', node: { __typename: 'Asset', id: '4', name: 'A4' } },
        ],
        pageInfo: { endCursor: 'c4', hasNextPage: true },
      },
      variables: { after: 'c2', first: 2 },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1', 'Asset:2', 'Asset:3', 'Asset:4']);
  });

  it('prepend: inserts page 0 before page 1', () => {
    const { deps } = createDeps();
    const fn = relay({ paginationMode: 'prepend' }).bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { startCursor: 'c1', hasPreviousPage: true },
      },
    }));

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c0a', node: { __typename: 'Asset', id: '0a', name: 'A0a' } },
          { cursor: 'c0b', node: { __typename: 'Asset', id: '0b', name: 'A0b' } },
        ],
        pageInfo: { startCursor: 'c0a', hasPreviousPage: false },
      },
      variables: { before: 'c1', last: 2 },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:0a', 'Asset:0b', 'Asset:1', 'Asset:2']);
  });

  it('replace is destructive: clears previous list before writing', () => {
    const { deps } = createDeps();
    const fn = relay({ paginationMode: 'replace' }).bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2' },
      },
    }));

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c3', node: { __typename: 'Asset', id: '3', name: 'A3' } },
          { cursor: 'c4', node: { __typename: 'Asset', id: '4', name: 'A4' } },
        ],
        pageInfo: { endCursor: 'c4' },
      },
      variables: { after: 'c2', first: 2 },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:3', 'Asset:4']);
  });

  it('dedups nodes by key and updates edge meta in place', () => {
    const { deps, entityStore } = createDeps();
    const fn = relay({ paginationMode: 'append' }).bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' }, score: 10 },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2' },
      },
    }));

    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1b', node: { __typename: 'Asset', id: '1', name: 'A1-new' }, score: 99 },
        ],
        pageInfo: { endCursor: 'c1b' },
      },
      variables: { after: 'c2', first: 1 },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];

    expect(state.list.length).toBe(2);

    const entry = state.list.find((e: any) => e.key === 'Asset:1');
    expect(entry.cursor).toBe('c1b');
    expect(entry.edge?.score).toBe(99);
    expect(entityStore.get('Asset:1').name).toBe('A1-new');
  });

  it('writePolicy=replace overwrites entity snapshot, merge keeps unknown fields', () => {
    const { deps, entityStore } = createDeps();

    relay({ paginationMode: 'replace', writePolicy: 'merge' })
      .bind(deps)(
        makeCtx({
          connectionValue: {
            edges: [{ cursor: 'c1', node: { __typename: 'Asset', id: '1', foo: 1, bar: 2 } }],
            pageInfo: {},
          },
        })
      );
    expect(entityStore.get('Asset:1')).toEqual({ foo: 1, bar: 2 });

    relay({ paginationMode: 'replace', writePolicy: 'replace' })
      .bind(deps)(
        makeCtx({
          connectionValue: {
            edges: [{ cursor: 'c1b', node: { __typename: 'Asset', id: '1', foo: 10 } }],
            pageInfo: {},
          },
        })
      );
    expect(entityStore.get('Asset:1')).toEqual({ foo: 10 });
  });

  it('merges pageInfo properties', () => {
    const { deps } = createDeps();
    const fn = relay({ paginationMode: 'append' }).bind(deps);

    fn(makeCtx({
      connectionValue: { edges: [], pageInfo: { endCursor: 'x', hasNextPage: true } },
    }));

    let dump = (fn as any).inspect() as Record<string, any>;
    let key = Object.keys(dump)[0];
    let state = dump[key];
    expect(state.pageInfo).toEqual({ endCursor: 'x', hasNextPage: true });

    fn(makeCtx({
      connectionValue: { edges: [], pageInfo: { endCursor: 'x', hasNextPage: false } },
      variables: { after: 'x', first: 0 },
    }));

    dump = (fn as any).inspect() as Record<string, any>;
    key = Object.keys(dump)[0];
    state = dump[key];
    expect(state.pageInfo).toEqual({ endCursor: 'x', hasNextPage: false });
  });

  it('supports nested node path (e.g., "item.node")', () => {
    const { deps } = createDeps();
    const fn = relay({ paginationMode: 'replace', node: 'item.node' }).bind(deps);

    fn(makeCtx({
      connectionValue: {
        edges: [{ cursor: 'c1', item: { node: { __typename: 'Asset', id: '1', name: 'A1' } } }],
        pageInfo: {},
      },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1']);
  });

  it('append with colliding IDs does not grow list (dedup by entity key)', () => {
    const { deps, entityStore } = createDeps();
    const fn = relay({ paginationMode: 'append' }).bind(deps);

    // page 1: ids 1,2
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1', node: { __typename: 'Asset', id: '1', name: 'A1' } },
          { cursor: 'c2', node: { __typename: 'Asset', id: '2', name: 'A2' } },
        ],
        pageInfo: { endCursor: 'c2', hasNextPage: true },
      },
    }));

    // page 2: colliding ids (1,2) → dedup only updates in place, no growth
    fn(makeCtx({
      connectionValue: {
        edges: [
          { cursor: 'c1b', node: { __typename: 'Asset', id: '1', name: 'A1-new' } },
          { cursor: 'c2b', node: { __typename: 'Asset', id: '2', name: 'A2-new' } },
        ],
        pageInfo: { endCursor: 'c2b', hasNextPage: false },
      },
      variables: { after: 'c2', first: 2 },
    }));

    const dump = (fn as any).inspect() as Record<string, any>;
    const key = Object.keys(dump)[0];
    const state = dump[key];

    expect(state.list.length).toBe(2);
    expect(state.list.map((e: any) => e.key)).toEqual(['Asset:1', 'Asset:2']);
    expect(entityStore.get('Asset:1').name).toBe('A1-new');
    expect(entityStore.get('Asset:2').name).toBe('A2-new');
  });
});
