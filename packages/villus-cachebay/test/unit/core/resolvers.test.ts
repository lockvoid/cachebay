import { describe, it, expect, vi } from 'vitest';
import { createResolvers } from '@/src/core/resolvers';

describe('core/resolvers', () => {
  describe('createResolvers', () => {
    it('creates resolver functions from specs', () => {
      const resolverSpecs = {
        User: {
          name: vi.fn((ctx) => {
            if (ctx.value === 'test') ctx.set('modified');
          }),
        },
      };

      const deps = {
        graph: {
          entityStore: new Map(),
          connectionStore: new Map(),
          operationStore: new Map(),
          putEntity: vi.fn(),
          materializeEntity: vi.fn(),
          ensureConnection: vi.fn(),
          getEntityParentKey: vi.fn(),
          putOperation: vi.fn(),
          identify: vi.fn(),
          isInterfaceType: vi.fn(),
          getInterfaceTypes: vi.fn(),
          getEntityKeys: vi.fn(),
          resolveEntityKey: vi.fn(),
        },
      } as any;

      const res = createResolvers({ resolvers: resolverSpecs }, deps);
      expect(res).toHaveProperty('applyFieldResolvers');
      expect(res).toHaveProperty('applyResolversOnGraph');
      expect(res).toHaveProperty('FIELD_RESOLVERS');
      expect(res.FIELD_RESOLVERS.User).toBeDefined();
      expect(res.FIELD_RESOLVERS.User.name).toBe(resolverSpecs.User.name);
    });

    it('binds __cb_resolver__ specs', () => {
      const impl = vi.fn();
      const bindable = { __cb_resolver__: true as const, bind: vi.fn(() => impl) } as any;

      const resolverSpecs = { Product: { price: bindable } };
      const deps = { graph: {} } as any;

      const res = createResolvers({ resolvers: resolverSpecs }, deps);
      expect(typeof res.FIELD_RESOLVERS.Product.price).toBe('function');
      expect(bindable.bind).toHaveBeenCalled();
    });

    it('handles undefined resolver specs', () => {
      const deps = { graph: {} } as any;
      const res = createResolvers({ resolvers: undefined }, deps);
      expect(res.FIELD_RESOLVERS).toEqual({});
    });
  });

  describe('applyFieldResolvers (signature tracking)', () => {
    it('applies once per vars/hint signature', () => {
      const spy = vi.fn();
      const resolverSpecs = { User: { name: spy } };
      const res = createResolvers({ resolvers: resolverSpecs }, { graph: {} as any });

      const obj: any = { name: 'test' };
      const vars = { id: 1 };

      res.applyFieldResolvers('User', obj, vars);
      expect(spy).toHaveBeenCalledTimes(1);

      // same vars -> no-op
      spy.mockClear();
      res.applyFieldResolvers('User', obj, vars);
      expect(spy).not.toHaveBeenCalled();

      // different hint -> re-apply
      res.applyFieldResolvers('User', obj, vars, { stale: true });
      expect(spy).toHaveBeenCalledTimes(1);
    });
  });

  describe('applyResolversOnGraph (walk)', () => {
    it('walks object graph and applies resolvers per typename', () => {
      const userName = vi.fn();
      const postTitle = vi.fn();

      const resolverSpecs = {
        User: { name: userName },
        Post: { title: postTitle },
      };

      const res = createResolvers({ resolvers: resolverSpecs }, { graph: {} as any });

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

      res.applyResolversOnGraph(root, {}, { stale: false });

      expect(userName).toHaveBeenCalledTimes(1);
      expect(postTitle).toHaveBeenCalledTimes(2);
    });

    it('handles nested arrays/objects without typenames at the root', () => {
      const itemVal = vi.fn();
      const resolverSpecs = { Item: { value: itemVal } };
      const res = createResolvers({ resolvers: resolverSpecs }, { graph: {} as any });

      const root = {
        items: [
          { __typename: 'Item', value: 1 },
          { nested: { __typename: 'Item', value: 2 } },
        ],
      };

      res.applyResolversOnGraph(root, {}, { stale: false });
      expect(itemVal).toHaveBeenCalledTimes(2);
    });
  });
});
