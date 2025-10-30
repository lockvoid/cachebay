
# Setup

Create a Cachebay instance, wire a network transport, and (optionally) use a framework adapter. The core is framework‑agnostic; adapters add ergonomic APIs.

## Create Instance

Create a cache instance with `createCachebay(options)` and reuse it across your app. On the server, create one cache **per request**; in the browser, typically a **single app‑wide** instance.

**Options**

* `transport.http` *(required)*: function that performs queries/mutations.
* `transport.ws` *(optional)*: function that returns an **observable‑like** with `subscribe({ next, error, complete })` for subscriptions.
* `cachePolicy?` *(default: "cache-first")*: default policy for queries; override per operation as needed.
* `keys?`: only if you need custom identity; by default Cachebay uses the object's `id` field.
* `interfaces?`: interface → implementing types map (resolves interface fragments).
* `hydrationTimeout?` *(ms, default 100)*: Hydration timeout window.
* `suspensionTimeout?` *(ms, default 1000)*: Suspension window to stabilize repeated calls.

### Example

```ts
// cachebay.ts
import { createCachebay } from 'cachebay';

const http = async ({ query, variables })) => {
  try {
    const res = await fetch('/graphql', {
      method: 'POST',

      headers: {
        'content-type': 'application/json',
      },

      body: JSON.stringify({ query, variables }),
    });

    const json = await res.json();

    return { data: json?.data ?? null, error: result.errors?.[0] ?? null };
  } catch (error) {
    return { data: null, error };
  }
};

export const cache = createCachebay({
  transport: { http },
});
```

## Cache policies & suspension

Cachebay supports four cache policies (default: `"cache-first"`).

| Policy                | Cache behavior                                                                | Network behavior                                                                          |
| --------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| **cache-and-network** | If cached, emit immediately.                                                  | Always fetch; when the response arrives, normalize and re‑emit updated data (revalidate). |
| **cache-first**       | If cached, use it.                                                            | If not cached, fetch once; otherwise no network.                                          |
| **network-only**      | (During Hydration timeout, a cached value may be used once to avoid flicker.) | Always fetch and return the network result; cache is not used to satisfy the request.     |
| **cache-only**        | Read from cache only.                                                         | Never fetch; if missing, throws `CacheMissError`.                                         |

**Suspension timeout** (`suspensionTimeout`, default **1000 ms**): caches recent/in‑flight results for the same query signature to stabilize Suspense and dedupe repeated calls.

**Hydration timeout** (`hydrationTimeout`, default **100 ms**): shortly after load, the client may prefer cached data to prevent flashes (then proceeds with the selected policy). See **[SSR.md](./SSR.md)** for details.

## Entity identity

Customize identity and enable interface‑style addressing at **cache creation**.

```ts
import { createCachebay } from 'cachebay'

const cache = createCachebay({
  keys: {
    User: (user) => {
      return user.id;
    }

    Post: (post) => {
      return post.uuid;
    }
  },

  interfaces: {
    Post: ['AudioPost', 'VideoPost'],
  },
})
```

**How keys work**

* A key function receives the raw object and must return a **unique value**  across entity type.
* If no key rule matches a type, Cachebay falls back to the object's `id` field.

**How interfaces work**

* Declaring `interfaces.Post = ['AudioPost','VideoPost']` lets you **address by parent type**:

  * `readFragment('Post:123')` resolves to the concrete record once known (e.g., `"AudioPost:123"`).
* Writes still occur on **concrete** records (e.g., `{ __typename: 'AudioPost', uuid: '123' }`).


## Vue / Nuxt

Cachebay ships a Vue adapter with composables (`useQuery`, `useFragment`, `useMutation`, `useSubscription`). Import **only** from `cachebay/vue`.

### Vue

Install the adapter as a Vue plugin via `app.use(cachebay)`:

```ts
// app.ts
import { createApp } from 'vue';
import { createCachebay } from 'cachebay/vue';
import App from './App.vue';

const cachebay = createCachebay({
  transport: {
    http: async ({ query, variables }) => {
      try {
        const res = await fetch('/graphql', {
          method: 'POST',

          headers: {
            'content-type': 'application/json',
          },

          body: JSON.stringify({ query, variables }),
        });

        const json = await res.json();

        return { data: json?.data ?? null, error: result.errors?.[0] ?? null };
      } catch (error) {
        return { data: null, error };
      }
    },
  },
});

createApp(App).use(cachebay).mount('#app');
```

### Nuxt

Create and install the plugin inside a client plugin file.

```ts
// plugins/cachebay.client.ts
import { createCachebay } from "cachebay/vue";

export default defineNuxtPlugin((nuxtApp) => {
  const cachebay = createCachebay({
    transport: async ({ query, variables }, ctx) => {
      try {
        const result = await $fetch('/graphql', {
          method: "POST",

          body: { query, variables },
        });

        return { data: result.data, error: result.errors?.[0] };
      } catch (error) {
        return { data: null, error };
      }
    },
  });

  nuxtApp.vueApp.use(cachebay);
});
```

## Next steps

Continue to `OPERATIONS.md` for executing queries, mutations, and subscriptions.

## See also

* **Queries** — [QUERIES.md#queries](./OPERATIONS.md#queries)
* **Mutations** — [MUTATIONS.md#mutations](./OPERATIONS.md#mutations)
* **Subscriptions** — [SUBSCRIPTIONS.md#subscriptions](./OPERATIONS.md#subscriptions)
* **SSR** — [SSR.md](./SSR.md)
