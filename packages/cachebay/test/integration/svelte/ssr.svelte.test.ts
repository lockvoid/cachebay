import { flushSync } from "svelte";
import {
  createTestClient,
  createTestQuery,
  seedCache,
  fixtures,
  operations,
  delay,
  tick,
} from "./helpers.svelte";

const ssrRoundtrip = async ({ routes }: { routes: any[] }) => {
  const serverClient = createTestClient({
    cacheOptions: {
      suspensionTimeout: 1,
      hydrationTimeout: 200,
    },
  });

  await seedCache(serverClient.cache, {
    query: operations.POSTS_QUERY,
    variables: {
      category: "lifestyle",
      first: 2,
      after: null,
    },
    data: {
      __typename: "Query",
      posts: fixtures.posts.buildConnection([
        { id: "p1", title: "A1" },
        { id: "p2", title: "A2" },
      ]),
    },
  });

  const snapshot = serverClient.cache.dehydrate();

  const result = createTestClient({
    routes,
    cacheOptions: {
      suspensionTimeout: 1,
      hydrationTimeout: 200,
    },
  });

  result.cache.hydrate(snapshot);

  return result;
};

const routes = [
  {
    when: ({ variables }: any) => variables.category === "lifestyle" && !variables.after && variables.first === 2,
    respond: () => ({
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([
          { id: "p1", title: "A1" },
          { id: "p2", title: "A2" },
        ]),
      },
    }),
  },
  {
    when: ({ variables }: any) => variables.category === "music" && !variables.after && variables.first === 2,
    respond: () => ({
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([
          { id: "p3", title: "B1" },
          { id: "p4", title: "B2" },
        ]),
      },
    }),
  },
];

describe("SSR (Svelte)", () => {
  describe("cache-and-network", () => {
    it("swallows cached requests but fires uncached requests during hydration", async () => {
      const { cache, fx } = await ssrRoundtrip({ routes });

      let currentCategory = $state("lifestyle");

      const q = createTestQuery(cache, operations.POSTS_QUERY, {
        variables: () => ({ first: 2, after: null, category: currentCategory }),
        cachePolicy: "cache-and-network",
      });

      const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

      // 1. Cached data, no request
      await tick();
      flushSync();
      await delay(20);
      flushSync();

      expect(getTitles()).toEqual(["A1", "A2"]);
      expect(fx.calls.length).toBe(0);

      // 2. Switch to uncached
      currentCategory = "music";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(1);
      expect(getTitles()).toEqual(["B1", "B2"]);

      // 3. Switch back to cached
      currentCategory = "lifestyle";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(1); // No new request during hydration
      expect(getTitles()).toEqual(["A1", "A2"]);

      q.dispose();
      await fx.restore();
    });
  });

  describe("cache-first", () => {
    it("swallows cached requests but fires uncached requests during hydration", async () => {
      const { cache, fx } = await ssrRoundtrip({ routes });

      let currentCategory = $state("lifestyle");

      const q = createTestQuery(cache, operations.POSTS_QUERY, {
        variables: () => ({ first: 2, after: null, category: currentCategory }),
        cachePolicy: "cache-first",
      });

      const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

      await tick();
      flushSync();
      await delay(20);
      flushSync();

      expect(getTitles()).toEqual(["A1", "A2"]);
      expect(fx.calls.length).toBe(0);

      currentCategory = "music";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(1);
      expect(getTitles()).toEqual(["B1", "B2"]);

      currentCategory = "lifestyle";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(1);
      expect(getTitles()).toEqual(["A1", "A2"]);

      q.dispose();
      await fx.restore();
    });
  });

  describe("network-only", () => {
    it("swallows cached requests but fires uncached requests during hydration", async () => {
      const { cache, fx } = await ssrRoundtrip({ routes });

      let currentCategory = $state("lifestyle");

      const q = createTestQuery(cache, operations.POSTS_QUERY, {
        variables: () => ({ first: 2, after: null, category: currentCategory }),
        cachePolicy: "network-only",
      });

      const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

      await tick();
      flushSync();
      await delay(20);
      flushSync();

      expect(getTitles()).toEqual(["A1", "A2"]);
      expect(fx.calls.length).toBe(0);

      currentCategory = "music";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(1);
      expect(getTitles()).toEqual(["B1", "B2"]);

      currentCategory = "lifestyle";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(1);
      expect(getTitles()).toEqual(["A1", "A2"]);

      q.dispose();
      await fx.restore();
    });
  });

  describe("cache-only", () => {
    it("never fires requests, even for uncached data", async () => {
      const { cache, fx } = await ssrRoundtrip({ routes });

      let currentCategory = $state("lifestyle");

      const q = createTestQuery(cache, operations.POSTS_QUERY, {
        variables: () => ({ first: 2, after: null, category: currentCategory }),
        cachePolicy: "cache-only",
      });

      const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];

      await tick();
      flushSync();
      await delay(20);
      flushSync();

      expect(getTitles()).toEqual(["A1", "A2"]);
      expect(fx.calls.length).toBe(0);

      // Switch to uncached — no request fires
      currentCategory = "music";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(0); // Still 0

      // Switch back to cached
      currentCategory = "lifestyle";
      flushSync();

      await delay(20);
      await tick();
      flushSync();

      expect(fx.calls.length).toBe(0);
      expect(getTitles()).toEqual(["A1", "A2"]);

      q.dispose();
      await fx.restore();
    });
  });
});
