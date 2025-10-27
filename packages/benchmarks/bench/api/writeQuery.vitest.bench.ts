import { bench, describe } from 'vitest';
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import { buildUsersResponse, buildPages, USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/api";
import USERS_RELAY_QUERY from "../../src/__generated__/apiUsersRelayQuery.graphql";

const ITERATIONS = 100;

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

describe('writeQuery – Paginated (COLD)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });

  const cachebayIterations: { cachebay: any }[] = [];

  bench('cachebay - writeQuery', () => {
    const { cachebay } = cachebayIterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: page.variables, data: page.data });
    }

  }, {
    iterations: ITERATIONS,

    setup() {
      cachebayIterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        cachebay.__internals.planner.getPlan(USERS_CACHEBAY_QUERY);

        cachebayIterations.push({ cachebay });
      }
    }
  });

  const apolloIterations: { apollo: any }[] = [];

  bench('apollo - writeQuery', () => {
    const { apollo } = apolloIterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: page.variables, data: page.data });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      apolloIterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        apolloIterations.push({ apollo });
      }
    }
  });

  const relayIterations: { relay: any }[] = [];

  bench('relay - commitPayload', () => {
    const { relay } = relayIterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, page.variables), page.data);
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      relayIterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const relay = createRelay();

        relayIterations.push({ relay });
      }
    }
  });
});

describe('writeQuery – Paginated (HOT)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });

  const cachebayIterations: { cachebay: any }[] = [];

  bench('cachebay - writeQuery', () => {
    const { cachebay } = cachebayIterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: page.variables, data: page.data });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      cachebayIterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];

          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: page.variables, data: page.data });
        }

        cachebayIterations.push({ cachebay });
      }
    }
  });

  const apolloIterations: { apollo: any }[] = [];

  bench('apollo - writeQuery', () => {
    const { apollo } = apolloIterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: page.variables, data: page.data });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      apolloIterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];

          apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: page.variables, data: page.data });
        }

        apolloIterations.push({ apollo });
      }
    }
  });

  const relayIterations: { relay: any }[] = [];

  bench('relay - commitPayload', () => {
    const { relay } = relayIterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, page.variables), page.data);
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      relayIterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const relay = createRelay();

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];

          relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, page.variables), page.data);
        }

        relayIterations.push({ relay });
      }
    }
  });
});
