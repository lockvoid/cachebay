import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { publish } from '@/test/helpers';

describe('Resolvers Integration', () => {
  describe('field transform with context.set', () => {
    it('applies field resolver before publish (non-Relay field)', () => {
      const cache = createCache({
        addTypename: true,
        resolvers: (_ctx: any) => ({
          ProcessorManCook: {
            metadata(resolverCtx: any) {
              // Simulate camelize: foo_bar -> fooBar
              const v = resolverCtx.value || {};
              const out: any = {};
              for (const k of Object.keys(v)) {
                const parts = k.split('_');
                out[parts[0] + parts.slice(1).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join('')] = v[k];
              }
              resolverCtx.set(out);
            },
          },
        }),
      });

      const query = /* GraphQL */ `
        query Q { cook { __typename id metadata } }
      `;

      const published = publish(cache, {
        __typename: 'Query',
        cook: {
          __typename: 'ProcessorManCook',
          id: 1,
          metadata: { foo_bar: 1, nested_key: 2 },
        },
      }, query);

      expect(published?.data?.cook?.metadata).toEqual({ fooBar: 1, nestedKey: 2 });
    });
  });
});
