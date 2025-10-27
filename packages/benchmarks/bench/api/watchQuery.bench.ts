import { bench, group, run, summary } from "mitata";
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import { buildUsersResponse, buildPages, USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/api";
import USERS_RELAY_QUERY from "../../src/__generated__/apiUsersRelayQuery.graphql";
import { parse } from "graphql";

const CACHEBAY_USER_QUERY = parse(/* GraphQL */ `
  query UserName($id: ID!) {
    user(id: $id) { __typename id name }
  }
`);

const APOLLO_USER_QUERY = CACHEBAY_USER_QUERY;

let __sink = 0;

const sink = (o: any) => {
  __sink ^= (o?.users?.edges?.length ?? 0) | 0;
};

const createCachebay = () => {
  return createCachebayClient({
    transport: {
      http: async () => ({ data: {} }),
    },
  });
}

const createApolloCache = (resultCaching = false) => {
  return new InMemoryCache({
    resultCaching,

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

      Comment: {
        keyFields: ["id"],
      },
    },
  });
}

const createRelayEnvironment = () => {
  return new Environment({ network: Network.create(() => Promise.resolve({ data: {} })), store: new Store(new RecordSource()) });
}


summary(() => {
  const TOTAL_USERS = 1000;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages({ data: buildUsersResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), pageSize: USERS_PAGE_SIZE });

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("watchQuery:initial:cold", () => {
    bench(`cachebay.watchQuery:initial:cold(${getLabel()})`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();
          cachebay.__internals.planner.getPlan(USERS_CACHEBAY_QUERY);
          return cachebay;
        },
        async bench(cachebay) {
          const sub = cachebay.watchQuery({
            query: USERS_CACHEBAY_QUERY,
            variables: { first: USERS_PAGE_SIZE, after: null },
            canonical: true,
            onData: (d) => sink(d),
          });

          for (let i = 0; i < pages.length; i++) {
            cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });
            await Promise.resolve();
          }

          sub.unsubscribe();
        },
      };
    });

    bench(`relay.subscribe:initial:cold(${getLabel()})`, function* () {
      yield {
        [0]() {
          return createRelayEnvironment();
        },
        async bench(relay) {
          const operation = createOperationDescriptor(USERS_RELAY_QUERY as ConcreteRequest, { first: USERS_PAGE_SIZE, after: null });
          const snapshot = relay.lookup(operation.fragment);
          const disposable = relay.subscribe(snapshot, (newSnapshot) => {
            sink(newSnapshot.data);
          });

          for (let i = 0; i < pages.length; i++) {
            relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY as ConcreteRequest, pages[i].variables), pages[i].data);
            await Promise.resolve();
          }

          disposable.dispose();
        },
      };
    });
  });
});

summary(() => {
  const TOTAL_USERS = 1000;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages({ data: buildUsersResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), pageSize: USERS_PAGE_SIZE });

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("watchQuery:initial:hot", () => {
    const cachebay = createCachebay();

    for (let i = 0; i < pages.length; i++) {
      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });
    }

    cachebay.readQuery({ query: USERS_CACHEBAY_QUERY, variables: { first: USERS_PAGE_SIZE, after: null }, canonical: true });

    bench(`cachebay.watchQuery:initial:hot(${getLabel()})`, () => {
      const sub = cachebay.watchQuery({
        query: USERS_CACHEBAY_QUERY,
        variables: { first: USERS_PAGE_SIZE, after: null },
        canonical: true,
        onData: (d) => sink(d),
      });
      sub.unsubscribe();
    });

    const relay = createRelayEnvironment();

    for (let i = 0; i < pages.length; i++) {
      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY as ConcreteRequest, pages[i].variables), pages[i].data);
    }

    const operation = createOperationDescriptor(USERS_RELAY_QUERY as ConcreteRequest, { first: USERS_PAGE_SIZE, after: null });
    relay.lookup(operation.fragment);

    bench(`relay.subscribe:initial:hot(${getLabel()})`, () => {
      const snapshot = relay.lookup(operation.fragment);
      const disposable = relay.subscribe(snapshot, (newSnapshot) => {
        sink(newSnapshot.data);
      });
      disposable.dispose();
    });
  });
});

summary(() => {
  const TOTAL_USERS = 1000;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages({ data: buildUsersResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), pageSize: USERS_PAGE_SIZE });

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("watchQuery:reactive", () => {
    const cachebay = createCachebay();

    for (let i = 0; i < pages.length; i++) {
      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });
    }

    cachebay.watchQuery({
      query: USERS_CACHEBAY_QUERY,
      variables: { first: USERS_PAGE_SIZE, after: null },
      canonical: true,
      immediate: false,
      onData: (d) => sink(d),
    });

    let toggle1 = false;

    bench(`cachebay.watchQuery:reactive(${getLabel()})`, async () => {
      toggle1 = !toggle1;
      const name = toggle1 ? "User 1 (updated)" : "User 1";

      cachebay.writeQuery({
        query: CACHEBAY_USER_QUERY,
        variables: { id: "u1" },
        data: { user: { __typename: "User", id: "u1", name } },
      });

      await Promise.resolve();
    });

    const apollo = createApolloCache();

    for (let i = 0; i < pages.length; i++) {
      apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[i].variables, data: pages[i].data });
    }

    apollo.watch({
      query: USERS_APOLLO_QUERY,
      variables: { first: USERS_PAGE_SIZE, after: null },
      optimistic: false,
      immediate: false,
      callback: (diff) => sink(diff.result),
    });

    let toggle2 = false;

    bench(`apollo.watch:reactive(${getLabel()})`, () => {
      toggle2 = !toggle2;
      const name = toggle2 ? "User 1 (updated)" : "User 1";

      apollo.writeQuery({
        query: APOLLO_USER_QUERY,
        variables: { id: "u1" },
        data: { user: { __typename: "User", id: "u1", name } },
      });
    });

    const relay = createRelayEnvironment();

    for (let i = 0; i < pages.length; i++) {
      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY as ConcreteRequest, pages[i].variables), pages[i].data);
    }

    const operation = createOperationDescriptor(USERS_RELAY_QUERY as ConcreteRequest, { first: USERS_PAGE_SIZE, after: null });
    const snapshot = relay.lookup(operation.fragment);
    relay.subscribe(snapshot, (newSnapshot) => {
      sink(newSnapshot.data);
    });

    let toggle3 = false;

    bench(`relay.subscribe:reactive(${getLabel()})`, () => {
      toggle3 = !toggle3;
      const name = toggle3 ? "User 1 (updated)" : "User 1";

      relay.commitUpdate((store) => {
        const user = store.get("u1");
        if (user) {
          user.setValue(name, "name");
        }
      });
    });
  });
});

summary(() => {
  const TOTAL_USERS = 1000;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages({ data: buildUsersResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), pageSize: USERS_PAGE_SIZE });

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("watchQuery:pagination", () => {
    const cachebay = createCachebay();

    for (let i = 0; i < 3; i++) {
      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });
    }

    let emissionCount = 0;
    cachebay.watchQuery({
      query: USERS_CACHEBAY_QUERY,
      variables: { first: USERS_PAGE_SIZE, after: null },
      canonical: true,
      immediate: false,
      onData: (d) => {
        emissionCount++;
        sink(d);
      },
    });

    let pageIndex = 3;

    bench(`cachebay.watchQuery:pagination(${getLabel()})`, async () => {
      pageIndex = (pageIndex + 1) % pages.length;
      if (pageIndex === 0) pageIndex = 3;

      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[pageIndex].variables, data: pages[pageIndex].data });

      await Promise.resolve();
    });

    const apollo = createApolloCache();

    for (let i = 0; i < 3; i++) {
      apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[i].variables, data: pages[i].data });
    }

    apollo.watch({
      query: USERS_APOLLO_QUERY,
      variables: { first: USERS_PAGE_SIZE, after: null },
      optimistic: false,
      immediate: false,
      callback: (diff) => sink(diff.result),
    });

    let pageIndex2 = 3;

    bench(`apollo.watch:pagination(${getLabel()})`, () => {
      pageIndex2 = (pageIndex2 + 1) % pages.length;
      if (pageIndex2 === 0) pageIndex2 = 3;

      apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[pageIndex2].variables, data: pages[pageIndex2].data });
    });
  });
});

(globalThis as any).__bench_sink = __sink;

await run();
