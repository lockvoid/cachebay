import { bench, group, run, summary } from "mitata";
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import type { ConcreteRequest } from "relay-runtime";
import { makeResponse, buildPages, CACHEBAY_QUERY, APOLLO_QUERY, RELAY_QUERY } from "../../src/utils/api";

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
  const TOTAL_USERS = 500;
  const USERS_PAGE_SIZE = 10;
  const pages = buildPages(makeResponse({ users: TOTAL_USERS, posts: 5, comments: 3 }), USERS_PAGE_SIZE);

  const getLabel = () => {
    return `${TOTAL_USERS} users (${pages.length} pages of ${USERS_PAGE_SIZE})`;
  };

  group("materializeDocument", () => {
    bench(`cachebay.materializeDocument:canonical(${getLabel()})`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();

          for (let i = 0; i < pages.length; i++) {
            cachebay.writeQuery({ query: CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });

            cachebay.__internals.documents.materializeDocument({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });
          }

          return cachebay;
        },
        bench(cachebay) {
          const result = cachebay.__internals.documents.materializeDocument({ document: CACHEBAY_QUERY, variables: { first: USERS_PAGE_SIZE, after: null }, canonical: true, fingerprint: false, force: false });
          //sink(result.data);
        },
      };
    });

    bench(`cachebay.materializeDocument:canonical:fingerprint(${getLabel()})`, function* () {
      yield {
        [0]() {
          const cachebay = createCachebay();

          for (let i = 0; i < pages.length; i++) {
            cachebay.writeQuery({ query: CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });

            cachebay.__internals.documents.materializeDocument({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });
          }

          return cachebay;
        },
        bench(cachebay) {
          const result = cachebay.__internals.documents.materializeDocument({ document: CACHEBAY_QUERY, variables: { first: USERS_PAGE_SIZE, after: null }, canonical: true, fingerprint: true, force: false });
          //sink(result.data);
        },
      };
    });

    bench(`apollo.readQuery(${getLabel()})`, function* () {
      yield {
        [0]() {
          const apollo = createApolloCache(false);

          for (let i = 0; i < pages.length; i++) {
            apollo.writeQuery({ query: APOLLO_QUERY, variables: pages[i].variables, data: pages[i].data });
          }

          return apollo;
        },
        bench(apollo) {
          const result = apollo.readQuery({ query: APOLLO_QUERY, variables: { first: USERS_PAGE_SIZE, after: null } });
          sink(result);
        },
      };
    });

    bench(`relay.lookup(${getLabel()})`, function* () {
      yield {
        [0]() {
          const relay = createRelayEnvironment();

          for (let i = 0; i < pages.length; i++) {
            relay.commitPayload(createOperationDescriptor(RELAY_QUERY as ConcreteRequest, pages[i].variables), pages[i].data);
          }

          return relay;
        },
        bench(relay) {
          const result = relay.lookup(createOperationDescriptor(RELAY_QUERY as ConcreteRequest, { first: USERS_PAGE_SIZE, after: null }).fragment);
          sink(result.data);
        },
      };
    });
  });
});

(globalThis as any).__bench_sink = __sink;

await run();
