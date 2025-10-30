
# Subscriptions

**Streaming updates** with Cachebay — agnostic API and Vue bindings.

* Agnostic API: `executeSubscription`
* Vue: `useSubscription` (from `cachebay/vue`)

## `executeSubscription` (agnostic)

Starts a subscription and returns an observable you can subscribe to.

**Signature**

```ts
const observable = cachebay.executeSubscription({
  query, // string | DocumentNode
  variables, // optional object
  onData, // optional (data) => void
  onError, // optional (error) => void
  onComplete, // optional () => void
});

// Observable-like: { subscribe({ next, error, complete }) }
```

**Example**

```ts
const subscription = cachebay.executeSubscription({
  query: `
    subscription PostUpdated($id: ID!) {
      postUpdated(id: $id) {
        post { id title }
      }
    }
  `,

  variables: {
    id: "p1"
  },

  onData: (data) => {
    console.log("inline handler:", data);
  },
});

const { unsubscribe } = subscription.subscribe({
  next: (result) => {
    if (result.error) {
      console.error(result.error);
    } else {
      console.log(result.data);
    }
  },

  error: (error) => {
    console.error(error);
  },

  complete: () => {
    console.log("done");
  },
});

unsubscribe();
```

---

## Transport setup

Cachebay should be provided with transports: `transport.http` for queries/mutations, and `transport.ws` for subscriptions (can be backed by WebSocket **or** SSE).

Pass it when creating Cachebay:

```ts
import { createCachebay } from "cachebay";

const cachebay = createCachebay({
  transport: {
    http: async ({ query, variables }) => {
      // ...
    },

    ws: createGraphqlWsTransport("wss://example.com/graphql"),
  },
});
```

### Example via `graphql-ws`

```ts
import { createClient } from "graphql-ws";

export const createGraphqlWsTransport = (url) => {
  const client = createClient({ url });

  return ({ query, variables }) => {
    return {
      subscribe(observer) {
        const unsubscribe = client.subscribe({ query, variables }, {
          next: (payload) => {
            observer.next({ data: payload.data ?? null, error: null });
          },

          error: (error) => {
            observer.error(error);
          },

          complete: () => {
            observer.complete();
          },
        });

        return {
          unsubscribe,
        };
      },
    };
  };
};
```

### Example via `graphql-sse`

```ts
import { createClient } from "graphql-sse";

export const createGraphqlSseTransport = (url) => {
  const client = createClient({ url });

  return ({ query, variables }) => {
    return {
      subscribe(observer) {
        const unsubscribe = client.subscribe({ query, variables }, {
          next: (payload) => {
            observer.next?.({ data: payload.data ?? null, error: null });
          },
          error: (err) => {
            observer.error?.(err);
          },
          complete: () => {
            observer.complete?.();
          },
        });

        return {
          unsubscribe,
        };
      },
    };
  };
};
```

## Vue

### `useSubscription`

A small wrapper that exposes reactive `data`, `error`, and `isFetching`. It uses the transport you configured.

**Basic usage**

```vue
<script setup lang="ts">
import { useSubscription } from "cachebay/vue";

const { data, error, isFetching } = useSubscription({
  query: `
    subscription OnPostUpdated($id: ID!) {
      postUpdated(id: $id) {
        post { id title }
      }
    }
  `,

  variables: {
    id: "p1"
  },
});
</script>

<template>
  <div v-if="isFetching">Listening…</div>
  <pre v-else-if="error">{{ error?.message }}</pre>
  <pre v-else>{{ data }}</pre>
</template>
```

**Enable/Disable via reactive variables**

```vue
<script setup lang="ts">
import { ref } from "vue";
import { useSubscription } from "cachebay/vue";

const id = ref("p1");
const enabled = ref(false);

const { data } = useSubscription({
  query: `
    subscription OnPostUpdated($id: ID!) {
      postUpdated(id: $id) {
        post { id title }
      }
    }
  `,

  variables: {
    id,
  },

  enabled,
});

// later
id.value = "p2";
enabled.value = true; // start
enabled.value = false; // stop
</script>
```

---

## Next steps

Continue to [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md) to learn about cursor-based pagination with infinite scroll and page-based navigation.

## See also

* **Queries** — read/write/watch + policies: [QUERIES.md](./QUERIES.md)
* **Mutations** — write merging: [MUTATIONS.md](./MUTATIONS.md)
* **Relay connections** — pagination updates: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
* **Optimistic updates** — layering & helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
* **SSR** — hydrate/dehydrate: [SSR.md](./SSR.md)
