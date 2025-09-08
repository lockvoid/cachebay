# Cachebay for Villus

**Blazing-fast normalized cache + Relay-style connections for Villus.**

A tiny (12KB gzip), instance-scoped cache layer for **Villus** that gives you:

- **Normalized entities** — one source of truth keyed by `__typename:id`, zero fuss.
- **Relay-style connections** — append/prepend/replace, edge de-duplication by node key, reactive `pageInfo`/meta, and **no array churn**.
- **Optimistic updates that stack** — layered commits/reverts for entities *and* connections (add/remove/update pageInfo) with clean rollback.
- **SSR that just works** — dehydrate/hydrate entities, connections, and op-cache; first client mount renders from cache without a duplicate request, then behaves like normal CN.
- **Fragments API** — `identify`, `readFragment`, `writeFragment` (supports interfaces like `Node:*`), with reactive materialized proxies.
- **Resolver pipeline** — bind per-type field resolvers (e.g. `relay()` for connections, your own computed/scalar transforms).
- **Subscriptions** — observable pass-through; plain frames get normalized and stream as non-terminating updates.
- **Batched reactivity** — microtask-coalesced updates to minimize re-renders.
- **Suspense** — suspense out of the box, with different strategies.


![Cachebay](https://pub-464e6b9480014239a02034726cf0073c.r2.dev/cachebay.jpg)

---

## Install

```bash
npm i villus villus-cachebay
# or
pnpm add villus villus-cachebay
```

---

## Quick start

```ts
// client.ts
import { createClient } from 'villus'
import { createCache } from 'villus-cachebay'
import { fetch as fetchPlugin, dedup as dedupPlugin } from 'villus' // your transport

export const cache = createCache({
  resolvers: ({ relay }) => ({
    Query: {
      assets: relay(),   // Relay connection (append/prepend/replace handled automatically)
    },
  }),
})

export const client = createClient({
  url: '/graphql',

  cachePolicy: 'cache-and-network',

  use: [
    // (optional) put your network dedup plugin first if you have one
    cache,
    dedupPlugin(),
    fetchPlugin(),
  ],
})
```

Query with Relay:

```ts
// in a component
import { useQuery } from 'villus'

const { data } = useQuery({
  query: `
    query Assets($first:Int,$after:String) {
      assets(first:$first, after:$after) {
        pageInfo {
          endCursor
          hasNextPage
        }

        edges {
          node {
            id name
          }
        }
      }
    }
  `,

  variables: {
    first: 20,
  },
})
```

### SSR

```ts
// server (per request):
const snapshot = cachebay.dehydrate()

// client boot
cachebay.hydrate(snapshot, { materialize: true })
```

> On first client mount after `hydrate`, **cache-and-network** uses a one-time ticket so it **renders from cache without a duplicate request**. After that, "cache-and-network" behaves normally (cached + revalidate).

---

## Install with Nuxt 4

> Minimal pattern: one cache instance per SSR request, dehydrate to a Nuxt state, hydrate on the client, and expose Villus + Cachebay via plugins.

**1) Create a Nuxt plugin (client & server) to wire Villus + Cachebay**

```ts
// plugins/villus.ts

import { createClient } from 'villus'
import { createCache } from 'villus-cachebay'
import { fetch as fetchPlugin } from 'villus'

export default defineNuxtPlugin((nuxtApp) => {
  const cachebay = createCache({
    resolvers: ({ relay }) => ({
      Query: { assets: relay() },
    }),
  })

  const state = useState('cachebay', () => null);

  if (process.server) {
    // After this request is rendered, stash a snapshot into Nuxt state

    nuxtApp.hook('app:rendered', () => {
      state.value = cachebay.dehydrate()
    })
  } else {
    // On client boot, hydrate once (if a snapshot was provided)

    if (state.value) {
      cachebay.hydrate(state.value, { materialize: true })
    }
  }

  // Build the Villus client

  const client = createClient({
    url: '/graphql',

    cachePolicy: 'cache-and-network',

    use: [
      cachebay,
      fetchPlugin(),
    ],
  })

  // Provide both to the app

  nuxtApp.vueApp.use(client)
  nuxtApp.vueApp.use(cachebay)
})
```

**2) Use it in components**

```vue
<script setup lang="ts">
  import { useQuery } from 'villus'

  const { data } = await useQuery({
    query: `...`,
  })
</script>

<template>
  <ul>
    <li v-for="edge in data.assets.edges" :key="edge.node.id">
      {{ edge.node.name }}
    </li>
  </ul>
</template>
```

**Demo app:**
👉 **[Nuxt 4 demo](...)**

---

## Fragments

```ts
import { useCache } from 'villus-cachebay'

const { readFragment, writeFragment } = useCache()

const asset = readFragment('Asset:42') // reactive$

writeFragment({ __typename: 'Asset', id: 42, name: 'Renamed' }).commit?.()
```

---

## Optimistic updates (entities & connections)

```ts
const tx = (cache as any).modifyOptimistic((optimistic) => {
  // Write an entity

  optimistic.write({ __typename:'Asset', id: 999, name:'New (optimistic)' }, 'merge')

  // Connection

  const [connection] = optimistic.connections({ parent: 'Query', field: 'assets' })

  connection.addNode({ __typename:'Asset', id: 999, name:'New (optimistic)' }, { cursor: 'client:999', position: 'start' })

  connection.removeNode(`Asset:999`)
})

tx.commit?.()

tx.revert?.() // Rolls back this layer only and replays any later ones
```

- Layers stack in order; `revert()` drops that layer and **rebuilds** state from the base + other layers.
- Connection helpers dedup by entity key and update cursor/meta in place.
- See **docs/OPTIMISTIC_UPDATES.md** for the full API and patterns.

---

## Cache policies (at a glance)

- **cache-only**: if cached → render cached; else error `CacheOnlyMiss`. No network.
- **cache-first**: if cached → render cached; else wait for network. No revalidate.
- **cache-and-network**: if cached → render cached immediately; also revalidate (except on the **first client mount after SSR**, where we render cached without the duplicate).

---

## Recommended plugin order

```
cachebay → dedup() → fetch()
```

---

## Links

- **Optimistic updates** — layering, rollback, connection helpers
  👉 [docs/OPTIMISTIC_UPDATES.md](./docs/OPTIMISTIC_UPDATES.md)
- **Relay connections** — append/prepend/replace, dedup, view limits, policy matrix
  👉 [docs/RELAY_CONNECTIONS.md](./docs/RELAY_CONNECTIONS.md)
- **SSR** — dehydrate/hydrate, one-time CN suppression, materialization, Suspense notes
  👉 [docs/SSR.md](./docs/SSR.md)
- **Cache fragments** — identify/read/write, interfaces, proxies vs raw
  👉 [docs/CACHE_FRAGMENTS.md](./docs/CACHE_FRAGMENTS.md)
- **Resolvers** — writing custom resolvers; using `relay()`
  👉 [docs/RESOLVERS.md](./docs/RESOLVERS.md)
- **Subscriptions** — pass-through vs frame mode
  👉 [docs/SUBSCRIPTIONS.md](./docs/SUBSCRIPTIONS.md)

---

## Why Cachebay?

- **Small & focused.** One instance per client/SSR request; no global singletons.
- **Fast rendering.** Microtask-batched updates; stable Relay views that don’t churn arrays.
- **Practical SSR.** Hydrate once, show cached instantly, then carry on like normal CN.
- **Ergonomic APIs.** Fragments, optimistic edits, resolvers — without ceremony.

MIT © LockVoid Labs ~●~
