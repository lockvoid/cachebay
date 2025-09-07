import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { tick, delay, createFetchMock, type Route } from '@/test/helpers';

const QUERY = /* GraphQL */ `
  query Assets($t: String) {
    assets(filter: $t) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

function Harness(policy: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only', vars: any) {
  return defineComponent({
    setup() {
      const { useQuery } = require('villus');
      const { data } = useQuery({ query: QUERY, variables: vars, cachePolicy: policy });
      return () => h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e.node?.name || '')));
    },
  });
}

function makeClient(routes: Route[]) {
  const cache = createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { assets: relay() } }),
  });
  const fx = createFetchMock(routes);
  const client = createClient({ url: '/test', use: [cache as any, fx.plugin] });
  return { cache, client, fetchMock: fx };
}

/** Seed op cache via a real fetch, but in a different family scope so UI family isn't "already on screen". */
async function seedOpCache(cache: any, variables: any, dataEnvelope: any) {
  const routes: Route[] = [{
    when: ({ variables: v }) => JSON.stringify(v) === JSON.stringify(variables),
    delay: 0,
    respond: () => ({ data: dataEnvelope }),
  }];
  const fx = createFetchMock(routes);
  const seedClient = createClient({ url: '/seed', use: [cache as any, fx.plugin] });
  await seedClient.execute({ query: QUERY, variables, context: { concurrencyScope: 'seed' } });
  fx.restore();
}

describe('Integration • cache policies', () => {
  const restores: Array<() => void> = [];
  afterEach(() => { while (restores.length) (restores.pop()!)(); });

  it('cache-first • miss → one network then render', async () => {
    const routes: Route[] = [{
      when: ({ variables }) => variables.t === 'A',
      delay: 30,
      respond: () => ({
        data: {
          __typename: 'Query',
          assets: {
            __typename: 'AssetConnection',
            edges: [{ cursor: 'a1', node: { __typename: 'Asset', id: 1, name: 'A1' } }],
            pageInfo: { endCursor: 'a1', hasNextPage: false }
          }
        },
      }),
    }];

    const { client, fetchMock } = makeClient(routes);
    restores.push(fetchMock.restore);

    const Comp = Harness('cache-first', { t: 'A' });
    const w = mount(Comp, { global: { plugins: [client as any] } });

    await tick();
    expect(w.findAll('li').length).toBe(0);
    expect(fetchMock.calls.length).toBe(1);

    await delay(40); await tick();
    expect(w.findAll('li').map(li => li.text())).toEqual(['A1']);
  });

  it('cache-and-network • hit → immediate cached render then network refresh once', async () => {
    const { cache } = makeClient([]);

    const cachedC0 = {
      __typename: 'Query',
      assets: {
        __typename: 'AssetConnection',
        edges: [{ node: { __typename: 'Asset', id: 3, name: 'C0' } }],
        pageInfo: { endCursor: 'c0', hasNextPage: false },
      },
    };

    await seedOpCache(cache, { t: 'C' }, cachedC0);

    const routes: Route[] = [{
      when: ({ variables }) => variables.t === 'C',
      delay: 15,
      respond: () => ({
        data: {
          __typename: 'Query',
          assets: {
            __typename: 'AssetConnection',
            edges: [{ node: { __typename: 'Asset', id: 3, name: 'C1' } }],
            pageInfo: { endCursor: 'c1', hasNextPage: false },
          }
        },
      }),
    }];

    const fx = createFetchMock(routes);
    const cnClient = createClient({ url: '/cn', use: [cache as any, fx.plugin] });
    restores.push(fx.restore);

    const w = mount(Harness('cache-and-network', { t: 'C' }), { global: { plugins: [cnClient as any] } });

    // immediate cached render
    await tick(6);
    expect(w.findAll('li').map(li => li.text())).toEqual(['C0']);

    // network refresh
    await delay(20); await tick(6);
    expect(w.findAll('li').map(li => li.text())).toEqual(['C1']);
    expect(fx.calls.length).toBe(1);
  });

  it('network-only → no cache, renders only on network', async () => {
    const routes: Route[] = [{
      when: ({ variables }) => variables.t === 'N',
      delay: 20,
      respond: () => ({
        data: {
          __typename: 'Query',
          assets: {
            __typename: 'AssetConnection',
            edges: [{ cursor: 'n1', node: { __typename: 'Asset', id: 99, name: 'N1' } }],
            pageInfo: { endCursor: 'n1', hasNextPage: false }
          }
        },
      }),
    }];

    const { client, fetchMock } = makeClient(routes);
    restores.push(fetchMock.restore);

    const w = mount(Harness('network-only', { t: 'N' }), { global: { plugins: [client as any] } });

    await tick(6);
    expect(w.findAll('li').length).toBe(0);
    expect(fetchMock.calls.length).toBe(1);

    await delay(25);
    expect(w.findAll('li').map(li => li.text())).toEqual(['N1']);
  });

  it('cache-only • hit renders; miss renders nothing and does not network', async () => {
    const { cache } = makeClient([]);

    const hitData = {
      __typename: 'Query',
      assets: {
        __typename: 'AssetConnection',
        edges: [{ cursor: 'h1', node: { __typename: 'Asset', id: 777, name: 'Hit' } }],
        pageInfo: { endCursor: 'h1', hasNextPage: false },
      },
    };
    await seedOpCache(cache, { t: 'HIT' }, hitData);

    // No routes -> still a working fetch stub, but no recorded matches
    const fxHit = createFetchMock([]);
    const hitClient = createClient({ url: '/co', use: [cache as any, fxHit.plugin] });
    restores.push(fxHit.restore);

    const hit = mount(Harness('cache-only', { t: 'HIT' }), { global: { plugins: [hitClient as any] } });
    await tick(6);
    expect(hit.findAll('li').map(li => li.text())).toEqual(['Hit']);
    expect(fxHit.calls.length).toBe(0);

    // MISS: no op cache entry -> no render, no network
    const fxMiss = createFetchMock([]);
    const missClient = createClient({ url: '/co2', use: [cache as any, fxMiss.plugin] });
    restores.push(fxMiss.restore);

    const miss = mount(Harness('cache-only', { t: 'MISS' }), { global: { plugins: [missClient as any] } });
    await tick(6);
    expect(miss.findAll('li').length).toBe(0);
    expect(fxMiss.calls.length).toBe(0);
  });
});
