import { flushSync } from "svelte";
import { createTestClient, createTestQuery, seedCache, fixtures, operations, delay, tick } from "./helpers.svelte";

describe("Svelte adapter smoke test", () => {
  it("createQuery fetches data from network", async () => {
    const routes = [
      {
        when: ({ variables }: any) => variables.first === 2 && !variables.after,
        respond: () => ({
          data: {
            __typename: "Query",
            posts: fixtures.posts.buildConnection([
              { id: "p1", title: "Post 1" },
            ]),
          },
        }),
        delay: 10,
      },
    ];

    const { cache, fx } = createTestClient({ routes });

    const q = createTestQuery(cache, operations.POSTS_QUERY, {
      variables: () => ({ first: 2, after: null }),
      cachePolicy: "network-only",
    });

    // Effect fires the query — wait for it
    await tick();
    flushSync();

    expect(q.isFetching).toBe(true);
    expect(q.data).toBeUndefined();

    await delay(20);
    await tick();
    flushSync();

    expect(q.data).toBeTruthy();
    expect(q.data.posts.edges[0].node.title).toBe("Post 1");
    expect(fx.calls.length).toBe(1);

    q.dispose();
    await fx.restore();
  });
});
