# SSR — dehydrate/hydrate, first-mount rules, Suspense

Cachebay is **request-scoped** on the server and **instance-scoped** on the client.

- **Server:** render with a fresh cache, then `dehydrate()` to a JSON snapshot.
- **Client:** call `hydrate(snapshot)` once at boot.
- On the **first client mount**, **cache-and-network** renders from the **hydrated cache** **without** a duplicate request; after that, CN behaves normally (cached + revalidate).

---

## What `hydrate()` restores

- **Entities** — normalized by `__typename:id`.
- **Connections** — canonical edges and `pageInfo` (plus any connection-level fields), re-attached to views so `edges[]` render instantly.

```ts
// Server-side
const snapshot = cache.dehydrate()

// Client-side
cache.hydrate(snapshot)
```

---

## First-mount behavior (policy matrix)

When a component renders **right after** `hydrate()`:

| Policy              | During hydration window                     | After window (normal)                      |
|---------------------|---------------------------------------------|--------------------------------------------|
| **cache-and-network** | 0 requests (render cached, terminal)         | cached (non-terminal) + network revalidate |
| **cache-first**       | 0 requests (render cached, terminal)         | if not cached → 1 request                   |
| **network-only**      | 1 request                                     | 1 request                                   |
| **cache-only**        | 0 requests (cached or `CacheOnlyMiss`)        | 0 requests                                  |

The **hydration window** is short and internal; it suppresses CN’s initial revalidate so the UI shows hydrated data without a “double fetch”.

---

## Suspense & duplicate re-exec protection

Some Suspense setups re-run the same query immediately after a result lands. Cachebay smooths this with a **short after-result window**:

- A repeat execution of the same **op key** within that window is served **from cache** and **does not refetch**.
- Applies to **cache-and-network** and **network-only** (when cached data exists).

---

## Wiring examples

### Vue (framework-agnostic)

**Server-side**

```ts
// server.ts
import { createCache } from 'villus-cachebay'

// New Cache Per SSR Request
const cache = createCache()

// Render Your App With This Cache Installed (details depend on your SSR stack)

// Serialize Snapshot
const snapshot = cache.dehydrate()

// Embed `snapshot` Into HTML Payload (e.g. window.__CACHEBAY__ = {...})
```

**Client-side**

```ts
// client.ts
import { createClient } from 'villus'
import { fetch as fetchPlugin } from 'villus'
import { createCache } from 'villus-cachebay'

// Optional Runtime Tuning
const cache = createCache({
  hydrationTimeout: 120,   // ms to suppress CN revalidate after hydrate
  suspensionTimeout: 800,  // ms to serve repeat Suspense re-execs from cache
})

// Hydrate Once If Provided
if ((window as any).__CACHEBAY__) {
  cache.hydrate((window as any).__CACHEBAY__)
}

// Villus Client
export const client = createClient({
  url: '/graphql',
  cachePolicy: 'cache-and-network',

  use: [
    cache,
    fetchPlugin(),
  ],
})

// Install `client` + `cache` Into Your App, Then Mount
```

---

### Nuxt 4

```ts
// plugins/villus.ts
import { createClient } from 'villus'
import { createCache } from 'villus-cachebay'
import { fetch as fetchPlugin, dedup as dedupPlugin } from 'villus'

export default defineNuxtPlugin((nuxtApp) => {
  const cache = createCache({
    // hydrationTimeout: 120,
    // suspensionTimeout: 800,
  })

  // Persist Per-Request Snapshot On The Server
  if (import.meta.server) {
    nuxtApp.hook('app:rendered', () => {
      useState('cachebay').value = cache.dehydrate()
    })
  }

  // Hydrate Once On The Client
  if (import.meta.client) {
    const state = useState('cachebay').value

    if (state) {
      cache.hydrate(state);
    }
  }

  // Villus Client
  const client = createClient({
    url: '/graphql',
    cachePolicy: 'cache-and-network',
    use: [
      cache,
      dedupPlugin(),
      fetchPlugin(),
    ],
  })

  nuxtApp.vueApp.use(client)
  nuxtApp.vueApp.use(cache)
})
```

---

## Options

You can tune SSR/Suspense timeouts when creating the cache:

```ts
import { createCache } from 'villus-cachebay'

const cache = createCache({
  /** Suppress the first CN revalidate right after hydrate (ms) */
  hydrationTimeout: 120,

  /** After a result, serve repeat Suspense re-execs of the same op key from cache (ms) */
  suspensionTimeout: 800,
})
```

- **`hydrationTimeout`** — grace period after `hydrate()` where the first **cache-and-network** render publishes **cached terminally** (no revalidate).
- **`suspensionTimeout`** — short window **after a result** during which a repeat execution of the **same op key** returns cached and skips a new fetch.

---

## See also

- **Relay connections** — directive, merge modes, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, entity ops, `addNode` / `removeNode` / `patch`: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **Fragments** — identify / read / write: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
- **Composables** — `useCache()`, `useFragment()`: [COMPOSABLES.md](./COMPOSABLES.md)
