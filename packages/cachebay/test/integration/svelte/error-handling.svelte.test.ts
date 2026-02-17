import { flushSync } from "svelte";
import {
  createTestClient,
  createTestQuery,
  fixtures,
  operations,
  delay,
  tick,
} from "./helpers.svelte";

describe("Error Handling (Svelte)", () => {
  it("records transport errors without data emissions on cold network-only", async () => {
    const routes = [
      {
        when: ({ variables }: any) => variables.first === 2 && !variables.after,
        respond: () => ({ error: new Error("🥲") }),
        delay: 5,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2 }),
      cachePolicy: "network-only",
    });

    await tick();
    flushSync();

    await delay(20);
    await tick();
    flushSync();

    expect(q.errorUpdates.length).toBe(1);
    expect(q.errorUpdates[0]?.message).toBe("[Network] 🥲");
    expect(q.data).toBeUndefined();

    q.dispose();
    await fx.restore();
  });

  it("drops older errors when newer data arrives (latest-variables win)", async () => {
    let currentFirst = $state(2);

    const routes = [
      {
        when: ({ variables }: any) => variables.first === 2 && !variables.after,
        respond: () => ({ error: new Error("🥲") }),
        delay: 30,
      },
      {
        when: ({ variables }: any) => variables.first === 3 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }]),
          },
        }),
        delay: 5,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: currentFirst }),
      cachePolicy: "network-only",
    });

    await tick();
    flushSync();

    // Switch to first=3 (fast success)
    currentFirst = 3;
    flushSync();

    await delay(15);
    await tick();
    flushSync();

    expect(q.data?.posts?.edges?.[0]?.node?.title).toBe("Post 1");
    expect(q.errorUpdates.length).toBe(0);

    // A's stale error arrives — should be ignored
    await delay(25);
    await tick();
    flushSync();

    expect(q.errorUpdates.length).toBe(0);
    expect(q.data?.posts?.edges?.[0]?.node?.title).toBe("Post 1");

    q.dispose();
    await fx.restore();
  });

  it("ignores cursor page errors and preserves successful base page data", async () => {
    let currentAfter = $state<string | null>(null);

    const routes = [
      {
        when: ({ variables }: any) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([{ title: "Post 1", id: "1" }]),
          },
        }),
        delay: 5,
      },
      {
        when: ({ variables }: any) => variables.first === 2 && variables.after === "c1",
        respond: () => ({ error: new Error("Cursor page failed") }),
        delay: 30,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: currentAfter }),
      cachePolicy: "network-only",
    });

    await tick();
    flushSync();

    // Request next page (will error), then revert
    currentAfter = "c1";
    flushSync();
    await tick();

    currentAfter = null;
    flushSync();
    await tick();

    // Base result settles
    await delay(14);
    await tick();
    flushSync();

    expect(q.data?.posts?.edges?.[0]?.node?.title).toBe("Post 1");
    expect(q.errorUpdates.length).toBe(0);

    // Page error arrives — ignored
    await delay(25);
    await tick();
    flushSync();

    expect(q.errorUpdates.length).toBe(0);
    expect(q.data?.posts?.edges?.[0]?.node?.title).toBe("Post 1");

    q.dispose();
    await fx.restore();
  });

  it("handles out-of-order transports, later success overwrites earlier error & earlier success", async () => {
    let currentFirst = $state(2);

    const routes = [
      {
        when: ({ variables }: any) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1", id: "1" },
              { title: "Post 2", id: "2" },
            ]),
          },
        }),
        delay: 50,
      },
      {
        when: ({ variables }: any) => variables.first === 3 && !variables.after,
        respond: () => ({ error: new Error("🥲") }),
        delay: 5,
      },
      {
        when: ({ variables }: any) => variables.first === 4 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1", id: "1" },
              { title: "Post 2", id: "2" },
              { title: "Post 3", id: "3" },
              { title: "Post 4", id: "4" },
            ]),
          },
        }),
        delay: 20,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: currentFirst }),
      cachePolicy: "network-only",
    });

    await tick();
    flushSync();

    // Fire B (error), then C (success)
    currentFirst = 3;
    flushSync();
    await tick();

    currentFirst = 4;
    flushSync();
    await tick();

    // B's error should not surface
    await delay(12);
    await tick();
    flushSync();

    expect(q.errorUpdates.length).toBe(0);

    // C arrives: final data visible
    await delay(25);
    await tick();
    flushSync();

    expect(q.errorUpdates.length).toBe(0);
    const titles = q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    expect(titles).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    // A arrives very late: must be ignored
    await delay(35);
    await tick();
    flushSync();

    expect(q.errorUpdates.length).toBe(0);
    const finalTitles = q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    expect(finalTitles).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    q.dispose();
    await fx.restore();
  });
});
