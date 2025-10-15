import { bench, describe } from 'vitest';
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import { buildUsersResponse, buildPages } from "../../src/utils/fixtures";
import { USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/queries";
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

describe('materialize (single page)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 500, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - materialize (canonical)', () => {
    const { cachebay } = iterations.pop();

    const result = cachebay.__internals.documents.materialize({
      document: USERS_CACHEBAY_QUERY,
      variables: { first: 10, after: null },
      canonical: true,
      fingerprint: false,
    });
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });

          cachebay.__internals.documents.materialize({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });
        }

        iterations.push({ cachebay });
      }
    }
  });

  bench('cachebay - materialize (canonical + fingerprint)', () => {
    const { cachebay } = iterations.pop();

    const result = cachebay.__internals.documents.materialize({
      document: USERS_CACHEBAY_QUERY,
      variables: { first: 10, after: null },
      canonical: true,
      fingerprint: true,
    });
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });

          cachebay.__internals.documents.materialize({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });
        }

        iterations.push({ cachebay });
      }
    }
  });

  bench('relay - lookup', () => {
    const { relay } = iterations.pop();

    const result = relay.lookup(createOperationDescriptor(USERS_RELAY_QUERY, { first: 10, after: null }).fragment);
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const relay = createRelay();

        for (let j = 0; j < pages.length; j++) {
          relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, pages[j].variables), pages[j].data);
        }

        iterations.push({ relay });
      }
    }
  });
});

describe('materialize (all pages)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 500, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - materialize (canonical)', () => {
    const { cachebay, sourceCachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      Object.assign(cachebay.__internals.graph, sourceCachebay.__internals.graph);

      const result = cachebay.__internals.documents.materialize({
        document: USERS_CACHEBAY_QUERY,
        variables: page.variables,
        canonical: true,
        fingerprint: false,
      });
    }
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      const sourceCachebay = createCachebay();

      for (let j = 0; j < pages.length; j++) {
        sourceCachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
      }

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const cachebay = createCachebay();

        cachebay.__internals.documents.materialize({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });

        iterations.push({ cachebay, sourceCachebay });
      }
    }
  });

  bench('cachebay - materialize (canonical + fingerprint)', () => {
    const { cachebay, sourceCachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      Object.assign(cachebay.__internals.graph, sourceCachebay.__internals.graph);

      const result = cachebay.__internals.documents.materialize({
        document: USERS_CACHEBAY_QUERY,
        variables: page.variables,
        canonical: true,
        fingerprint: true,
      });
    }
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      const sourceCachebay = createCachebay();

      for (let j = 0; j < pages.length; j++) {
        sourceCachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
      }

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const cachebay = createCachebay();

        cachebay.__internals.documents.materialize({ document: `query JIT { LFG }`, variables: {}, canonical: true, force: true });

        iterations.push({ cachebay, sourceCachebay });
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
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const relay = createRelay();

        for (let j = 0; j < pages.length; j++) {
          relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, pages[j].variables), pages[j].data);
        }

        iterations.push({ relay });
      }
    }
  });
});
