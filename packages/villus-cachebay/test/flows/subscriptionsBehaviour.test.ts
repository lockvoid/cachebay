// test/flows/subscriptionsBehaviour.test.ts
import { describe, it, expect } from 'vitest';
import { createCache } from '@/src';
import { tick } from '@/test/helpers';

// Tiny helper to build a subscription ctx with spies
function subCtx(
  name: string,
  query: string,
  variables: Record<string, any> = {},
  calls: Array<{ name: string; term: boolean; value: any }>
) {
  return {
    operation: { type: 'subscription', query, variables, context: {} },
    useResult: (payload: any, term?: boolean) => {
      const d = payload?.data;
      const val =
        d?.color?.name ??
        (Array.isArray(d?.colors?.edges) ? d.colors.edges[0]?.node?.name : null) ??
        null;
      calls.push({ name, term: !!term, value: val });
    },
    afterQuery: () => { },
  } as any;
}

describe('subscriptions • streaming frames', () => {
  it('applies frames non-terminating and writes entities', async () => {
    const cache = createCache({
      addTypename: true,
      keys: () => ({ Color: (o: any) => (o?.id != null ? String(o.id) : null) }),
    });
    const plugin = cache as unknown as (ctx: any) => void;

    const calls: Array<{ name: string; term: boolean; value: any }> = [];

    const ctx = subCtx('sub', 'subscription S { color { __typename id name } }', {}, calls);
    plugin(ctx);

    // frame 1
    ctx.useResult({
      data: { color: { __typename: 'Color', id: 1, name: 'C1' } }
    }, false);
    await tick(); // flush microtask entity sync

    expect((cache as any).hasFragment('Color:1')).toBe(true);
    expect((cache as any).readFragment('Color:1')?.name).toBe('C1');
    expect(calls).toEqual([{ name: 'sub', term: false, value: 'C1' }]);

    // frame 2 (update same entity)
    ctx.useResult({
      data: { color: { __typename: 'Color', id: 1, name: 'C1b' } }
    }, false);
    await tick(); // ✅ ensure proxy picks up snapshot update

    expect((cache as any).readFragment('Color:1')?.name).toBe('C1b');
    expect(calls).toEqual([
      { name: 'sub', term: false, value: 'C1' },
      { name: 'sub', term: false, value: 'C1b' },
    ]);
  });

  it('passes through observable-like sources untouched (terminate=true)', () => {
    const cache = createCache({});
    const plugin = cache as unknown as (ctx: any) => void;

    const calls: any[] = [];
    const ctx = {
      operation: { type: 'subscription', query: 'subscription S { ping }', variables: {}, context: {} },
      useResult: (payload: any, term?: boolean) => calls.push({ payload, term }),
      afterQuery: () => { },
    } as any;

    plugin(ctx);

    const observableLike = { subscribe() {/* noop */ } };
    ctx.useResult(observableLike, false);

    expect(calls.length).toBe(1);
    expect(calls[0].payload).toBe(observableLike);
    expect(calls[0].term).toBe(true);
  });

  it('forwards error frames non-terminating', () => {
    const cache = createCache({});
    const plugin = cache as unknown as (ctx: any) => void;

    const calls: any[] = [];
    const ctx = {
      operation: { type: 'subscription', query: 'subscription S { ping }', variables: {}, context: {} },
      useResult: (payload: any, term?: boolean) => calls.push({ payload, term }),
      afterQuery: () => { },
    } as any;

    plugin(ctx);
    const err = new Error('boom');
    ctx.useResult({ error: err }, false);

    expect(calls.length).toBe(1);
    expect(calls[0].payload?.error).toBe(err);
    expect(calls[0].term).toBe(false);
  });
});
