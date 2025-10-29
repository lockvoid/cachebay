import { createCachebay } from "@/src/core/client";
import { fixtures, operations, tick, delay } from "@/test/helpers";

describe("Subscriptions", () => {
  it("receives subscription updates and writes them to cache", async () => {
    let emitUpdate: ((data: any) => void) | null = null;
    let completeSubscription: (() => void) | null = null;

    const cache = createCachebay({
      transport: {
        http: async () => ({ data: null, error: null }),
        ws: async (context) => {
          return {
            subscribe(observer) {
              emitUpdate = (data) => {
                if (observer.next) {
                  observer.next({ data, error: null });
                }
              };

              completeSubscription = () => {
                if (observer.complete) {
                  observer.complete();
                }
              };

              return {
                unsubscribe: () => {
                  emitUpdate = null;
                  completeSubscription = null;
                },
              };
            },
          };
        },
      },
    });

    await cache.writeQuery({
      query: operations.USER_QUERY,
      variables: { id: "u1" },
      data: {
        __typename: "Query",
        user: fixtures.users.buildNode({ id: "u1", email: "u1@example.com" }),
      },
    });

    const initialUser = cache.readFragment({
      id: "User:u1",
      fragment: operations.USER_FRAGMENT,
    });

    expect(initialUser?.email).toBe("u1@example.com");

    const observable = await cache.executeSubscription({
      query: operations.USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
    });

    const updates: any[] = [];
    const errors: any[] = [];
    let completed = false;

    observable.subscribe({
      next: (result) => {
        updates.push(result.data);
      },
      error: (err) => {
        errors.push(err);
      },
      complete: () => {
        completed = true;
      },
    });

    await tick();
    expect(emitUpdate).not.toBeNull();

    emitUpdate!({
      __typename: "Subscription",
      userUpdated: {
        user: fixtures.users.buildNode({ id: "u1", email: "u1+updated@example.com" }),
      },
    });

    await tick();

    expect(updates.length).toBe(1);
    expect(updates[0].userUpdated.user.email).toBe("u1+updated@example.com");

    const updatedUser = cache.readFragment({
      id: "User:u1",
      fragment: operations.USER_FRAGMENT,
    });

    expect(updatedUser?.email).toBe("u1+updated@example.com");

    emitUpdate!({
      __typename: "Subscription",
      userUpdated: {
        user: fixtures.users.buildNode({ id: "u1", email: "u1+final@example.com" }),
      },
    });

    await tick();

    expect(updates.length).toBe(2);
    expect(updates[1].userUpdated.user.email).toBe("u1+final@example.com");

    const finalUser = cache.readFragment({
      id: "User:u1",
      fragment: operations.USER_FRAGMENT,
    });

    expect(finalUser?.email).toBe("u1+final@example.com");

    completeSubscription!();
    await tick();

    expect(completed).toBe(true);
    expect(errors.length).toBe(0);
  });

  it("handles subscription errors gracefully", async () => {
    const cache = createCachebay({
      transport: {
        http: async () => ({ data: null, error: null }),
        ws: async () => {
          return {
            subscribe(observer) {
              setTimeout(() => {
                if (observer.error) {
                  observer.error(new Error("Subscription failed"));
                }
              }, 10);

              return {
                unsubscribe: () => { },
              };
            },
          };
        },
      },
    });

    const observable = await cache.executeSubscription({
      query: operations.USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
    });

    const errors: any[] = [];

    observable.subscribe({
      next: () => { },
      error: (err) => {
        errors.push(err);
      },
    });

    await delay(20);

    expect(errors.length).toBe(1);
    expect(errors[0].message).toBe("Subscription failed");
  });

  it("allows unsubscribing from active subscription", async () => {
    let unsubscribeCalled = false;

    const cache = createCachebay({
      transport: {
        http: async () => ({ data: null, error: null }),
        ws: async () => {
          return {
            subscribe(observer) {
              return {
                unsubscribe: () => {
                  unsubscribeCalled = true;
                },
              };
            },
          };
        },
      },
    });

    const observable = await cache.executeSubscription({
      query: operations.USER_UPDATED_SUBSCRIPTION,
      variables: { id: "u1" },
    });

    const subscription = observable.subscribe({
      next: () => { },
    });

    await tick();
    expect(unsubscribeCalled).toBe(false);

    subscription.unsubscribe();
    await tick();

    expect(unsubscribeCalled).toBe(true);
  });

  it("throws error when WebSocket transport is not configured", async () => {
    const cache = createCachebay({
      transport: {
        http: async () => ({ data: null, error: null }),
      },
    });

    await expect(
      cache.executeSubscription({
        query: operations.USER_UPDATED_SUBSCRIPTION,
        variables: { id: "u1" },
      }),
    ).rejects.toThrow("WebSocket transport is not configured");
  });
});
