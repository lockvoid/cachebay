# SSR — dehydrate/hydrate, first-mount rules, Suspense

Cachebay is **request-scoped** on the server and **instance-scoped** on the client.

- **Server:** render with a fresh cache, then `dehydrate()` to a JSON snapshot.
- **Client:** call `hydrate(snapshot)` once at boot.
- On the **first client mount**, **cache-and-network** renders from the **hydrated cache** **without** a duplicate request; after that, CN behaves normally (cached + revalidate).

## Options

You can tune SSR/Suspense behavior when creating the cache:

```ts
import { createCachebay } from 'cachebay'

const cachebay = createCachebay({
  /** Suppress the first CN revalidate right after hydrate (ms) */
  hydrationTimeout: 120,

  /** After a result, serve repeat Suspense re-execs of the same op key from cache (ms) */
  suspensionTimeout: 800,

  /** (Optional) Default cache policy for executeQuery/executeMutation */
  // cachePolicy: 'cache-and-network',
})
```

- **`hydrationTimeout`** — grace period after `hydrate()` where the first **cache-and-network** render publishes **cached terminally** (no revalidate).
- **`suspensionTimeout`** — short window **after a result** during which a repeat execution of the **same op key** returns cached and skips a new fetch.

## What `hydrate()` restores

- **Entities** — normalized by `__typename:id`.
- **Connections** — canonical edges and `pageInfo` (plus any connection-level fields), re-attached to views so `edges[]` render instantly.

```ts
// Server-side
const snapshot = cachebay.dehydrate()

// Client-side
cachebay.hydrate(snapshot)
```

## First-mount behavior (policy matrix)

When a component renders **right after** `hydrate()`:

| Policy                | During hydration window                     | After window (normal)                      |
|-----------------------|---------------------------------------------|--------------------------------------------|
| **cache-and-network** | 0 requests (render cached, terminal)         | cached (non-terminal) + network revalidate |
| **cache-first**       | 0 requests (render cached, terminal)         | if not cached → 1 request                   |
| **network-only**      | 1 request                                     | 1 request                                   |
| **cache-only**        | 0 requests (cached or `CacheMiss`)           | 0 requests                                  |

The **hydration window** suppresses CN’s initial revalidate so the UI shows hydrated data without a “double fetch”.

---

## Suspense & duplicate re-exec protection

Some Suspense setups can re-run the same query immediately after a result. Cachebay smooths this with a **short after-result window**:

- A repeat execution of the same **op key** within that window is served **from cache** and **does not refetch**.
- Applies to **cache-and-network** and **network-only** (when cached data exists).

## Basic wiring

```ts
import { createCachebay } from 'cachebay'

// Server
const cachebay = createCachebay()
// ...render your app...
const snapshot = cachebay.dehydrate()
// ...embed snapshot in HTML (e.g., window.__CACHEBAY__ = {...})

// Client
const cachebay = createCachebay();

if ((window as any).__CACHEBAY__) {
  cachebay.hydrate((window as any).__CACHEBAY__)
}
```


## Vue/Nuxt wiring

```ts
// plugins/cachebay.ts
import { defineNuxtPlugin } from '#app'
import { createCachebay } from 'cachebay'
import { toRaw } from 'vue'

export default defineNuxtPlugin((nuxtApp) => {
  const url = '/graphql';

  const cachebay = createCachebay({
    transport: {
      http: createHttpTransport(url),
      ws: createWsTransport(url),
    },

    // hydrationTimeout: 120,
    // suspensionTimeout: 800,
  })

  nuxtApp.vueApp.use(cachebay)

  // Server: persist snapshot after render
  if (import.meta.server) {
    nuxtApp.hook('app:rendered', () => {
      useState('cachebay').value = cachebay.dehydrate();
    })
  }

  // Client: hydrate once if SSR is enabled
  if (import.meta.client && settings.ssr) {
    const state = useState('cachebay').value;

    if (state) {
      cachebay.hydrate(toRaw(state))
    }
  }
})
```

## Next steps

Review [KEYNOTES.md](./KEYNOTES.md) for architectural insights, or explore the [demo app](../packages/demo) to see everything in action.

## See also

- **Setup** — cache configuration & policies: [SETUP.md](./SETUP.md)
- **Queries** — cache policies & execution: [QUERIES.md](./QUERIES.md)
- **Relay connections** — directive, merge modes, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, entity ops, `addNode` / `removeNode` / `patch`: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **Fragments** — identify / read / write: [FRAGMENTS.md](./FRAGMENTS.md)
- **Mutations** — write merging & optimistic patterns: [MUTATIONS.md](./MUTATIONS.md)
