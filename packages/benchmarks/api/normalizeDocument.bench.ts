import { bench, group, run, summary } from "mitata";
import { createCachebay as createCachebayClient } from "../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import RelayWriteQuery from "../src/__generated__/relayWriteQueryDefRelayWriteQuery.graphql";
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY } from "./utils";

let __sink = 0;

const sink = () => {
  __sink ^= 1;
};

const createCachebay = () => {
  return createCachebayClient({
    transport: {
      http: async () => ({ data: {} }),
    },
  });
}

const createApolloCache = () => {
  return new InMemoryCache({
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
      Comment: {
        keyFields: ["id"],
      },
    },
  });
}

const createRelayEnvironment = () => {
  return new Environment({ network: Network.create(() => Promise.resolve({ data: {} })), store: new Store(new RecordSource()), });
}

summary(() => {
  const TOTAL_USERS = 1000;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages(makeResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), USERS_PAGE_SIZE);

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("normalizeDocument – Paginated (COLD)", () => {
    bench(`cachebay.writeQuery:cold(${getLabel()})`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();

          cachebay.__internals.planner.getPlan(CACHEBAY_QUERY)

          return cachebay;
        },
        bench(cache) {
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i];

            cache.__internals.documents.normalizeDocument({ document: CACHEBAY_QUERY, variables: page.variables, data: page.data });
          }
          sink();
        },
      };
    });

    bench(`apollo.writeQuery:cold(${getLabel()})`, function* () {
      yield {
        [0]() {
          return createApolloCache();
        },
        bench(apollo) {
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i];

            apollo.writeQuery({ broadcast: false, query: APOLLO_QUERY, variables: page.variables, data: page.data });
          }
          sink();
        },
      };
    });

    bench(`relay.commitPayload:cold(${getLabel()})`, function* () {
      yield {
        [0]() {
          return createRelayEnvironment();
        },
        bench(relay) {
          for (let i = 0; i < pages.length; i++) {
            const page = pages[i];

            relay.commitPayload(createOperationDescriptor(RelayWriteQuery as ConcreteRequest, page.variables), page.data);
          }
          sink();
        },
      };
    });
  });
});

summary(() => {
  const TOTAL_USERS = 1000;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages(makeResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), USERS_PAGE_SIZE);

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("normalizeDocument – Paginated (HOT)", () => {
    const cachebay = createCachebay();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.__internals.documents.normalizeDocument({ document: CACHEBAY_QUERY, variables: page.variables, data: page.data });
    }

    bench(`cachebay.writeQuery:hot(${getLabel()})`, () => {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];

        cachebay.writeQuery({ query: CACHEBAY_QUERY, variables: page.variables, data: page.data });
      }
      sink();
    });

    const apollo = createApolloCache();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      apollo.writeQuery({ broadcast: false, query: APOLLO_QUERY, variables: page.variables, data: page.data });
    }

    bench(`apollo.writeQuery:hot(${getLabel()})`, () => {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];

        apollo.writeQuery({ broadcast: false, query: APOLLO_QUERY, variables: page.variables, data: page.data });
      }
      sink();
    });

    const relay = createRelayEnvironment();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      relay.commitPayload(createOperationDescriptor(RelayWriteQuery as ConcreteRequest, page.variables), page.data);
    }

    bench(`relay.commitPayload:hot(${getLabel()})`, () => {
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];

        relay.commitPayload(createOperationDescriptor(RelayWriteQuery as ConcreteRequest, page.variables), page.data);
      }
      sink();
    });
  });
});


summary(() => {
  const USERS_PAGE = 10;
  const LABEL = `${USERS_PAGE} users`;
  const singlePage = Object.freeze(makeResponse({ users: USERS_PAGE, posts: 5, comments: 3 }));

  group("writeQuery – Single page (COLD)", () => {
    bench(`cachebay.writeQuery:single-page:cold(${LABEL})`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();

          cachebay.__internals.planner.getPlan(CACHEBAY_QUERY);

          return cachebay;
        },
        bench(cache) {
          cache.__internals.documents.normalizeDocument({ document: CACHEBAY_QUERY, variables: { first: USERS_PAGE, after: null }, data: singlePage });

          sink();
        },
      };
    });

    bench(`apollo.writeQuery:single-page:cold(${LABEL})`, function* () {
      yield {
        [0]() {
          return createApolloCache();
        },
        bench(apollo) {
          apollo.writeQuery({ broadcast: false, query: APOLLO_QUERY, variables: { first: USERS_PAGE, after: null }, data: singlePage });
          sink();
        },
      };
    });

    bench(`relay.commitPayload:single-page:cold(${LABEL})`, function* () {
      yield {
        [0]() {
          return createRelayEnvironment();
        },
        bench(relay) {
          relay.commitPayload(createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: USERS_PAGE, after: null }), singlePage);
          sink();
        },
      };
    });
  });
});

summary(() => {
  const USERS_PAGE = 10;
  const LABEL = `${USERS_PAGE} users`;
  const singlePage = Object.freeze(makeResponse({ users: USERS_PAGE, posts: 5, comments: 3 }));

  group("writeQuery – Single page (HOT)", () => {
    const cachebay = createCachebay();

    cachebay.writeQuery({ query: CACHEBAY_QUERY, variables: { first: USERS_PAGE, after: null }, data: singlePage });

    bench(`cachebay.writeQuery:single-page:hot(${LABEL})`, () => {
      cachebay.writeQuery({ query: CACHEBAY_QUERY, variables: { first: USERS_PAGE, after: null }, data: singlePage });
      sink();
    });

    const apollo = createApolloCache();

    apollo.writeQuery({ broadcast: false, query: APOLLO_QUERY, variables: { first: USERS_PAGE, after: null }, data: singlePage });

    bench(`apollo.writeQuery:single-page:hot(${LABEL})`, () => {
      apollo.writeQuery({ broadcast: false, query: APOLLO_QUERY, variables: { first: USERS_PAGE, after: null }, data: singlePage });
      sink();
    });

    // Relay: write single page (hot)
    const relay = createRelayEnvironment();

    relay.commitPayload(createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: USERS_PAGE, after: null }), singlePage);

    bench(`relay.commitPayload:single-page:hot(${LABEL})`, () => {
      relay.commitPayload(createOperationDescriptor(RelayWriteQuery as ConcreteRequest, { first: USERS_PAGE, after: null }), singlePage);
      sink();
    });
  });
});

(globalThis as any).__bench_sink = __sink;

await run();
