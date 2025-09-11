import { describe, it, expect, vi } from 'vitest';
import { createResolvers, makeApplyFieldResolvers, applyResolversOnGraph } from '@/src/core/resolvers';

describe('core/resolvers', () => {
  describe('createResolvers', () => {
    it('creates resolver functions from specs', () => {
      const mockInternals = {
        TYPENAME_KEY: '__typename',
        DEFAULT_WRITE_POLICY: 'replace',
      } as any;

      const resolverSpecs = {
        User: {
          name: vi.fn((ctx) => {
            if (ctx.value === 'test') {
              ctx.set('modified');
            }
          }),
        },
      };

      const result = createResolvers({}, {
        internals: mockInternals,
        resolverSpecs,
      });

      expect(result).toHaveProperty('applyFieldResolvers');
      expect(result).toHaveProperty('applyResolversOnGraph');
      expect(result).toHaveProperty('FIELD_RESOLVERS');
      expect(result.FIELD_RESOLVERS.User).toBeDefined();
      expect(result.FIELD_RESOLVERS.User.name).toBe(resolverSpecs.User.name);
    });

    it('binds resolvers with __cb_resolver__ property', () => {
      const mockInternals = {
        TYPENAME_KEY: '__typename',
        DEFAULT_WRITE_POLICY: 'replace',
      } as any;

      const bindableResolver = {
        __cb_resolver__: true as const,
        bind: vi.fn((internals) => vi.fn()),
      } as any;

      const resolverSpecs = {
        User: {
          special: bindableResolver,
        },
      };

      const result = createResolvers({}, {
        internals: mockInternals,
        resolverSpecs,
      });

      expect(bindableResolver.bind).toHaveBeenCalledWith(mockInternals);
    });

    it('handles undefined resolver specs', () => {
      const mockInternals = {} as any;

      const result = createResolvers({}, {
        internals: mockInternals,
        resolverSpecs: undefined,
      });

      expect(result.FIELD_RESOLVERS).toEqual({});
    });
  });

  describe('makeApplyFieldResolvers', () => {
    it('applies field resolvers with signature tracking', () => {
      const resolver = vi.fn();
      const FIELD_RESOLVERS = {
        User: {
          name: resolver,
        },
      };

      const applyFieldResolvers = makeApplyFieldResolvers({
        TYPENAME_KEY: '__typename',
        FIELD_RESOLVERS,
      });

      const obj = { name: 'test' };
      const vars = { id: 1 };

      applyFieldResolvers('User', obj, vars);

      expect(resolver).toHaveBeenCalledWith({
        parentTypename: 'User',
        field: 'name',
        parent: obj,
        value: 'test',
        variables: vars,
        hint: undefined,
        set: expect.any(Function),
      });

      // Should not apply again with same signature
      resolver.mockClear();
      applyFieldResolvers('User', obj, vars);
      expect(resolver).not.toHaveBeenCalled();
    });

    it('tracks stale hint in signature', () => {
      const resolver = vi.fn();
      const FIELD_RESOLVERS = {
        User: {
          name: resolver,
        },
      };

      const applyFieldResolvers = makeApplyFieldResolvers({
        TYPENAME_KEY: '__typename',
        FIELD_RESOLVERS,
      });

      const obj = {};
      const vars = {};

      applyFieldResolvers('User', obj, vars, { stale: true });
      expect(resolver).toHaveBeenCalled();

      // Different hint should trigger new application
      resolver.mockClear();
      applyFieldResolvers('User', obj, vars, { stale: false });
      expect(resolver).toHaveBeenCalled();
    });
  });

  describe('applyResolversOnGraph', () => {
    it('walks object graph and applies resolvers', () => {
      const userResolver = vi.fn();
      const postResolver = vi.fn();

      const FIELD_RESOLVERS = {
        User: {
          name: userResolver,
        },
        Post: {
          title: postResolver,
        },
      };

      const root = {
        __typename: 'Query',
        user: {
          __typename: 'User',
          name: 'John',
          posts: [
            { __typename: 'Post', title: 'Post 1' },
            { __typename: 'Post', title: 'Post 2' },
          ],
        },
      };

      applyResolversOnGraph(root, {}, { stale: false }, {
        TYPENAME_KEY: '__typename',
        FIELD_RESOLVERS,
      });

      expect(userResolver).toHaveBeenCalledTimes(1);
      expect(postResolver).toHaveBeenCalledTimes(2);
    });

    it('handles nested objects and arrays', () => {
      const resolver = vi.fn();
      const FIELD_RESOLVERS = {
        Item: {
          value: resolver,
        },
      };

      const root = {
        items: [
          { __typename: 'Item', value: 1 },
          { nested: { __typename: 'Item', value: 2 } },
        ],
      };

      applyResolversOnGraph(root, {}, { stale: false }, {
        TYPENAME_KEY: '__typename',
        FIELD_RESOLVERS,
      });

      expect(resolver).toHaveBeenCalledTimes(2);
    });
  });
});
