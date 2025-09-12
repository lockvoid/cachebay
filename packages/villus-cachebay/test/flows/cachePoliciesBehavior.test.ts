import { describe, it, expect, afterEach } from 'vitest';
import { defineComponent, h, watch } from 'vue';
import { mount } from '@vue/test-utils';
import {
  createListComponent,
  createWatcherComponent,
  mountWithClient,
  getListItems,
  waitForList,
  testQueries,
  mockResponses,
  cacheConfigs,
  createTestClient
} from '@/test/helpers/integration';
import { tick, delay, seedCache, type Route } from '@/test/helpers';

describe('Integration • Cache Policies Behavior', () => {
  const restores: Array<() => void> = [];

  afterEach(() => {
    while (restores.length) (restores.pop()!)();
  });

  describe('cache-first policy', () => {
    it('miss → one network then render', async () => {
      const routes: Route[] = [{
        when: ({ variables }) => variables.filter === 'tech',
        delay: 30,
        respond: () => mockResponses.posts(['First Post']),
      }];

      const Component = createListComponent(testQueries.POSTS, { filter: 'tech' }, { cachePolicy: 'cache-first' });
      const { wrapper, fx } = await mountWithClient(Component, routes, cacheConfigs.withRelay());
      restores.push(fx.restore);

      await tick();
      expect(getListItems(wrapper).length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(40);
      await tick();
      expect(getListItems(wrapper)).toEqual(['First Post']);
    });

    it('hit emits cached and terminates, no network call', async () => {
      const cache = cacheConfigs.withRelay();

      await seedCache(cache, {
        query: testQueries.POSTS,
        variables: { filter: 'cached' },
        data: mockResponses.posts(['Cached Post']).data,
        materialize: true,
      });

      // Let cache settle and clear hydration state
      await delay(5);

      const Component = createListComponent(testQueries.POSTS, { filter: 'cached' }, { cachePolicy: 'cache-first' });
      const { wrapper, fx } = await mountWithClient(Component, [], cache);
      restores.push(fx.restore);

      await delay(10);
      expect(getListItems(wrapper)).toEqual(['Cached Post']);
      expect(fx.calls.length).toBe(0);
    });
  });

  describe('cache-and-network policy', () => {
    it('hit → immediate cached render then network refresh once', async () => {
      const cache = cacheConfigs.withRelay();

      // Seed cache with initial data
      await seedCache(cache, {
        query: testQueries.POSTS,
        variables: { filter: 'news' },
        data: mockResponses.posts(['Old News']).data,
        materialize: true,
      });

      // Let cache settle and clear hydration state
      await delay(5);

      const routes: Route[] = [{
        when: ({ variables }) => variables.filter === 'news',
        delay: 15,
        respond: () => mockResponses.posts(['Fresh News']),
      }];

      const Component = createListComponent(testQueries.POSTS, { filter: 'news' }, { cachePolicy: 'cache-and-network' });
      const { wrapper, fx } = await mountWithClient(Component, routes, cache);
      restores.push(fx.restore);

      // immediate cached render
      await delay(10);
      expect(getListItems(wrapper)).toEqual(['Old News']);

      // network refresh
      await delay(20);
      await tick(6);
      expect(getListItems(wrapper)).toEqual(['Fresh News']);
      expect(fx.calls.length).toBe(1);
    });

    it('identical network as cache → single render', async () => {
      const cache = cacheConfigs.withRelay();
      const cachedData = mockResponses.posts(['Same Post']).data;

      await seedCache(cache, {
        query: testQueries.POSTS,
        variables: { filter: 'same' },
        data: cachedData,
        materialize: true,
      });

      // Let cache settle and clear hydration state
      await delay(5);

      const routes: Route[] = [{
        when: ({ variables }) => variables.filter === 'same',
        delay: 10,
        respond: () => ({ data: cachedData }), // Same data
      }];

      const Component = createListComponent(testQueries.POSTS, { filter: 'same' }, { cachePolicy: 'cache-and-network' });
      const { wrapper, fx } = await mountWithClient(Component, routes, cache);
      restores.push(fx.restore);

      await delay(10);
      expect(getListItems(wrapper)).toEqual(['Same Post']);

      await delay(15);
      await tick(2);
      expect(getListItems(wrapper)).toEqual(['Same Post']); // Still same
      expect(fx.calls.length).toBe(1);
    });

    it('different network → two renders', async () => {
      const cache = cacheConfigs.withRelay();

      await seedCache(cache, {
        query: testQueries.POSTS,
        variables: { filter: 'diff' },
        data: mockResponses.posts(['Initial Post']).data,
        materialize: true,
      });

      // Let cache settle and clear hydration state
      await delay(5);

      const routes: Route[] = [{
        when: ({ variables }) => variables.filter === 'diff',
        delay: 10,
        respond: () => mockResponses.posts(['Updated Post']), // Different data
      }];

      const renders: string[][] = [];
      const Component = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data } = useQuery({
            query: testQueries.POSTS,
            variables: { filter: 'diff' },
            cachePolicy: 'cache-and-network'
          });

          watch(() => data.value, (v) => {
            const titles = (v?.posts?.edges ?? []).map((e: any) => e?.node?.title || '');
            if (titles.length) renders.push(titles);
          }, { immediate: true });

          return () => h('ul', {},
            (data?.value?.posts?.edges ?? []).map((e: any) =>
              h('li', {}, e?.node?.title || '')
            )
          );
        }
      });

      const { wrapper, fx } = await mountWithClient(Component, routes, cache);
      restores.push(fx.restore);

      // Should see cached data immediately
      await tick(2);
      expect(getListItems(wrapper)).toEqual(['Initial Post']);

      await delay(15);
      await tick(2);
      expect(renders).toEqual([['Initial Post'], ['Updated Post']]); // Two renders observed
      expect(getListItems(wrapper)).toEqual(['Updated Post']); // DOM shows latest
      expect(fx.calls.length).toBe(1);
    });

    it('miss → one render on network response', async () => {
      const routes: Route[] = [{
        when: ({ variables }) => variables.filter === 'miss',
        delay: 5,
        respond: () => mockResponses.posts(['New Post']),
      }];

      const Component = createListComponent(testQueries.POSTS, { filter: 'miss' }, { cachePolicy: 'cache-and-network' });
      const { wrapper, fx } = await mountWithClient(Component, routes, cacheConfigs.withRelay());
      restores.push(fx.restore);

      await tick(2);
      expect(getListItems(wrapper)).toEqual([]); // No cached data

      await delay(8);
      await tick(2);
      expect(getListItems(wrapper)).toEqual(['New Post']);
      expect(fx.calls.length).toBe(1);
    });
  });

  describe('network-only policy', () => {
    it('no cache, renders only on network', async () => {
      const routes: Route[] = [{
        when: ({ variables }) => variables.filter === 'network',
        delay: 20,
        respond: () => mockResponses.posts(['Network Post']),
      }];

      const Component = createListComponent(testQueries.POSTS, { filter: 'network' }, { cachePolicy: 'network-only' });
      const { wrapper, fx } = await mountWithClient(Component, routes, cacheConfigs.withRelay());
      restores.push(fx.restore);

      await tick(6);
      expect(getListItems(wrapper).length).toBe(0);
      expect(fx.calls.length).toBe(1);

      await delay(25);
      expect(getListItems(wrapper)).toEqual(['Network Post']);
    });
  });

  describe('cache-only policy', () => {
    it('hit renders cached data, no network call', async () => {
      const cache = cacheConfigs.withRelay();

      await seedCache(cache, {
        query: testQueries.POSTS,
        variables: { filter: 'hit' },
        data: mockResponses.posts(['Hit Post']).data,
        materialize: true,
      });

      // Let cache settle and clear hydration state
      await delay(5);

      const Component = createListComponent(testQueries.POSTS, { filter: 'hit' }, { cachePolicy: 'cache-only' });
      const { wrapper, fx } = await mountWithClient(Component, [], cache);
      restores.push(fx.restore);

      await delay(10);
      expect(getListItems(wrapper)).toEqual(['Hit Post']);
      expect(fx.calls.length).toBe(0);
    });

    it('miss renders nothing and does not network', async () => {
      const Component = createListComponent(testQueries.POSTS, { filter: 'miss' }, { cachePolicy: 'cache-only' });
      const { wrapper, fx } = await mountWithClient(Component, [], cacheConfigs.withRelay());
      restores.push(fx.restore);

      await tick(6);
      expect(getListItems(wrapper).length).toBe(0);
      expect(fx.calls.length).toBe(0);
    });

    it('miss yields CacheOnlyMiss error', async () => {
      const Component = defineComponent({
        setup() {
          const { useQuery } = require('villus');
          const { data, error } = useQuery({
            query: testQueries.POSTS,
            variables: { filter: 'miss' },
            cachePolicy: 'cache-only'
          });
          return () => h('div', {},
            error?.value?.networkError?.name ||
            (data?.value?.posts?.edges?.length ?? 0)
          );
        }
      });

      const { wrapper, fx } = await mountWithClient(Component, [], cacheConfigs.withRelay());
      restores.push(fx.restore);

      await tick(2);
      expect(wrapper.text()).toContain('CacheOnlyMiss');
      expect(fx.calls.length).toBe(0);
    });
  });

  describe('cursor replay with relay resolver', () => {
    it('publishes terminally (append/prepend/replace)', async () => {
      const routes: Route[] = [{
        when: ({ variables }) => variables.after === 'c2' && variables.first === 2,
        delay: 10,
        respond: () => ({
          data: {
            __typename: 'Query',
            comments: {
              __typename: 'CommentConnection',
              edges: [
                { cursor: 'c3', node: { __typename: 'Comment', id: '3', text: 'Comment 3', postId: '1', authorId: '1' } },
                { cursor: 'c4', node: { __typename: 'Comment', id: '4', text: 'Comment 4', postId: '1', authorId: '1' } },
              ],
              pageInfo: {
                startCursor: 'c3',
                endCursor: 'c4',
                hasNextPage: false,
                hasPreviousPage: true
              },
            },
          },
        }),
      }];

      const Component = createListComponent(
        testQueries.COMMENTS,
        { postId: '1', first: 2, after: 'c2' },
        {
          cachePolicy: 'network-only',
          dataPath: 'comments',
          itemPath: 'edges',
          keyPath: 'node.text'
        }
      );

      const { wrapper, fx } = await mountWithClient(Component, routes, cacheConfigs.withRelay());
      restores.push(fx.restore);

      await delay(12);
      await tick(2);
      expect(getListItems(wrapper)).toEqual(['Comment 3', 'Comment 4']);
    });
  });
});
