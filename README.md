# Cachebay for Villus

[![CI](https://github.com/lockvoid/villus-cachebay/actions/workflows/test.yml/badge.svg)](https://github.com/lockvoid/villus-cachebay/actions/workflows/test.yml)
[![npm version](https://badge.fury.io/js/villus-cachebay.svg)](https://badge.fury.io/js/villus-cachebay)
[![Coverage](https://codecov.io/gh/lockvoid/villus-cachebay/branch/main/graph/badge.svg)](https://codecov.io/gh/lockvoid/villus-cachebay)
[![Bundlephobia](https://img.shields.io/bundlephobia/minzip/villus-cachebay)](https://bundlephobia.com/package/villus-cachebay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img width="100" height="100" alt="Cachebay" src="https://pub-464e6b9480014239a02034726cf0073c.r2.dev/cachebay.png">

**Blazing-fast normalized cache x Relay-style connections for [Villus](https://villus.dev/).**

A tiny (11KB gzip), instance-scoped cache layer for **Villus** that gives you:

- **Small & focused APIs.** Fragments, optimistic edits, and Relay connections — without ceremony.
- **Fast rendering.** Microtask-batched updates; stable Relay views that don't churn arrays and minimize re-renders.
- **Relay-style connections** — append/prepend/replace, edge de-duplication by node key, reactive, and **no array churn**.
- **Optimistic updates that stack** — layered commits/reverts for entities *and* connections (add/remove/update pageInfo) with clean rollback.
- **SSR that just works** — dehydrate/hydrate; first client mount renders from cache without a duplicate request; clean Suspense behavior.
- **Fragments API** — `identify`, `readFragment`, `writeFragment` (interfaces supported), plus reactive materialized proxies.
- **Tiny composables** — `useFragment`, `useFragments`, `useCache`
- **Subscriptions** — plain frames get normalized and stream as non-terminating updates.
- **Suspense** — first-class support.
- **Compiller mode (alpha)** — boost performance by pre-compiling fragments and queries.

---

## Documentation

- **[Relay connections](./docs/RELAY_CONNECTIONS.md)** — `@connection` directive, append/prepend/replace, de-dup, policy matrix
- **[Optimistic updates](./docs/OPTIMISTIC_UPDATES.md)** — layering, rollback, entity ops, connection ops (`addNode` / `removeNode` / `patch`)
- **[Fragments](./docs/FRAGMENTS.md)** — `identify()`, `readFragment()`, `writeFragment()`
- **[Composables](./docs/COMPOSABLES.md)** — `useCache()`, `useFragment()`
- **[SSR](./docs/SSR.md)** — dehydrate/hydrate, one-time cache render, Suspense notes

---

## Keynotes

A quick architectural overview of how Cachebay works — see **[Keynotes](./docs/KEYNOTES.md)**.

---

## Demo app

**[Nuxt 4 Demo App ϟ](./demo)**

or try live [https://harrypotter.exp.lockvoid.com/](https://harrypotter.exp.lockvoid.com/)

---

## Install

Package installation using npm or pnpm to add Villus and Cachebay dependencies to your project.

```bash
npm i villus villus-cachebay
# or
pnpm add villus villus-cachebay
```

---

## Quick start

Basic setup for creating a Cachebay-enabled Villus client with normalized caching and network transport configuration.

```ts
// client.ts
import { createClient } from 'villus'
import { createCache } from 'villus-cachebay'
import { fetch as fetchPlugin } from 'villus'

export const cache = createCache({
  // e.g. keys: { Post: (post) => post.id }
})

export const client = createClient({
  url: '/graphql',

  cachePolicy: 'cache-and-network',

  use: [
    cache,
    fetchPlugin(),
  ],
})
```

### Cachebay Options

Configuration options for customizing Cachebay behavior including entity identification, interface mapping, and SSR/Suspense timeouts.

```ts
import { createCache } from 'villus-cachebay'

const cache = createCache({
  keys: {
    // e.g. AudioPost: (post) => post?.id ?? null
  },

  interfaces: {
    // e.g. Post: ['AudioPost','VideoPost']
  },

  hydrationTimeout: 100, // default
  suspensionTimeout: 1000, // default
})
```

- **keys / interfaces**: how identity and interface reads work → see **[Fragments](./docs/FRAGMENTS.md)**.
- **hydrationTimeout / suspensionTimeout**: how SSR & Suspense windows are handled → see **[SSR](./docs/SSR.md)**.

---

**Basic Query with Relay Connection**

Example of using the `@connection` directive for cursor-based pagination with automatic edge management and page merging.

```ts
import { useQuery } from 'villus'

const { data } = useQuery({
  query: `
    query Posts($first: Int, $after: String) {
      posts(first: $first, after: $after) @connection {
        pageInfo {
          endCursor
          hasNextPage
        }

        edges {
          node {
            id
            title
          }
        }
      }
    }
  `,

  variables: {
    first: 20
  },
})
```

### SSR

Server-side rendering support through cache snapshots that enable seamless hydration and prevent duplicate requests on first client mount.

```ts
// Server:
const snapshot = cache.dehydrate()

// Client:
cache.hydrate(snapshot)
```

> On first client mount after `hydrate`, **cache-and-network** renders from cache **without a duplicate request**. After that, it behaves normally (cached + revalidate).

---

## Usage with Nuxt 4

Integration pattern for Nuxt 4 using plugins to manage cache lifecycle, state synchronization between server and client, and proper hydration handling.

> Minimal pattern: one cache instance per SSR request, dehydrate to a Nuxt state, hydrate on the client, and expose Villus + Cachebay via plugins.

**1) Nuxt plugin (client & server)**

```ts
// plugins/villus.ts
import { createClient } from 'villus'
import { createCache } from 'villus-cachebay'
import { fetch as fetchPlugin, dedup as dedupPlugin } from 'villus'

export default defineNuxtPlugin((nuxtApp) => {
  const cache = createCache()

  const state = useState('cachebay', () => null)

   if (import.meta.server) {
    nuxtApp.hook("app:rendered", () => {
      useState("cachebay").value = cachebay.dehydrate();
    });
  };

  if (import.meta.client) {
    const state = useState('cachebay').value;

    if (state) {
      cachebay.hydrate(state);
    }
  }

  const client = createClient({
    url: '/graphql',

    cachePolicy: 'cache-and-network',

    // Recommended plugin order: cachebay → dedup() → fetch()
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

**2) Use it in components**

```vue
<script setup lang="ts">
import { useQuery } from 'villus'

const POSTS_QUERY = /* GraphQL */ `
  query Posts($first: Int, $after: String) {
    posts(first: $first, after: $after) @connection {
      pageInfo {
        endCursor
        hasNextPage
      }

      edges {
        node {
          id
          title
        }
      }
    }
  }
`

const { data } = await useQuery({
  query: POSTS_QUERY,

  variables: {
    first: 10,
  }
})
</script>

<template>
  <ul>
    <li v-for="e in data?.posts?.edges" :key="e.node.id">
      {{ e.node.title }}
    </li>
  </ul>
</template>
```

---

## Fragments

Reactive fragment system for reading and writing normalized entities. Returns Vue proxies that automatically update when underlying data changes, enabling granular cache management and optimistic updates.

Reactive proxies are returned by reads; writes update normalized state immediately.

```js
import { useCache } from 'villus-cachebay'
const { identify, readFragment, writeFragment } = useCache()

identify({ __typename: 'Post', id: 42 }) // → "Post:42"

const post = readFragment({
  id: 'Post:42',

  fragment: `
    fragment PostFields on Post {
      id
      name
    }
  `,
})

writeFragment({
  id: 'Post:42',

  fragment: `
    fragment PostFields on Post {
      id
      title
    }
  `,

  data: {
    title: 'New title'
  },
})
```

See **[Cache fragments](./docs/CACHE_FRAGMENTS.md)** for a concise API (`identify`, `readFragment`, `writeFragment`) and simple examples.

---

## Optimistic updates (entities & connections)

Layered optimistic update system that allows stacking multiple transactions with clean rollback capabilities. Supports both entity modifications and connection operations for comprehensive cache manipulation during pending network requests.

```ts
const tx = cache.modifyOptimistic((tx) => {
  // Entity edits
  tx.patch('Post:999', { title:'New optimistic title' }, { mode:'merge' })

  tx.delete('Post:999')

  // Connection edits
  const connection = tx.connection({ parent:'Query', key:'posts' })

  // Add a node
  connection.addNode({ __typename:'Asset', id:'999', name:'New (optimistic)' }, { position:'start' })

  // Insert a node
  connection.addNode({ __typename:'Asset', id:'100', name:'Inserted Before' }, { position:'before', anchor:'Asset:123' })
  connection.addNode({ __typename:'Asset', id:'101', name:'Inserted After'  }, { position:'after',  anchor:{ __typename:'Asset', id:'123' } })

  // Remove a nide
  connection.removeNode('Asset:999')

  // Patch pageInfo, etc...
  connection.patch(prev => ({ pageInfo: { ...prev.pageInfo, hasNextPage:false } }))
})

tx.commit?.()
// tx.revert?.() // rolls back this layer and replays later ones
```

- Layers stack in insertion order; `revert()` restores the earliest baseline, **reconstructs** canonicals, then replays remaining layers.
- `addNode` de-dups by node key and updates edge meta in place.
- `position`: `"start" | "end" | "before" | "after"`, with optional `anchor` for relative insert.

See **[Optimistic updates](./docs/OPTIMISTIC_UPDATES.md)** for more details and examples.

---

MIT © LockVoid Labs ~●~
