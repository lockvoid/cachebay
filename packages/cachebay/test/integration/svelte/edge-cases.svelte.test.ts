import { flushSync } from "svelte";
import {
  createTestClient,
  createTestQuery,
  createTestFragment,
  seedCache,
  fixtures,
  operations,
  delay,
  tick,
} from "./helpers.svelte";

describe("Edge cases (Svelte)", () => {
  it("reflects in-place entity updates across all edges (no union dedup)", async () => {
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
        delay: 5,
      },
      {
        when: ({ variables }: any) => variables.first === 2 && variables.after === "c2",
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 3", id: "3" },
              { title: "Post 4", id: "4" },
            ]),
          },
        }),
        delay: 10,
      },
      {
        when: ({ variables }: any) => variables.after === "c4" && variables.first === 1,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { title: "Post 1 Updated", id: "1", content: "Updated content", authorId: "1" },
            ]),
          },
        }),
        delay: 10,
      },
    ];

    let currentFirst = $state(2);
    let currentAfter = $state<string | null>(null);

    const { cache, fx } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: currentFirst, after: currentAfter }),
      cachePolicy: "cache-and-network",
    });

    await tick();
    flushSync();

    // Leader lands
    await delay(9);
    await tick();
    flushSync();

    expect(q.data?.posts?.edges?.map((e: any) => e.node.title)).toEqual(["Post 1", "Post 2"]);

    // Append
    currentAfter = "c2";
    flushSync();
    await delay(12);
    await tick();
    flushSync();

    expect(q.data?.posts?.edges?.map((e: any) => e.node.title)).toEqual(["Post 1", "Post 2", "Post 3", "Post 4"]);

    // After c4 — same node (id "1") with updated fields
    currentFirst = 1;
    currentAfter = "c4";
    flushSync();
    await delay(12);
    await tick();
    flushSync();

    const titles = q.data?.posts?.edges?.map((e: any) => e.node.title) ?? [];
    expect(titles).toEqual(["Post 1 Updated", "Post 2", "Post 3", "Post 4", "Post 1 Updated"]);
    expect(titles.filter((t: string) => t === "Post 1 Updated").length).toBe(2);

    q.dispose();
    await fx.restore();
  });

  it("renders concrete fragment implementations without phantom keys", async () => {
    const { cache } = createTestClient();

    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: "1", title: "Post 1" }),
    });

    cache.writeFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
      data: fixtures.user({ id: "2", email: "u2@example.com" }),
    });

    const postFragment = cache.readFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
    });

    const userFragment = cache.readFragment({
      id: "User:2",
      fragment: operations.USER_FRAGMENT,
    });

    expect(postFragment?.title).toBe("Post 1");
    expect(userFragment?.email).toBe("u2@example.com");
  });

  it("hides deleted entities from live fragment readers", async () => {
    const { cache } = createTestClient();

    cache.writeFragment({
      id: "Post:1",
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: "1", title: "Post 1" }),
    });

    cache.writeFragment({
      id: "Post:2",
      fragment: operations.POST_FRAGMENT,
      data: fixtures.post({ id: "2", title: "Post 2" }),
    });

    let post1 = cache.readFragment({ id: "Post:1", fragment: operations.POST_FRAGMENT });
    let post2 = cache.readFragment({ id: "Post:2", fragment: operations.POST_FRAGMENT });

    expect(post1?.title).toBe("Post 1");
    expect(post2?.title).toBe("Post 2");

    const tx = cache.modifyOptimistic((o: any) => {
      o.delete("Post:1");
    });

    tx.commit?.();

    post1 = cache.readFragment({ id: "Post:1", fragment: operations.POST_FRAGMENT });
    post2 = cache.readFragment({ id: "Post:2", fragment: operations.POST_FRAGMENT });

    expect(post1).toBe(null);
    expect(post2?.title).toBe("Post 2");
  });

  it("sends two requests even if the root is the same", async () => {
    const routes = [
      {
        when: ({ variables }: any) =>
          variables.userId === "1" && variables.postsCategory === "A" && !variables.postsAfter && variables.postsFirst === 2,
        respond: () => {
          const connection = fixtures.posts.buildConnection([
            { id: "pa1", title: "A1", author: { id: "1", email: "u1@example.com", __typename: "User" } },
            { id: "pa2", title: "A2", author: { id: "1", email: "u1@example.com", __typename: "User" } },
          ]);
          connection.edges = connection.edges.map((edge: any) => ({ ...edge, score: 100 }));
          return {
            data: {
              __typename: "Query",
              user: fixtures.users.buildNode({ id: "1", email: "u1@example.com", posts: connection }),
            },
          };
        },
      },
      {
        when: ({ variables }: any) => variables.id === "1",
        respond: () => ({
          data: {
            __typename: "Query",
            user: fixtures.users.buildNode({ id: "1", email: "u1@example.com" }),
          },
        }),
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const q1 = createTestQuery(cache, operations.USER_QUERY, {
      variables: () => ({ id: "1" }),
      cachePolicy: "cache-and-network",
    });

    const q2 = createTestQuery(cache, operations.USER_POSTS_QUERY, {
      variables: () => ({ userId: "1", postsCategory: "A", postsFirst: 2, postsAfter: null }),
      cachePolicy: "cache-and-network",
    });

    await tick();
    flushSync();
    await delay(10);
    await tick();
    flushSync();

    expect(fx.calls.length).toBe(2);

    q1.dispose();
    q2.dispose();
  });

  it("invalidates query cache when last watcher unmounts and remount gets fresh data", async () => {
    const { cache } = createTestClient();

    cache.writeQuery({
      query: operations.POSTS_QUERY,
      variables: { first: 3 },
      data: {
        __typename: "Query",
        posts: fixtures.posts.buildConnection([
          { id: "p1", title: "Post 1" },
          { id: "p2", title: "Post 2" },
          { id: "p3", title: "Post 3" },
        ]),
      },
    });

    // 1. Create watcher
    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3 }),
      cachePolicy: "cache-only",
    });

    await tick();
    flushSync();

    expect(q.data?.posts?.edges?.map((e: any) => e.node.title)).toEqual(["Post 1", "Post 2", "Post 3"]);

    // 2. Remove a node while mounted
    const tx1 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.removeNode({ __typename: "Post", id: "p2" });
    });
    tx1.commit?.();

    await tick();
    flushSync();

    expect(q.data?.posts?.edges?.map((e: any) => e.node.title)).toEqual(["Post 1", "Post 3"]);

    // 3. Dispose (unmount)
    q.dispose();

    // 4. Update data while unmounted
    const tx2 = cache.modifyOptimistic((o: any) => {
      const c = o.connection({ parent: "Query", key: "posts" });
      c.addNode({ __typename: "Post", id: "p4", title: "Post 4" }, { position: "end" });
    });
    tx2.commit?.();

    await tick();

    // 5. Remount — should get fresh data
    const q2 = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 3 }),
      cachePolicy: "cache-only",
    });

    await tick();
    flushSync();

    expect(q2.data?.posts?.edges?.map((e: any) => e.node.title)).toEqual(["Post 1", "Post 3", "Post 4"]);

    q2.dispose();
  });

  it("invalidates fragment cache when last watcher unmounts and remount gets fresh data", async () => {
    const { cache } = createTestClient();

    cache.writeFragment({
      id: "User:u1",
      fragment: operations.USER_FRAGMENT,
      data: fixtures.users.buildNode({ id: "u1", email: "initial@example.com" }),
    });

    // 1. Create fragment watcher
    const f = createTestFragment(cache, operations.USER_FRAGMENT, {
      id: "User:u1",
    });

    await tick();
    flushSync();

    expect(f.data?.email).toBe("initial@example.com");

    // 2. Update while mounted
    const tx1 = cache.modifyOptimistic((o: any) => {
      o.patch("User:u1", {
        __typename: "User",
        id: "u1",
        email: "updated@example.com",
      });
    });
    tx1.commit?.();

    await tick();
    flushSync();

    expect(f.data?.email).toBe("updated@example.com");

    // 3. Dispose (unmount)
    f.dispose();

    // 4. Update while unmounted
    const tx2 = cache.modifyOptimistic((o: any) => {
      o.patch("User:u1", {
        __typename: "User",
        id: "u1",
        email: "fresh@example.com",
      });
    });
    tx2.commit?.();

    await tick();

    // 5. Remount — should get fresh data
    const f2 = createTestFragment(cache, operations.USER_FRAGMENT, {
      id: "User:u1",
    });

    await tick();
    flushSync();

    expect(f2.data?.email).toBe("fresh@example.com");

    f2.dispose();
  });
});
