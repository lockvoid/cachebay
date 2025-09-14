// test/unit/core/resolvers.test.ts
import { describe, it, expect, vi } from 'vitest';
import { createResolvers } from '@/src/core/resolvers';

// ──────────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────────

// Minimal graph doubles used where needed
const makeGraphDeps = (
  overrides: Partial<{ materializeEntity: any; materializeSelection: any }> = {}
) =>
({
  graph: {
    materializeEntity: overrides.materializeEntity ?? vi.fn(),
    materializeSelection: overrides.materializeSelection ?? vi.fn(),
  },
} as any);

// ──────────────────────────────────────────────────────────────────────────────
// createResolvers
// ──────────────────────────────────────────────────────────────────────────────
describe('core/resolvers • createResolvers', () => {
  it('exposes FIELD_RESOLVERS and apply helpers', () => {
    const resolverSpecs = {
      User: {
        name: vi.fn((ctx) => {
          if (ctx.value === 'test') ctx.set('modified');
        }),
      },
    };

    const api = createResolvers({ resolvers: resolverSpecs }, makeGraphDeps());
    expect(api).toHaveProperty('FIELD_RESOLVERS');
    expect(api).toHaveProperty('applyFieldResolvers');
    expect(api).toHaveProperty('applyOnObject');
    expect(api).toHaveProperty('applyOnEntity');
    expect(api).toHaveProperty('applyOnSelection');

    expect(api.FIELD_RESOLVERS.User).toBeDefined();
    expect(api.FIELD_RESOLVERS.User.name).toBe(resolverSpecs.User.name);
  });

  it('binds __cb_resolver__ specs', () => {
    const impl = vi.fn();
    const bindable = { __cb_resolver__: true as const, bind: vi.fn(() => impl) } as any;

    const api = createResolvers(
      { resolvers: { Product: { price: bindable } } },
      makeGraphDeps()
    );

    expect(typeof api.FIELD_RESOLVERS.Product.price).toBe('function');
    expect(bindable.bind).toHaveBeenCalled();
  });

  it('handles undefined resolver specs', () => {
    const api = createResolvers({ resolvers: undefined }, makeGraphDeps());
    expect(api.FIELD_RESOLVERS).toEqual({});
  });
});

// ──────────────────────────────────────────────────────────────────────────────
/** applyFieldResolvers (signature / idempotence) */
// ──────────────────────────────────────────────────────────────────────────────
describe('core/resolvers • applyFieldResolvers (signature tracking)', () => {
  it('applies once per vars/hint signature', () => {
    const spy = vi.fn();
    const api = createResolvers({ resolvers: { User: { name: spy } } }, makeGraphDeps());

    const obj: any = { name: 'test' };
    const vars = { id: 1 };

    api.applyFieldResolvers('User', obj, vars);
    expect(spy).toHaveBeenCalledTimes(1);

    // Same vars → no re-run
    spy.mockClear();
    api.applyFieldResolvers('User', obj, vars);
    expect(spy).not.toHaveBeenCalled();

    // Different hint (stale) → re-apply
    api.applyFieldResolvers('User', obj, vars, { stale: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
/** applyOnObject (tree walk) */
// ──────────────────────────────────────────────────────────────────────────────
describe('core/resolvers • applyOnObject (walk)', () => {
  it('walks object graph and applies resolvers per typename', () => {
    const userName = vi.fn();
    const postTitle = vi.fn();

    const api = createResolvers(
      { resolvers: { User: { name: userName }, Post: { title: postTitle } } },
      makeGraphDeps()
    );

    const root = {
      __typename: 'Query',
      user: {
        __typename: 'User',
        name: 'John',
        posts: [
          { __typename: 'Post', title: 'P1' },
          { __typename: 'Post', title: 'P2' },
        ],
      },
    };

    api.applyOnObject(root, {}, { stale: false });

    expect(userName).toHaveBeenCalledTimes(1);
    expect(postTitle).toHaveBeenCalledTimes(2);
  });

  it('handles nested arrays/objects without __typename at the root', () => {
    const itemVal = vi.fn();
    const api = createResolvers(
      { resolvers: { Item: { value: itemVal } } },
      makeGraphDeps()
    );

    const root = {
      items: [
        { __typename: 'Item', value: 1 },
        { nested: { __typename: 'Item', value: 2 } },
      ],
    };

    api.applyOnObject(root, {}, { stale: false });
    expect(itemVal).toHaveBeenCalledTimes(2);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
/** applyOnEntity / applyOnSelection (materialize + resolve) */
// ──────────────────────────────────────────────────────────────────────────────
describe('core/resolvers • applyOnEntity / applyOnSelection', () => {
  it('materializes an entity by key and applies resolvers', () => {
    const changeName = vi.fn(({ value, set }) => set(String(value).toUpperCase()));
    const entityObj = { __typename: 'User', name: 'john' };

    const api = createResolvers(
      { resolvers: { User: { name: changeName } } },
      makeGraphDeps({ materializeEntity: vi.fn(() => entityObj) })
    );

    const proxy = api.applyOnEntity('User:1', {});
    expect(proxy.name).toBe('JOHN');
    expect(changeName).toHaveBeenCalledTimes(1);
  });

  it('materializes a selection by key and applies resolvers on its tree', () => {
    const bump = vi.fn(({ value, set }) => set((value ?? 0) + 1));
    const selectionTree = {
      __typename: 'Stats',
      total: 5,
      nested: { __typename: 'Stats', total: 1 },
    };

    const api = createResolvers(
      { resolvers: { Stats: { total: bump } } },
      makeGraphDeps({ materializeSelection: vi.fn(() => selectionTree) })
    );

    const out = api.applyOnSelection('stats({})', {});
    expect(out.total).toBe(6);
    expect(out.nested.total).toBe(2);
    expect(bump).toHaveBeenCalledTimes(2); // root + nested
  });
});

// ──────────────────────────────────────────────────────────────────────────────
/** Behavior-oriented tests with a tiny changeCase resolver */
// ──────────────────────────────────────────────────────────────────────────────
describe('core/resolvers • changeCase helper', () => {
  const changeCase = (mode: 'uppercase' | 'lowercase') =>
    (({ value, set }) => {
      if (typeof value !== 'string') return;
      set(mode === 'uppercase' ? value.toUpperCase() : value.toLowerCase());
    }) as any;

  it('uppercases a simple field', () => {
    const api = createResolvers(
      { resolvers: { User: { name: changeCase('uppercase') } } },
      makeGraphDeps()
    );

    const obj = { __typename: 'User', name: 'john' };
    api.applyOnObject(obj, {});
    expect(obj.name).toBe('JOHN');
  });

  it('lowercases nested array fields', () => {
    const api = createResolvers(
      { resolvers: { Post: { title: changeCase('lowercase') } } },
      makeGraphDeps()
    );

    const root = {
      __typename: 'Query',
      user: {
        __typename: 'User',
        posts: [
          { __typename: 'Post', title: 'Hello' },
          { __typename: 'Post', title: 'WORLD' },
        ],
      },
    };

    api.applyOnObject(root, {});
    expect(root.user.posts.map((p) => p.title)).toEqual(['hello', 'world']);
  });

  it('applies once per signature (idempotent with same vars)', () => {
    const spy = vi.fn(changeCase('uppercase'));
    const api = createResolvers(
      { resolvers: { User: { name: spy } } },
      makeGraphDeps()
    );

    const obj = { __typename: 'User', name: 'john' };

    api.applyOnObject(obj, { id: 1 });
    api.applyOnObject(obj, { id: 1 }); // same vars → no re-apply
    expect(spy).toHaveBeenCalledTimes(1);
    expect(obj.name).toBe('JOHN');

    // Different signature (stale flag) → re-apply
    api.applyOnObject(obj, { id: 1 }, { stale: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
