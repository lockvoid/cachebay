// api/watchQuery.bench.ts
import { bench, group, run, summary } from "mitata";

// ---- cachebay ----
import { createCachebay } from "../../villus-cachebay/src/core/client";

// ---- apollo ----
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";

// ---- relay ----
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import RelayWriteQuery from "../src/__generated__/relayWriteQueryDefRelayWriteQuery.graphql";

// ---- shared (same helpers you already use) ----
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "./utils";

// ---- gql helpers just for the tiny "user by id" update ----
import { parse } from "graphql";

// We update a single user entity so both caches re-emit the connection view.
const CACHEBAY_USER_QUERY = parse(/* GraphQL */ `
  query UserName($id: ID!) {
    user(id: $id) { __typename id name }
  }
`);
const APOLLO_USER_QUERY = CACHEBAY_USER_QUERY;

// sink to force result consumption
let __sink = 0;
const sinkObj = (o: any) => { __sink ^= (o?.users?.edges?.length ?? 0) | 0; };

// -----------------------------------------------------------------------------
// Rigs
// -----------------------------------------------------------------------------

function createCachebay() {
  return createCachebay({
    keys: {
      Query: () => "Query",
      User: (o: any) => o.id ?? null,
      Post: (o: any) => o.id ?? null,
      Comment: (o: any) => o.id ?? null,
    },
  });
}

function createApolloCache() {
  return new InMemoryCache({
    // parity with normalize benches (disables apollo's result memo)
    resultCaching: false,
    typePolicies: {
      Query: {
        fields: {
          users: relayStylePagination(),
        },
      },
      User: {
        keyFields: ["id"],
        fields: {
          posts: relayStylePagination(),
        },
      },
      Post: {
        keyFields: ["id"],
        fields: {
          comments: relayStylePagination(),
        },
      },
      Comment: { keyFields: ["id"] },
    },
  });
}

function createRelayEnvironment() {
  return new Environment({
    network: Network.create(() => Promise.resolve({ data: {} })),
    store: new Store(new RecordSource()),
  });
}

// -----------------------------------------------------------------------------
// Shared data
// -----------------------------------------------------------------------------
const USERS_TOTAL = 1000;
const PAGE_SIZE = 10;
const allUsers = Object.freeze(makeResponse({ users: USERS_TOTAL, posts: 5, comments: 3 }));
const pages = buildPages(allUsers, PAGE_SIZE);
const label = `${USERS_TOTAL} users (${pages.length} pages of ${PAGE_SIZE})`;

// small helper to seed caches with all pages
function seedCachebayAllPages(cache: ReturnType<typeof createCachebay>) {
  for (let i = 0; i < pages.length; i++) {
    cache.writeQuery({
      query: CACHEBAY_QUERY,
      variables: pages[i].vars,
      data: pages[i].data,
    });
  }
}
function seedApolloAllPages(cache: InMemoryCache) {
  for (let i = 0; i < pages.length; i++) {
    cache.writeQuery({
      query: APOLLO_QUERY,
      variables: pages[i].vars,
      data: pages[i].data,
    });
  }
}
function seedRelayAllPages(env: Environment) {
  for (let i = 0; i < pages.length; i++) {
    const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, pages[i].vars);
    env.commitPayload(operation, pages[i].data);
  }
}

// -----------------------------------------------------------------------------
/** Initial subscription (subscribe + initial emit) - COLD */
// -----------------------------------------------------------------------------
summary(() => {
  group("watchQuery – INITIAL subscription (COLD)", () => {

    // Cachebay: initial:cold (new instance, subscribe, write pages, unsubscribe)
    bench(`cachebay.watchQuery:initial:cold(${label})`, function* () {
      yield {
        [0]() {
          const cache = createCachebay();
          // Warm the planner
          cache.__internals.planner.getPlan(CACHEBAY_QUERY);
          return cache;
        },
        async bench(cache) {
          // 1. Subscribe first
          const sub = cache.watchQuery({
            query: CACHEBAY_QUERY,
            variables: { first: PAGE_SIZE, after: null },
            canonical: true,
            onData: (d) => sinkObj(d),
          });

          // 2. Write all pages (triggers reactive updates)
          for (let i = 0; i < pages.length; i++) {
            cache.writeQuery({
              query: CACHEBAY_QUERY,
              variables: pages[i].vars,
              data: pages[i].data,
            });
            // Flush microtask queue so watchers can react
            await Promise.resolve();
          }

          // 3. Unsubscribe
          sub.unsubscribe();
        },
      };
    });

    // // Apollo: initial:cold (new instance, subscribe, write pages, unsubscribe)
    // bench(`apollo.watch:initial:cold(${label})`, function* () {
    //   yield {
    //     [0]() {
    //       return createApolloCache();
    //     },
    //     async bench(apollo) {
    //       // 1. Subscribe first
    //       const unwatch = apollo.watch({
    //         query: APOLLO_QUERY,
    //         variables: { first: PAGE_SIZE, after: null },
    //         optimistic: false,
    //         immediate: true,
    //         callback: (diff) => sinkObj(diff.result),
    //       });
    //
    //       // 2. Write all pages (triggers reactive updates)
    //       for (let i = 0; i < pages.length; i++) {
    //         apollo.writeQuery({
    //           broadcast: true, // Enable broadcast to trigger watchers
    //           query: APOLLO_QUERY,
    //           variables: pages[i].vars,
    //           data: pages[i].data,
    //         });
    //         // Flush microtask queue (Apollo broadcasts synchronously, but keep consistent)
    //         await Promise.resolve();
    //       }
    //
    //       // 3. Unsubscribe
    //       unwatch();
    //     },
    //   };
    // });

    // Relay: initial:cold (new environment, subscribe, write pages, unsubscribe)
    bench(`relay.subscribe:initial:cold(${label})`, function* () {
      yield {
        [0]() {
          return createRelayEnvironment();
        },
        async bench(relay) {
          // 1. Subscribe first
          const operation = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
          const snap = relay.lookup(operation.fragment);
          const disposable = relay.subscribe(snap, (newSnapshot) => {
            sinkObj(newSnapshot.data);
          });

          // 2. Write all pages (triggers reactive updates)
          for (let i = 0; i < pages.length; i++) {
            const op = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, pages[i].vars);
            relay.commitPayload(op, pages[i].data);
            // Flush microtask queue (Relay broadcasts synchronously, but keep consistent)
            await Promise.resolve();
          }

          // 3. Unsubscribe
          disposable.dispose();
        },
      };
    });
  });
});

// -----------------------------------------------------------------------------
/** Initial subscription (subscribe + initial emit) - HOT */
// -----------------------------------------------------------------------------
summary(() => {
  group("watchQuery – INITIAL subscription (HOT)", () => {

    // Cachebay: initial:hot (reuse instance)
    const cache1 = createCachebay();
    seedCachebayAllPages(cache1);
    cache1.readQuery({
      query: CACHEBAY_QUERY,
      variables: { first: PAGE_SIZE, after: null },
      canonical: true,
    });

    bench(`cachebay.watchQuery:initial:hot(${label})`, () => {
      const sub = cache1.watchQuery({
        query: CACHEBAY_QUERY,
        variables: { first: PAGE_SIZE, after: null },
        canonical: true,
        onData: (d) => sinkObj(d),
      });
      sub.unsubscribe();
    });

    //// Apollo: initial:hot (reuse instance)
    //const apollo1 = createApolloCache();
    //seedApolloAllPages(apollo1);
    //apollo1.readQuery({ query: APOLLO_QUERY, variables: { first: PAGE_SIZE, after: null } });
    //
    //bench(`apollo.watch:initial:hot(${label})`, () => {
    //  const unwatch = apollo1.watch({
    //    query: APOLLO_QUERY,
    //    variables: { first: PAGE_SIZE, after: null },
    //    optimistic: false,
    //    immediate: true,
    //    callback: (diff) => sinkObj(diff.result),
    //  });
    //  unwatch();
    //});

    // Relay: initial:hot (reuse environment)
    const relay1 = createRelayEnvironment();
    seedRelayAllPages(relay1);
    const operation1 = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
    relay1.lookup(operation1.fragment);

    bench(`relay.subscribe:initial:hot(${label})`, () => {
      const snapshot = relay1.lookup(operation1.fragment);
      const disposable = relay1.subscribe(snapshot, (newSnapshot) => {
        sinkObj(newSnapshot.data);
      });
      disposable.dispose();
    });
  });
});

// -----------------------------------------------------------------------------
/** Reactive updates (write → broadcast → re-materialize → emit)
 *  We update User "u1" email back-and-forth so deps fire without growing data.
 */
// -----------------------------------------------------------------------------
summary(() => {
  group("watchQuery – REACTIVE updates", () => {

    // Cachebay reactive
    const cache2 = createCachebay();
    seedCachebayAllPages(cache2);
    cache2.watchQuery({
      query: CACHEBAY_QUERY,
      variables: { first: PAGE_SIZE, after: null },
      canonical: true,
      skipInitialEmit: true,
      onData: (d) => sinkObj(d),
    });
    let toggle1 = false;

    bench(`cachebay.watchQuery:reactive(${label})`, async () => {
      toggle1 = !toggle1;
      const name = toggle1 ? "User 1 (updated)" : "User 1";

      cache2.writeQuery({
        query: CACHEBAY_USER_QUERY,
        variables: { id: "u1" },
        data: { user: { __typename: "User", id: "u1", name } },
      });

      // watchQuery broadcasts via queueMicrotask; flush it
      await Promise.resolve();
    });

    // Apollo reactive
    const apollo2 = createApolloCache();
    seedApolloAllPages(apollo2);
    apollo2.watch({
      query: APOLLO_QUERY,
      variables: { first: PAGE_SIZE, after: null },
      optimistic: false,
      immediate: false,
      callback: (diff) => sinkObj(diff.result),
    });
    let toggle2 = false;

    bench(`apollo.watch:reactive(${label})`, () => {
      toggle2 = !toggle2;
      const name = toggle2 ? "User 1 (updated)" : "User 1";

      apollo2.writeQuery({
        query: APOLLO_USER_QUERY,
        variables: { id: "u1" },
        data: { user: { __typename: "User", id: "u1", name } },
      });
      // apollo watchers broadcast synchronously
    });

    // Relay reactive
    const relay2 = createRelayEnvironment();
    seedRelayAllPages(relay2);
    const operation2 = createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: PAGE_SIZE, after: null });
    const snapshot2 = relay2.lookup(operation2.fragment);
    relay2.subscribe(snapshot2, (newSnapshot) => {
      sinkObj(newSnapshot.data);
    });
    let toggle3 = false;

    bench(`relay.subscribe:reactive(${label})`, () => {
      toggle3 = !toggle3;
      const name = toggle3 ? "User 1 (updated)" : "User 1";

      // Use store updater to directly modify the user record
      relay2.commitUpdate((store) => {
        const user = store.get("u1");
        if (user) {
          user.setValue(name, "name");
        }
      });
      // relay subscribers broadcast synchronously
    });
  });
});

// keep the sink visible so V8 can't fully DCE it
(globalThis as any).__bench_sink = __sink;

run();
