import { bench, describe } from 'vitest';
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import { buildUsersResponse, buildPages, USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/api";
import USERS_RELAY_QUERY from "../../src/__generated__/apiUsersRelayQuery.graphql";

const ITERATIONS = 10;

const createCachebay = () => {
  return createCachebayClient({
    transport: {
      http: async () => ({ data: {}, error: null }),
    },
  });
}

const createApollo = () => {
  return new InMemoryCache({
    resultCaching: false,

    typePolicies: {
      Query: {
        fields: {
          users: relayStylePagination(),
        },
      },

      User: {
        fields: {
          posts: relayStylePagination(),
        },
      },

      Post: {
        fields: {
          comments: relayStylePagination(),
        },
      },
    },
  });
}

const createRelay = () => {
  return new Environment({ network: Network.create(async () => ({})), store: new Store(new RecordSource()) });
};

describe('readQuery', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 500, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - readQuery (canonical)', () => {
    const { cachebay, sourceCachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      Object.assign(cachebay.__internals.graph, sourceCachebay.__internals.graph);

      const result = cachebay.readQuery({
        query: USERS_CACHEBAY_QUERY,
        variables: page.variables,
      });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      const sourceCachebay = createCachebay();

      for (let j = 0; j < pages.length; j++) {
        sourceCachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
      }

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        cachebay.__internals.documents.materializeDocument({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });

        iterations.push({ cachebay, sourceCachebay });
      }
    }
  });

  bench('apollo - readQuery', () => {
    const { apollo } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      apollo.readQuery({ query: USERS_APOLLO_QUERY, variables: page.variables });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        for (let j = 0; j < pages.length; j++) {
          apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        iterations.push({ apollo });
      }
    }
  });

  bench('relay - lookup', () => {
    const { relay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      const result = relay.lookup(createOperationDescriptor(USERS_RELAY_QUERY, page.variables).fragment);
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const relay = createRelay();

        for (let j = 0; j < pages.length; j++) {
          relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, pages[j].variables), pages[j].data);
        }

        iterations.push({ relay });
      }
    }
  });
});
