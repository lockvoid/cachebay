import { bench, describe } from 'vitest';
import { createCachebay as createCachebayClient } from "../../../cachebay/src/core/client";
import { InMemoryCache } from "@apollo/client/cache";
import { relayStylePagination } from "@apollo/client/utilities";
import { Environment, Network, RecordSource, Store, createOperationDescriptor } from "relay-runtime";
import { buildUsersResponse, buildPages, USERS_CACHEBAY_QUERY, USERS_APOLLO_QUERY } from "../../src/utils/api";
import USERS_RELAY_QUERY from "../../src/__generated__/apiUsersRelayQuery.graphql";

const ITERATIONS = 50;

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

describe('watchQuery – HOT', () => {
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

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        iterations.push({ cachebay });
      }
    }
  });

  bench('relay - subscribe', async () => {
    const { relay } = iterations.pop();

    const snapshot = relay.lookup(createOperationDescriptor(USERS_RELAY_QUERY, { first: 10, after: null }));
    const disposable = relay.subscribe(snapshot, () => {});

    for (let i = 0; i < pages.length; i++) {
      relay.commitPayload(createOperationDescriptor(USERS_RELAY_QUERY, pages[i].variables), pages[i].data);

      await Promise.resolve();
    }

    disposable.dispose();
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

describe('watchQuery (initial:hot)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });
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

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        cachebay.readQuery({ query: USERS_CACHEBAY_QUERY, variables: { first: 10, after: null }, canonical: true });

        iterations.push({ cachebay });
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

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
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

describe('watchQuery (reactive)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - watchQuery (reactive)', async () => {
    const { cachebay } = iterations.pop();

    cachebay.watchQuery({
      query: USERS_CACHEBAY_QUERY,
      variables: { first: 10, after: null },
      immediate: false,
    });

    cachebay.writeQuery({
      query: CACHEBAY_USER_QUERY,
      variables: { id: "u1" },
      data: { user: { __typename: "User", id: "u1", name: `User ${Math.random()}`  } },
    });
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < pages.length; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        iterations.push({ cachebay });
      }
    }
  });

  bench('apollo - watch', () => {
    const { apollo } = iterations.pop();

    apollo.watch({
      query: USERS_APOLLO_QUERY,
      variables: { first: 10, after: null },
      immediate: false,
    });

    apollo.writeQuery({
      query: APOLLO_USER_QUERY,
      variables: { id: "u1" },
      data: { user: { __typename: "User", id: "u1", name: `User ${Math.random()}` } },
    });
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        for (let j = 0; j < pages.length; j++) {
          apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        iterations.push({ apollo });
      }
    }
  });

  bench('relay - subscribe (reactive)', () => {
    const { relay } = iterations.pop();

    const snapshot = relay.lookup(createOperationDescriptor(USERS_RELAY_QUERY, { first: 10, after: null }).fragment);

    relay.subscribe(snapshot, () => {});

    relay.commitUpdate((store) => {
      const user = store.get("u1");

      if (user) {
        user.setValue(`User ${Math.random()}`, "name");
      }
    });
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

describe('watchQuery (pagination)', () => {
  const pages = buildPages({ data: buildUsersResponse({ users: 1000, posts: 5, comments: 3 }), pageSize: 10 });
  const iterations = [];

  bench('cachebay - watchQuery (pagination)', async () => {
    const { cachebay } = iterations.pop();

    cachebay.watchQuery({
      query: USERS_CACHEBAY_QUERY,
      variables: { first: 10, after: null },
      canonical: true,
      immediate: false,
      onData: () => {},
    });

    const pageIndex = Math.floor(Math.random() * (pages.length - 3)) + 3;

    cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[pageIndex].variables, data: pages[pageIndex].data });

    await Promise.resolve();
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const cachebay = createCachebay();

        for (let j = 0; j < 3; j++) {
          cachebay.writeQuery({ query: USERS_CACHEBAY_QUERY, variables: pages[j].variables, data: pages[j].data });
        }


        iterations.push({ cachebay });
      }
    }
  });

  bench('apollo - watch (pagination)', () => {
    const { apollo } = iterations.pop();

    apollo.watch({
      query: USERS_APOLLO_QUERY,
      variables: { first: 10, after: null },
      optimistic: false,
      immediate: false,
      callback: () => {},
    });

    const pageIndex = Math.floor(Math.random() * (pages.length - 3)) + 3;

    apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[pageIndex].variables, data: pages[pageIndex].data });
  }, {
    iterations: ITERATIONS,

    setup() {
      iterations.length = 0;

      for (let i = 0; i < ITERATIONS + 10; i++) {
        const apollo = createApollo();

        for (let j = 0; j < 3; j++) {
          apollo.writeQuery({ query: USERS_APOLLO_QUERY, variables: pages[j].variables, data: pages[j].data });
        }

        iterations.push({ apollo });
      }
    }
  });
});
