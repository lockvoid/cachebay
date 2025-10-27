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

describe('materializeDocument – Paginated', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 500, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];
/*
  bench('cachebay - materializeDocument (canonical)', () => {
    const { cachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.__internals.documents.materializeDocument({
        document: USERS_CACHEBAY_QUERY,
        variables: page.variables,
        canonical: true,
        fingerprint: false,
        force: false
      });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        cachebay.__internals.documents.materializeDocument({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });

        iterations.push({ cachebay });
      }
    }
  });

  bench('cachebay - materializeDocument (canonical + fingerprint)', () => {
    const { cachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.__internals.documents.materializeDocument({
        document: USERS_CACHEBAY_QUERY,
        variables: page.variables,
        canonical: true,
        fingerprint: true,
        force: true
      });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        cachebay.__internals.documents.materializeDocument({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });

        iterations.push({ cachebay });
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
*/
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
