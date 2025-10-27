import { bench, describe } from 'vitest';
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import { buildUsersResponse, buildPages, USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/api";
import USERS_RELAY_QUERY from "../../src/__generated__/apiUsersRelayQuery.graphql";

const ITERATIONS = 1;

const CACHEBAY_USER_QUERY = `
  query UserName($id: ID!) {
    user(id: $id) { __typename id name }
  }
`;

const APOLLO_USER_QUERY = `
  query UserName($id: ID!) {
    user(id: $id) { __typename id name }
  }
`;

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
/*
describe('watchQuery (initial:cold)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - watchQuery', async () => {
    const { cachebay } = iterations.pop();

    const subscription = cachebay.watchQuery({ query: USERS_CACHEBAY_QUERY, variables: { first: 10, after: null } });

    for (let i = 0; i < pages.length; i++) {
      cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[i].variables, data: pages[i].data });

      await Promise.resolve();
    }

    subscription.unsubscribe();
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const cachebay = createCachebay();

        iterations.push({ cachebay });
      }
    }
  });

  bench('relay - subscribe', async () => {
    const { relay, operation } = iterations.pop();

    const snapshot = relay.lookup(operation.fragment);
    const disposable = relay.subscribe(snapshot, () => {});

    for (let i = 0; i < pages.length; i++) {
      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, pages[i].variables), pages[i].data);
    }

    disposable.dispose();
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const relay = createRelay();

        const operation = createOperationDescriptor(USERS_RELAY_QUERY, { first: 10, after: null });

        iterations.push({ relay, operation });
      }
    }
  });
});*/

describe('watchQuery (initial:hot)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 100, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - watchQuery', () => {
    const { cachebay } = iterations.pop();

    const subscription = cachebay.watchQuery({
      query: USERS_CACHEBAY_QUERY,
      variables: { first: 10, after: null },
    });

    subscription.unsubscribe();
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        cachebay.readQuery({ query: USERS_CACHEBAY_QUERY, variables: { first: 10, after: null }, canonical: true });

        iterations.push({ cachebay });
      }
    }
  });

  bench('apollo - watch', () => {
    const { apollo } = iterations.pop();

    const observable = apollo.watch({
      query: USERS_APOLLO_QUERY,
      variables: { first: 10, after: null },
      optimistic: false,
    });

    const subscription = observable.subscribe(() => {});

    subscription.unsubscribe()
  }, {
    iterations: ITERATIONS,
    warmupIterations: 2,

    setup() {
      iterations.length = 0;

      console.log('tttt')
      for (let i = 0; i < (ITERATIONS + 10) * 5; i++) {
        const apollo = createApollo();

        for (let i = 0; i < pages.length; i++) {
          apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[i].variables, data: pages[i].data });
        }

        iterations.push({ apollo });
      }
    }
  });

  bench('relay - subscribe', () => {
    const { relay, operation } = iterations.pop();

    const snapshot = relay.lookup(operation.fragment);
    const disposable = relay.subscribe(snapshot, () => {});

    disposable.dispose();
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

        const operation = createOperationDescriptor(USERS_RELAY_QUERY, { first: 10, after: null });

        relay.lookup(operation.fragment);

        iterations.push({ relay, operation });
      }
    }
  });
});
