import { flushSync } from "svelte";
import { describe, it, expect } from "vitest";
import { createTestClient, createTestQuery, tick } from "./helpers.svelte";

describe("Root arrays (Svelte)", () => {
  const query = "query Users { users { id email } }";

  it("delivers network lists, reuses them from cache, and reacts to entity and list updates", async () => {
    let response = {
      users: [
        { __typename: "User", id: "u1", email: "u1@example.com" },
        { __typename: "User", id: "u2", email: "u2@example.com" },
      ],
    };

    const { cache, fx } = createTestClient({
      routes: [{ when: () => true, respond: () => ({ data: response }) }],
    });

    const networkQuery = createTestQuery(cache, query, { cachePolicy: "network-only" });
    let cachedQuery: ReturnType<typeof createTestQuery> | undefined;

    try {
      await tick();
      flushSync();

      expect(networkQuery.isFetching).toBe(false);
      expect(networkQuery.error).toBeNull();
      expect(networkQuery.data).toEqual(response);
      expect(cache.readQuery({ query })).toEqual(response);

      cachedQuery = createTestQuery(cache, query, { cachePolicy: "cache-only" });

      await tick();
      flushSync();

      expect(cachedQuery.isFetching).toBe(false);
      expect(cachedQuery.error).toBeNull();
      expect(cachedQuery.data).toEqual(response);
      expect(fx.calls).toHaveLength(1);

      cache.writeFragment({
        id: "User:u1",
        fragment: "fragment UserEmail on User { id email }",
        data: { __typename: "User", id: "u1", email: "updated@example.com" },
      });

      await tick();
      flushSync();

      expect(networkQuery.data.users[0].email).toBe("updated@example.com");
      expect(cachedQuery.data.users[0].email).toBe("updated@example.com");
      expect(fx.calls).toHaveLength(1);

      response = { users: [response.users[1]] };
      await networkQuery.refetch();
      await tick();
      flushSync();

      expect(networkQuery.data).toEqual(response);
      expect(cachedQuery.data).toEqual(response);

      response = { users: [] };
      await networkQuery.refetch();
      await tick();
      flushSync();

      expect(networkQuery.isFetching).toBe(false);
      expect(networkQuery.error).toBeNull();
      expect(networkQuery.data).toEqual({ users: [] });
      expect(cachedQuery.data).toEqual({ users: [] });
      expect(fx.calls).toHaveLength(3);
    } finally {
      networkQuery.dispose();
      cachedQuery?.dispose();
      await fx.restore();
      cache.dispose();
    }
  });

  it("returns a mutation root list and updates entities observed by a query", async () => {
    const initialData = { users: [{ __typename: "User", id: "u1", email: "u1@example.com" }] };
    const updatedUser = { __typename: "User", id: "u1", email: "updated@example.com" };
    const { cache, fx } = createTestClient({
      routes: [{ when: () => true, respond: () => ({ data: { updateUsers: [updatedUser] } }) }],
    });

    cache.writeQuery({ query, data: initialData });
    const observedQuery = createTestQuery(cache, query, { cachePolicy: "cache-only" });

    try {
      await tick();
      flushSync();

      expect(observedQuery.data).toEqual(initialData);

      const result = await cache.executeMutation({
        query: "mutation UpdateUsers { updateUsers { id email } }",
      });

      await tick();
      flushSync();

      expect(result.error).toBeNull();
      expect(result.data).toEqual({ updateUsers: [updatedUser] });
      expect(observedQuery.error).toBeNull();
      expect(observedQuery.data).toEqual({ users: [updatedUser] });
    } finally {
      observedQuery.dispose();
      await fx.restore();
      cache.dispose();
    }
  });
});
