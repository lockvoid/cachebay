import { bench, describe } from 'vitest';
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import { buildUsersResponse, buildPages } from "../../src/utils/fixtures";
import { USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/queries";
import USERS_RELAY_QUERY from "../../src/__generated__/apiUsersRelayQuery.graphql";

const ITERATIONS = 50;

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
  const iterations = [];

  bench('cachebay - writeQuery', () => {
    const { cachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: page.variables, data: page.data });
    }

  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        cachebay.__internals.planner.getPlan(USERS_CACHEBAY_QUERY);

        iterations.push({ cachebay });
      }
    }
  });

  bench('apollo - writeQuery', () => {
    const { apollo } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: page.variables, data: page.data });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        iterations.push({ apollo });
      }
    }
  });

  bench('relay - commitPayload', () => {
    const { relay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, page.variables), page.data);
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const relay = createRelay();

        iterations.push({ relay });
      }
    }
  });
});

describe('writeQuery – Paginated (HOT)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - writeQuery', () => {
    const { cachebay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: page.variables, data: page.data });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];

          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: page.variables, data: page.data });
        }

        iterations.push({ cachebay });
      }
    }
  });

  bench('apollo - writeQuery', () => {
    const { apollo } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: page.variables, data: page.data });
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];

          apollo.writeQuery({ broadcast: false, query: USERS_APOLLO_QUERY, variables: page.variables, data: page.data });
        }

        iterations.push({ apollo });
      }
    }
  });

  bench('relay - commitPayload', () => {
    const { relay } = iterations.pop();

    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];

      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, page.variables), page.data);
    }
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const relay = createRelay();

        for (let i = 0; i < pages.length; i++) {
          const page = pages[i];

          relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, page.variables), page.data);
        }

        iterations.push({ relay });
      }
    }
  });
});
