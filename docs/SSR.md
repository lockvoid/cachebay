# SSR — dehydrate/hydrate, first-mount behavior, Suspense, and op-key hygiene

Cachebay is built to be **request-scoped** on the server and **instance-scoped** on the client.

- On the **server**, you render with a fresh cache and then **dehydrate** it into a JSON snapshot.
- On the **client**, you **hydrate** that snapshot **once** at boot.
- On the first client mount, **cache-and-network** renders from the **hydrated cache** **without** issuing an immediate duplicate request; after that, CN behaves as usual (cached + revalidate).

> TL;DR: **hydrate first**, then mount; the UI shows cached data immediately, and you avoid “flash” or double fetch.

---

## What `hydrate` restores

- **Entities**: normalized by `__typename:id` (or `_id` / custom `keys()`).
- **Connections**: the internal list, `pageInfo`, `meta`, and view bindings.
- **Operation cache**: per op-key result used by `cache-first` / `cache-and-network`.

### Materialization (important)

Hydrating with `{ materialize: true }` **stitches hydrated result objects to live proxies**, e.g.:

- `edges[].node` become **materialized proxies** (reactive),
- `pageInfo` and connection `meta` are **reactive**,
- fragment writes (`writeFragment`/`patch`) update the UI **immediately**.

```ts
(cache as any).hydrate(snapshot, { materialize: true })
```

If you forget `materialize: true`, your hydrated lists will render, but subsequent fragment writes won’t update the UI until a revalidate/network result arrives.

---

## API

```ts
const snapshot = cache.dehydrate()

cache.hydrate(snapshot, {
  materialize?: boolean, // default false; true = stitch hydrated nodes → proxies
  rabbit?: boolean,      // default true; drop "first-mount tickets" for CN
})
```

- `rabbit: true` (default) drops a one-time ticket **per op-key** so the first client mount with **cache-and-network** renders from cache without a duplicate request; after that microtask, CN behaves normally.

---

## Typical wiring

### Server (per request)

```ts
// create a fresh cache for this SSR request
const cache = createCache({ /* resolvers, keys, ... */ })

// ... render with Villus + Cachebay ...

// after render
const snapshot = (cache as any).dehydrate()
// embed `snapshot` into your SSR payload (Nuxt state, HTML script tag, etc.)
```

### Client (boot)

```ts
const cache = createCache({ /* same config as server */ })

// if SSR provided a snapshot:
if (window.__CACHEBAY__) {
  (cache as any).hydrate(window.__CACHEBAY__, { materialize: true })
}

// make your Villus client
const client = createClient({
  url: '/graphql',
  cachePolicy: 'cache-and-network',
  use: [cache as any, fetch()],
})
```

On the first CN mount after `hydrate`, Cachebay consumes the **ticket** and publishes cached **terminally** (Suspense resolves immediately). After that, CN revalidates as usual.

---

## Suspense behavior

You do **not** need to pass `suspense: true` to get cached content on first mount:

- After `hydrate`, Cachebay publishes **terminal cached** on the first CN mount (**ticket** or **hydrating state**), so Suspense resolves with cached data.
- On subsequent mounts and variable changes, CN behaves normally: cached first (non-terminating) and then revalidate.

> If you ever see Suspense remain unresolved with CN on first mount, see **Troubleshooting** below (most often an op-key mismatch).

---

## Op-key hygiene (variable cleaning)

Op keys include the **variable object**. If the server dehydrates with `{ first: 20 }` but the client calls with `{ first: 20, after: undefined }`, the **keys differ** and the op cache won’t match.

Cachebay **attempts a “cleaned variables” lookup** (strips `undefined` fields) to match SSR keys, but for consistency, prefer **clean variable objects** on the client:

```ts
// good
useQuery({ variables: { first: 20 } })

// if using computed vars, filter undefineds:
const vars = computed(() => {
  const v = { first: props.first, after: props.after } as any
  Object.keys(v).forEach(k => v[k] === undefined && delete v[k])
  return v
})
```

---

## Nuxt 3 recipe (one cache per request)

**plugins/villus-cachebay.ts**
```ts
import { defineNuxtPlugin, useState } from '#app'
import { createClient } from 'villus'
import { createCache } from 'villus-cachebay'
import { fetch as fetchPlugin } from 'villus'

export default defineNuxtPlugin((nuxtApp) => {
  const cache = createCache({ /* resolvers, keys */ })
  const key = '__cachebay__'
  const state = useState<any>(key, () => null)

  if (process.server) {
    nuxtApp.hook('app:rendered', () => {
      state.value = (cache as any).dehydrate()
    })
  } else {
    if (state.value) {
      ;(cache as any).hydrate(state.value, { materialize: true })
    }
  }

  const client = createClient({
    url: '/graphql',
    cachePolicy: 'cache-and-network',
    use: [cache as any, fetchPlugin()],
  })

  nuxtApp.vueApp.use(client as any)
  nuxtApp.vueApp.use(cache as any)
})
```

Now your first CN mount renders hydrated data without a duplicate request, then revalidates normally.

---

## How connections are restored

Hydration rebuilds:

- the **list** for each connection,
- its **pageInfo** and **meta** (reactive),
- and re-attaches **views** so `edges[]` in your UI reflects `list` and **limit** immediately.

With `{ materialize: true }`, `edges[].node` are replaced by **materialized proxies**, so fragment writes update the UI after hydrate (no extra fetch required).

---

## Troubleshooting

**“Empty UI after hydrate with CN”**

- Ensure you **hydrate before** mounting and pass `{ materialize: true }`.
- Confirm variable **op-key** matches (avoid `undefined` fields on the client).
- Make sure the cache plugin runs **before** fetch in the Villus chain.
- In tests, `await tick()` once after hydrate and once after the first mount.

**“CN still refetches on first mount”**

- Verify you’re not creating a brand-new cache **after** hydration.
- Ensure no extra plugin is **short-circuiting** the cached emit.
- If you passed `{ rabbit: false }` to `hydrate`, the one-time suppression is disabled.

**“Fragments don’t update after hydrate”**

- You probably missed `{ materialize: true }`. Hydrate again with that flag so hydrated result objects are stitched to live proxies.

---

## FAQ

**Q: Do I need to call `client.execute(...)` on boot to prime the cache?**
**A:** Not after SSR. Hydrate restores the op cache and entities; CN shows cached immediately without refetch on first mount.

**Q: Where do I put a dedup/abort plugin?**
**A:** Prefer request-management **before** the cache (e.g., `dedup() → cachebay → fetch()`), or use `cachebay → dedup() → fetch()` if your dedup only examines `ctx.operation.key`. Cachebay itself focuses on cache semantics.

**Q: Can I hydrate without entities, just op cache?**
**A:** You can, but you’ll lose the benefits of `[materialize:true]` (instant fragment reactivity). We recommend full snapshots when possible.

---

## See also

- **Relay connections** — modes, dedup, limits, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, `patch` / `delete`, connection helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **Fragments** — identify/read/write & interface keys: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
