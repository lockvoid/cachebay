import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, computed, watchEffect } from 'vue';
import { mount } from '@vue/test-utils';
import { createClient } from 'villus';
import { createCache } from '@/src';
import { createFetchMock, waitForListText, type Route, tick, delay } from '@/test/helpers';

const COLORS = /* GraphQL */ `
  query Colors($first:Int,$after:String,$last:Int,$before:String) {
    colors(first:$first, after:$after, last:$last, before:$before) {
      edges { cursor node { __typename id name } }
      pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
    }
  }
`;
const ASSETS = /* GraphQL */ `
  query Assets($t:String) {
    assets(filter:$t) {
      edges { cursor node { __typename id name } }
      pageInfo { endCursor hasNextPage }
    }
  }
`;

function ColorsHarness(
  policy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'network-only',
  scope?: string,
) {
  return defineComponent({
    props: { first: Number, after: String, last: Number, before: String, report: Function },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => ({
        first: props.first,
        after: props.after,
        last: props.last,
        before: props.before,
      }));
      const context = scope ? { concurrencyScope: scope } : {};
      const { data } = useQuery({ query: COLORS, variables: vars, cachePolicy: policy, context });

      if (props.report) {
        watchEffect(() => {
          const edges = (data?.value?.colors?.edges ?? []);
          if (edges && edges.length) {
            (props.report as any)(edges.map((e: any) => e?.node?.name ?? ''));
          }
        });
      }

      return () =>
        h('ul', {}, (data?.value?.colors?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
    },
  });
}

function TabsHarness(policy: 'network-only' | 'cache-first' | 'cache-and-network' | 'cache-only' = 'cache-first') {
  return defineComponent({
    props: { tab: String, report: Function },
    setup(props) {
      const { useQuery } = require('villus');
      const vars = computed(() => ({ t: props.tab }));
      const { data } = useQuery({ query: ASSETS, variables: vars, cachePolicy: policy });

      if (props.report) {
        watchEffect(() => {
          const edges = (data?.value?.assets?.edges ?? []);
          if (edges && edges.length) {
            (props.report as any)(edges.map((e: any) => e?.node?.name ?? ''));
          }
        });
      }

      return () =>
        h('ul', {}, (data?.value?.assets?.edges ?? []).map((e: any) => h('li', {}, e?.node?.name || '')));
    },
  });
}

function makeColorsClient(routes: Route[]) {
  const cache = createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { colors: relay({ paginationMode: 'append' }) } }),
  });
  const fx = createFetchMock(routes);
  const client = createClient({ url: '/colors', use: [cache as any, fx.plugin] });
  return { cache, client, fetchMock: fx };
}
function makeTabsClient(routes: Route[]) {
  const cache = createCache({
    addTypename: true,
    resolvers: ({ relay }: any) => ({ Query: { assets: relay({ paginationMode: 'append' }) } }),
  });
  const fx = createFetchMock(routes);
  const client = createClient({ url: '/tabs', use: [cache as any, fx.plugin] });
  return { cache, client, fetchMock: fx };
}
const liText = (w: any) => w.findAll('li').map((li: any) => li.text());

describe('Integration • take-latest / scope / no blanking', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void, calls: any[] }> = [];
  afterEach(async () => {
    for (const m of mocks) await m.waitAll();
    while (mocks.length) (mocks.pop()!).restore();
  });

  it('Basic take-latest: older non-cursor is dropped after newer', async () => {
    const routes: Route[] = [
      { when: ({ variables }) => variables.first === 2 && !variables.after, delay: 25, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'o1', node: { __typename: 'Color', id: 1, name: 'OLD' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.first === 3 && !variables.after, delay: 5, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'n1', node: { __typename: 'Color', id: 2, name: 'NEW' } }], pageInfo: {} } } }) },
    ];
    const { client, fetchMock } = makeColorsClient(routes);
    mocks.push(fetchMock);

    const w = mount(ColorsHarness('network-only'), { props: { first: 2 }, global: { plugins: [client as any] } });
    await w.setProps({ first: 3 }); await tick();

    await delay(7); await tick(2);
    expect(liText(w)).toEqual(['NEW']);

    await delay(25); await tick(2);
    expect(liText(w)).toEqual(['NEW']);

    // exactly two fetches (older + newer)
    expect(fetchMock.calls.length).toBe(2);
  });

  it('Cursor exception: older cursor page is allowed to apply after latest', async () => {
    const routes: Route[] = [
      { when: ({ variables }) => !variables.after, delay: 5, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'n1', node: { __typename: 'Color', id: 1, name: 'NEW' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.after === 'n1', delay: 25, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'n2', node: { __typename: 'Color', id: 2, name: 'OLD-CURSOR-PAGE' } }], pageInfo: {} } } }) },
    ];
    const { client, fetchMock } = makeColorsClient(routes);
    mocks.push(fetchMock);

    // start older cursor first, then newer
    const w = mount(ColorsHarness('network-only'), { props: { after: 'n1' }, global: { plugins: [client as any] } });
    await w.setProps({ after: undefined }); await tick();

    await delay(7); await tick(2);
    expect(liText(w)).toEqual(['NEW']);

    await delay(25); await tick(2);
    expect(liText(w)).toEqual(['NEW', 'OLD-CURSOR-PAGE']);

    expect(fetchMock.calls.length).toBe(2);
  });

  it('Scope isolation: same query in A/B scopes both deliver', async () => {
    const routes: Route[] = [{ when: () => true, delay: 0, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 's', node: { __typename: 'Color', id: 1, name: 'S' } }], pageInfo: {} } } }) }];
    const { client: a, fetchMock: fa } = makeColorsClient(routes);
    const { client: b, fetchMock: fb } = makeColorsClient(routes);
    mocks.push(fa, fb);

    const WA = mount(ColorsHarness('network-only', 'A'), { props: {}, global: { plugins: [a as any] } });
    const WB = mount(ColorsHarness('network-only', 'B'), { props: {}, global: { plugins: [b as any] } });

    await tick(2);
    expect(liText(WA)).toEqual(['S']);
    expect(liText(WB)).toEqual(['S']);

    expect(fa.calls.length).toBe(1);
    expect(fb.calls.length).toBe(1);
  });

  it('No follower blanking: rapid leaders never produce empty view', async () => {
    const routes: Route[] = [
      { when: ({ variables }) => !variables.after && variables.first === 2, delay: 0, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'p1', node: { __typename: 'Color', id: 1, name: 'P1-1' } }, { cursor: 'p2', node: { __typename: 'Color', id: 2, name: 'P1-2' } }], pageInfo: { endCursor: 'p2', hasNextPage: true } } } }) },
      { when: ({ variables }) => variables.after === 'p2', delay: 40, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'p3', node: { __typename: 'Color', id: 3, name: 'P2-1' } }, { cursor: 'p4', node: { __typename: 'Color', id: 4, name: 'P2-2' } }], pageInfo: { endCursor: 'p4', hasNextPage: true } } } }) },
      { when: ({ variables }) => variables.after === 'p4', delay: 60, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'p5', node: { __typename: 'Color', id: 5, name: 'P3-1' } }], pageInfo: { endCursor: 'p5', hasNextPage: false } } } }) },
    ];
    const { client, fetchMock } = makeColorsClient(routes);
    mocks.push(fetchMock);

    const w = mount(ColorsHarness('network-only'), { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['P1-1', 'P1-2']);

    await w.setProps({ after: 'p2', first: undefined }); await tick();
    await w.setProps({ after: 'p4' }); await tick();

    await delay(10); await tick(2);
    expect(liText(w).length).toBeGreaterThan(0); // never blank
    await delay(95); await tick(2);
    expect(fetchMock.calls.length).toBe(3);
  });
});

describe('Integration • UI latency / tab switching flows + cache-and-network', () => {
  const mocks: Array<{ waitAll: () => Promise<void>, restore: () => void, calls: any[] }> = [];
  afterEach(async () => {
    for (const m of mocks) await m.waitAll();
    while (mocks.length) (mocks.pop()!).restore();
  });

  it('A→C→D (pending) → B (immediate) → C (final): stays on last good, no blanks', async () => {
    const routes: Route[] = [
      { when: ({ variables }) => variables.t === 'A', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'a1', node: { __typename: 'Asset', id: 1, name: 'A1' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.t === 'B', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'b1', node: { __typename: 'Asset', id: 2, name: 'B1' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.t === 'C', delay: 60, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'c1', node: { __typename: 'Asset', id: 3, name: 'C1' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.t === 'D', delay: 80, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'd1', node: { __typename: 'Asset', id: 4, name: 'D1' } }], pageInfo: {} } } }) },
    ];
    const { client, fetchMock } = makeTabsClient(routes);
    mocks.push(fetchMock);

    const reports: string[][] = [];
    const w = mount(TabsHarness('cache-first'), { props: { tab: 'A', report: (x: string[]) => reports.push(x) }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['A1']);

    await w.setProps({ tab: 'C' }); await tick();
    await w.setProps({ tab: 'D' }); await tick();
    expect(liText(w)).toEqual(['A1']);

    await w.setProps({ tab: 'B' }); await tick(2);
    expect(liText(w)).toEqual(['B1']);

    await w.setProps({ tab: 'C' }); await tick();
    expect(liText(w)).toEqual(['B1']);

    await delay(70); await tick(2);
    expect(liText(w)).toEqual(['C1']);
    expect(reports.find(r => r.length === 0)).toBeUndefined();

    // A, C, D, B, C → last C dedupbed → 4 fetches total
    expect(fetchMock.calls.length).toBe(4);
    const aCalls = fetchMock.calls.filter(c => c.variables?.t === 'A').length;
    const bCalls = fetchMock.calls.filter(c => c.variables?.t === 'B').length;
    const cCalls = fetchMock.calls.filter(c => c.variables?.t === 'C').length;
    const dCalls = fetchMock.calls.filter(c => c.variables?.t === 'D').length;
    expect({ aCalls, bCalls, cCalls, dCalls }).toEqual({ aCalls: 1, bCalls: 1, cCalls: 1, dCalls: 1 });
  });

  it('A→B→C→A→B→C (final C): renders A then C only; older in-flights never render', async () => {
    const routes: Route[] = [
      { when: ({ variables }) => variables.t === 'A', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'a', node: { __typename: 'Asset', id: 1, name: 'A' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.t === 'B', delay: 30, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'b', node: { __typename: 'Asset', id: 2, name: 'B' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.t === 'C', delay: 10, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'c', node: { __typename: 'Asset', id: 3, name: 'C' } }], pageInfo: {} } } }) },
    ];
    const { client, fetchMock } = makeTabsClient(routes);
    mocks.push(fetchMock);

    const reports: string[][] = [];
    const w = mount(TabsHarness('network-only'), { props: { tab: 'A', report: (x: string[]) => reports.push(x) }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['A']);

    await w.setProps({ tab: 'B' }); await tick();
    await w.setProps({ tab: 'C' }); await tick();
    await w.setProps({ tab: 'A' }); await tick();
    await w.setProps({ tab: 'B' }); await tick();
    await w.setProps({ tab: 'C' }); await tick();

    await delay(15); await tick(2);
    expect(liText(w)).toEqual(['C']);
    expect(reports.some(r => r.length === 1 && r[0] === 'B')).toBe(false);

    const aCalls = fetchMock.calls.filter(c => c.variables?.t === 'A').length;
    const bCalls = fetchMock.calls.filter(c => c.variables?.t === 'B').length;
    const cCalls = fetchMock.calls.filter(c => c.variables?.t === 'C').length;
    expect(bCalls).toBe(1);
    expect(aCalls).toBeGreaterThanOrEqual(1);
    expect(cCalls).toBeGreaterThanOrEqual(1);
  });

  it('Return to cached tab: revisiting B with identical object may re-emit at most twice (first + revisit); no network', async () => {
    const seedRoutes: Route[] = [
      { when: ({ variables }) => variables.t === 'B', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'b1', node: { __typename: 'Asset', id: 2, name: 'B1' } }], pageInfo: {} } } }) },
    ];
    const { cache } = makeTabsClient(seedRoutes);
    const seedFx = createFetchMock(seedRoutes);
    const seedClient = createClient({ url: '/seed', use: [cache as any, seedFx.plugin] });
    await seedClient.execute({ query: ASSETS, variables: { t: 'B' }, context: { concurrencyScope: 'seed' } });
    await seedFx.waitAll(); seedFx.restore();

    const fx = createFetchMock([]); // no network should be recorded
    const client = createClient({ url: '/tabs', use: [cache as any, fx.plugin] });
    const renders: string[][] = [];
    const w = mount(TabsHarness('cache-first'), { props: { tab: 'B', report: (x: string[]) => renders.push(x) }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['B1']);
    expect(fx.calls.length).toBe(0);

    await w.setProps({ tab: 'A' }); await tick(2);
    await w.setProps({ tab: 'B' }); await tick(2);

    expect(fx.calls.length).toBe(0);
    expect(liText(w)).toEqual(['B1']);
    const bRenders = renders.filter(r => JSON.stringify(r) === JSON.stringify(['B1']));
    expect(bRenders.length).toBeLessThanOrEqual(2);
  });

  it('cache-and-network: cached render THEN refresh; latest wins across families', async () => {
    const seedRoutes: Route[] = [
      { when: ({ variables }) => variables.t === 'X', delay: 0, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'x', node: { __typename: 'Asset', id: 1, name: 'X0' } }], pageInfo: {} } } }) },
    ];
    const { cache } = makeTabsClient(seedRoutes);
    const seedFx = createFetchMock(seedRoutes);
    const seedClient = createClient({ url: '/seed', use: [cache as any, seedFx.plugin] });
    await seedClient.execute({ query: ASSETS, variables: { t: 'X' }, context: { concurrencyScope: 'seed' } });
    await seedFx.waitAll(); seedFx.restore();

    const routes: Route[] = [
      { when: ({ variables }) => variables.t === 'X', delay: 40, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'x1', node: { __typename: 'Asset', id: 1, name: 'X1' } }], pageInfo: {} } } }) },
      { when: ({ variables }) => variables.t === 'Y', delay: 5, respond: () => ({ data: { __typename: 'Query', assets: { __typename: 'AssetConnection', edges: [{ cursor: 'y1', node: { __typename: 'Asset', id: 2, name: 'Y1' } }], pageInfo: {} } } }) },
    ];
    const fx = createFetchMock(routes);
    const client = createClient({ url: '/tabs', use: [cache as any, fx.plugin] });

    const w = mount(TabsHarness('cache-and-network'), { props: { tab: 'X' }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['X0']);

    await w.setProps({ tab: 'Y' }); await tick();

    await delay(7); await tick(2);
    expect(liText(w)).toEqual(['Y1']);

    await delay(40); await tick(2);
    expect(liText(w)).toEqual(['Y1']);

    expect(fx.calls.length).toBe(2);
    const xCalls = fx.calls.filter(c => c.variables?.t === 'X').length;
    const yCalls = fx.calls.filter(c => c.variables?.t === 'Y').length;
    expect(xCalls).toBe(1);
    expect(yCalls).toBe(1);
  });

  it('cache-and-network: cursor page cached immediate reveal + revalidate merge', async () => {
    const routes: Route[] = [
      { when: ({ variables }) => variables.first === 2 && !variables.after, delay: 0, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'c1', node: { __typename: 'Color', id: 1, name: 'P1-1' } }, { cursor: 'c2', node: { __typename: 'Color', id: 2, name: 'P1-2' } }], pageInfo: { endCursor: 'c2', hasNextPage: true } } } }) },
      { when: ({ variables }) => variables.after === 'c2' && variables.first === 2, delay: 20, respond: () => ({ data: { __typename: 'Query', colors: { __typename: 'ColorConnection', edges: [{ cursor: 'c3', node: { __typename: 'Color', id: 3, name: 'P2-1' } }, { cursor: 'c4', node: { __typename: 'Color', id: 4, name: 'P2-2' } }], pageInfo: { endCursor: 'c4', hasNextPage: false } } } }) },
    ];
    const { client, fetchMock } = makeColorsClient(routes);
    mocks.push(fetchMock);

    const w = mount(ColorsHarness('cache-and-network'), { props: { first: 2 }, global: { plugins: [client as any] } });

    await tick(2);
    expect(liText(w)).toEqual(['P1-1', 'P1-2']);

    await w.setProps({ first: 2, after: 'c2' }); await tick();

    await delay(25); await tick(2);
    expect(liText(w)).toEqual(['P1-1', 'P1-2', 'P2-1', 'P2-2']);

    expect(fetchMock.calls.length).toBe(2);
  });

  it('cache-and-network: rapid leaders X→Y→X; dedup → final X renders and Y never renders', async () => {
    const routes: Route[] = [
      {
        when: ({ variables }) => variables.t === 'X',
        delay: 25,
        respond: () => ({
          data: {
            __typename: 'Query',
            assets: { __typename: 'AssetConnection', edges: [{ cursor: 'x', node: { __typename: 'Asset', id: 1, name: 'X' } }], pageInfo: {} },
          },
        }),
      },
      {
        when: ({ variables }) => variables.t === 'Y',
        delay: 5,
        respond: () => ({
          data: {
            __typename: 'Query',
            assets: { __typename: 'AssetConnection', edges: [{ cursor: 'y', node: { __typename: 'Asset', id: 2, name: 'Y' } }], pageInfo: {} },
          },
        }),
      },
    ];

    const fx = createFetchMock(routes);
    const cache = createCache({
      addTypename: true,
      resolvers: ({ relay }: any) => ({
        Query: { assets: relay({ paginationMode: 'append' }) },
      }),
    });
    const client = createClient({ url: '/tabs', use: [cache as any, fx.plugin] });

    const renders: string[][] = [];
    const w = mount(TabsHarness('cache-and-network'), {
      props: { tab: 'X', report: (x: string[]) => renders.push(x) },
      global: { plugins: [client as any] },
    });

    // Flip quickly: X → Y → X
    await w.setProps({ tab: 'Y' });
    await w.setProps({ tab: 'X' });
    await delay(40); await tick(2);

    expect(liText(w)).toEqual(['X']);
    const anyYRender = renders.some(r => r.length === 1 && r[0] === 'Y');
    expect(anyYRender).toBe(false);

    // Dedup: exactly one X fetch and one Y fetch
    const xCalls = fx.calls.filter(c => c.variables?.t === 'X').length;
    const yCalls = fx.calls.filter(c => c.variables?.t === 'Y').length;
    expect(xCalls).toBe(1);
    expect(yCalls).toBe(1);

    await fx.waitAll(); fx.restore();
  });
});
