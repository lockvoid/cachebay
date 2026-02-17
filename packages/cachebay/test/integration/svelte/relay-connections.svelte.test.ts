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

describe("Relay connections (Svelte)", () => {
  describe("cache-first", () => {
    it("appends new pages at end and updates pageInfo from tail cursor (cache-first)", async () => {
      const routes = [
        {
          when: ({ variables }: any) => !variables.after && variables.first === 2,
          respond: () => ({
            data: {
              __typename: "Query",
              posts: fixtures.posts.buildConnection(
                [{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }],
                { hasNextPage: true },
              ),
            },
          }),
        },
        {
          when: ({ variables }: any) => variables.after === "p2" && variables.first === 2,
          respond: () => ({
            data: {
              __typename: "Query",
              posts: fixtures.posts.buildConnection(
                [{ id: "p3", title: "A3" }, { id: "p4", title: "A4" }],
              ),
            },
          }),
        },
      ];

      let currentAfter = $state<string | null>(null);

      const { cache } = createTestClient({ routes });

      const q = createTestQuery(cache, operations.POSTS_QUERY, {
        variables: () => ({ first: 2, after: currentAfter }),
        cachePolicy: "cache-first",
      });

      const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
      const getPI = () => {
        const pi = q.data?.posts?.pageInfo;
        return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
      };

      await tick(2);
      flushSync();

      expect(getTitles()).toEqual(["A1", "A2"]);
      expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false });

      currentAfter = "p2";
      flushSync();

      await tick(2);
      flushSync();

      expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);
      expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

      q.dispose();
    });
  });

  it("appends new pages at end and updates pageInfo from tail cursor", async () => {
    const routes = [
      {
        when: ({ variables }: any) => !variables.after && variables.first === 2,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }],
              { hasNextPage: true },
            ),
          },
        }),
      },
      {
        when: ({ variables }: any) => variables.after === "p2" && variables.first === 2,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "p3", title: "A3" }, { id: "p4", title: "A4" }],
            ),
          },
        }),
      },
    ];

    let currentAfter = $state<string | null>(null);

    const { cache } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: currentAfter }),
      cachePolicy: "cache-and-network",
    });

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => {
      const pi = q.data?.posts?.pageInfo;
      return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
    };

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2"]);
    expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false });

    currentAfter = "p2";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

    q.dispose();
  });

  it("prepends new pages at start and updates pageInfo from head cursor", async () => {
    const routes = [
      {
        when: ({ variables }: any) => !variables.before && variables.last === 2,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "p3", title: "A3" }, { id: "p4", title: "A4" }],
              { hasPreviousPage: true },
            ),
          },
        }),
      },
      {
        when: ({ variables }: any) => variables.before === "p3" && variables.last === 2,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }],
            ),
          },
        }),
      },
    ];

    let currentBefore = $state<string | null>(null);

    const { cache } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ last: 2, before: currentBefore }),
      cachePolicy: "cache-and-network",
    });

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => {
      const pi = q.data?.posts?.pageInfo;
      return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
    };

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A3", "A4"]);
    expect(getPI()).toEqual({ startCursor: "p3", endCursor: "p4", hasNextPage: false, hasPreviousPage: true });

    currentBefore = "p3";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

    q.dispose();
  });

  it("replaces connection with latest page and updates pageInfo accordingly", async () => {
    const routes = [
      {
        when: ({ variables }: any) => !variables.after && variables.first === 2,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }],
              { hasNextPage: true },
            ),
          },
        }),
      },
      {
        when: ({ variables }: any) => variables.after === "p2" && variables.first === 2,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection(
              [{ id: "p3", title: "A3" }, { id: "p4", title: "A4" }],
            ),
          },
        }),
      },
    ];

    let currentAfter = $state<string | null>(null);

    const { cache } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_WITH_PAGE_QUERY, {
      variables: () => ({ first: 2, after: currentAfter }),
      cachePolicy: "cache-and-network",
    });

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => {
      const pi = q.data?.posts?.pageInfo;
      return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
    };

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2"]);
    expect(getPI()).toEqual({ startCursor: "p1", endCursor: "p2", hasNextPage: true, hasPreviousPage: false });

    currentAfter = "p2";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A3", "A4"]);
    expect(getPI()).toEqual({ startCursor: "p3", endCursor: "p4", hasNextPage: false, hasPreviousPage: false });

    q.dispose();
  });

  it("maintains stable references unless changed", async () => {
    const routes = [
      {
        when: ({ variables }: any) => variables.category === "A" && !variables.after && variables.first === 2,
        respond: () => ({
          data: {
            posts: fixtures.posts.buildConnection(
              [{ id: "p1", title: "A1" }, { id: "p2", title: "A2" }],
              { hasNextPage: true },
            ),
          },
        }),
      },
      {
        when: ({ variables }: any) => variables.category === "A" && variables.after === "p2" && variables.first === 2,
        respond: () => ({
          data: {
            posts: fixtures.posts.buildConnection(
              [{ id: "p3", title: "A3" }, { id: "p4", title: "A4" }],
            ),
          },
        }),
      },
    ];

    const { cache } = createTestClient({ routes });

    let latestData: any;

    const watcher = cache.watchQuery({
      query: operations.POSTS_QUERY,
      variables: { category: "A", first: 2 },
      canonical: true,
      onData: (data: any) => {
        latestData = data;
      },
    });

    await cache.executeQuery({ query: operations.POSTS_QUERY, variables: { category: "A", first: 2 } });
    await tick();

    const connection1 = latestData.posts;
    const edgesRef1 = connection1.edges;

    await cache.executeQuery({ query: operations.POSTS_QUERY, variables: { category: "A", first: 2, after: "p2" } });
    await tick();

    const connection2 = latestData.posts;
    const edgesRef2 = connection2.edges;

    expect(edgesRef2).not.toBe(edgesRef1);
    expect(connection2.edges[0]).toBe(connection1.edges[0]);
    expect(connection2.edges[1]).toBe(connection1.edges[1]);
    expect(connection2.edges[0].node).toBe(connection1.edges[0].node);
    expect(connection2.edges[1].node).toBe(connection1.edges[1].node);

    watcher.unsubscribe();
  });

  it("handles complex infinite (append) pagination flow", async () => {
    const routes = [
      { when: ({ variables }: any) => variables.category === "A" && !variables.after && variables.first === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }], { hasPreviousPage: false, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.after === "pa2" && variables.first === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa3", title: "A3" }, { id: "pa4", title: "A4" }], { hasPreviousPage: true, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.after === "pa4" && variables.first === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa5", title: "A5" }, { id: "pa6", title: "A6" }], { hasPreviousPage: true, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.after === "pa6" && variables.first === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa7", title: "A7" }, { id: "pa8", title: "A8" }], { hasPreviousPage: true, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.after === "pa8" && variables.first === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa9", title: "A9" }, { id: "pa10", title: "A10" }], { hasPreviousPage: true, hasNextPage: false }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "B" && !variables.after && variables.first === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pb3", title: "B1" }, { id: "pb4", title: "B2" }], { hasPreviousPage: false, hasNextPage: false }) } }), delay: 50 },
    ];

    let currentCategory = $state("A");
    let currentFirst = $state(2);
    let currentAfter = $state<string | null>(null);

    const { cache } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ category: currentCategory, first: currentFirst, after: currentAfter }),
      cachePolicy: "cache-and-network",
    });

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => {
      const pi = q.data?.posts?.pageInfo;
      return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
    };

    // 1. Initial load
    await tick();
    flushSync();

    expect(getTitles()).toEqual([]);
    expect(getPI()).toEqual({});

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2"]);
    expect(getPI()).toEqual({ startCursor: "pa1", endCursor: "pa2", hasNextPage: true, hasPreviousPage: false });

    // 2. Paginate after pa2
    currentAfter = "pa2";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);
    expect(getPI()).toEqual({ startCursor: "pa1", endCursor: "pa4", hasNextPage: true, hasPreviousPage: false });

    // 3. Continue pagination after pa4
    currentAfter = "pa4";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 4. Switch to B
    currentCategory = "B";
    currentAfter = null;
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["B1", "B2"]);
    expect(getPI()).toEqual({ startCursor: "pb3", endCursor: "pb4", hasNextPage: false, hasPreviousPage: false });

    // 5. Back to A (cached union)
    currentCategory = "A";
    currentAfter = null;
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 6. Network revalidation resets
    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2"]);
    expect(getPI()).toEqual({ startCursor: "pa1", endCursor: "pa2", hasNextPage: true, hasPreviousPage: false });

    // 7. Re-paginate after pa2
    currentAfter = "pa2";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);

    // 8. Continue after pa4
    currentAfter = "pa4";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    // 9. After pa6
    currentAfter = "pa6";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A1", "A2", "A3", "A4", "A5", "A6", "A7", "A8"]);

    q.dispose();
  });

  it("handles complex infinite (prepend) pagination flow", async () => {
    const routes = [
      { when: ({ variables }: any) => variables.category === "A" && !variables.before && variables.last === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa9", title: "A9" }, { id: "pa10", title: "A10" }], { hasPreviousPage: true, hasNextPage: false }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.before === "pa9" && variables.last === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa7", title: "A7" }, { id: "pa8", title: "A8" }], { hasPreviousPage: true, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.before === "pa7" && variables.last === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa5", title: "A5" }, { id: "pa6", title: "A6" }], { hasPreviousPage: true, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.before === "pa5" && variables.last === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa3", title: "A3" }, { id: "pa4", title: "A4" }], { hasPreviousPage: true, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "A" && variables.before === "pa3" && variables.last === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pa1", title: "A1" }, { id: "pa2", title: "A2" }], { hasPreviousPage: false, hasNextPage: true }) } }), delay: 50 },
      { when: ({ variables }: any) => variables.category === "B" && !variables.before && variables.last === 2, respond: () => ({ data: { __typename: "Query", posts: fixtures.posts.buildConnection([{ id: "pb1", title: "B1" }, { id: "pb2", title: "B2" }], { hasPreviousPage: false, hasNextPage: false }) } }), delay: 50 },
    ];

    let currentCategory = $state("A");
    let currentBefore = $state<string | null>(null);

    const { cache } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ category: currentCategory, last: 2, before: currentBefore }),
      cachePolicy: "cache-and-network",
    });

    const getTitles = () => q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    const getPI = () => {
      const pi = q.data?.posts?.pageInfo;
      return pi ? { startCursor: pi.startCursor, endCursor: pi.endCursor, hasNextPage: pi.hasNextPage, hasPreviousPage: pi.hasPreviousPage } : {};
    };

    // 1. Initial load
    await tick();
    flushSync();

    expect(getTitles()).toEqual([]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A9", "A10"]);
    expect(getPI()).toEqual({ startCursor: "pa9", endCursor: "pa10", hasNextPage: false, hasPreviousPage: true });

    // 2. Prepend older: before pa9
    currentBefore = "pa9";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A9", "A10"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A7", "A8", "A9", "A10"]);
    expect(getPI()).toEqual({ startCursor: "pa7", endCursor: "pa10", hasNextPage: false, hasPreviousPage: true });

    // 3. Continue older: before pa7
    currentBefore = "pa7";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A7", "A8", "A9", "A10"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A5", "A6", "A7", "A8", "A9", "A10"]);

    // 4. Switch to B
    currentCategory = "B";
    currentBefore = null;
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A5", "A6", "A7", "A8", "A9", "A10"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["B1", "B2"]);

    // 5. Back to A (cached)
    currentCategory = "A";
    currentBefore = null;
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A5", "A6", "A7", "A8", "A9", "A10"]);

    // 6. Network revalidation resets to leader
    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A9", "A10"]);

    // 7. Re-prepend: before pa9
    currentBefore = "pa9";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A9", "A10"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A7", "A8", "A9", "A10"]);

    // 8. Continue: before pa7
    currentBefore = "pa7";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A7", "A8", "A9", "A10"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A5", "A6", "A7", "A8", "A9", "A10"]);

    // 9. Before pa5
    currentBefore = "pa5";
    flushSync();

    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A5", "A6", "A7", "A8", "A9", "A10"]);

    await delay(51);
    await tick();
    flushSync();

    expect(getTitles()).toEqual(["A3", "A4", "A5", "A6", "A7", "A8", "A9", "A10"]);

    q.dispose();
  });
});
