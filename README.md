# Cachebay for Villus

[![CI](https://github.com/lockvoid/cachebay/actions/workflows/test.yml/badge.svg)](https://github.com/lockvoid/cachebay/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/cachebay.svg)](https://www.npmjs.com/package/cachebay)
[![Coverage](https://codecov.io/gh/lockvoid/cachebay/branch/main/graph/badge.svg)](https://codecov.io/gh/lockvoid/cachebay)
[![Bundlephobia](https://img.shields.io/bundlephobia/minzip/cachebay)](https://bundlephobia.com/package/cachebay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

<img width="100" height="100" alt="Cachebay" src="https://pub-464e6b9480014239a02034726cf0073c.r2.dev/cachebay.png">

**Pragmatic normalized cache x Relay-style connections for [Villus](https://villus.dev/).**

A tiny (11 kB gzipped) cache layer for **Villus**:

- **Small & focused APIs.** Queries, fragments, optimistic edits, and Relay connections — without ceremony.
- **Fast rendering and excellent performance.** Microtask-batched updates; stable Relay views that don't churn arrays and minimize re-renders.
- **Relay-style connections** — append/prepend/replace, edge de-duplication by node key, reactive, and **no array churn**.
- **Optimistic updates that stack** — layered commits/reverts for entities *and* connections (add/remove/update pageInfo) with clean rollback.
- **SSR that just works** — dehydrate/hydrate; first client mount renders from cache without a duplicate request; clean Suspense behavior.
- **Imperative cache API** — `readQuery`, `writeQuery`, `watchQuery` for direct cache access; `readFragment`, `writeFragment`, `watchFragment` for entities (interfaces supported).
- **Tiny composables** — `useFragment`, `useFragments`, `useCache`
- **Suspense** — first-class support.
- **Compiller mode (alpha)** — boost performance by pre-compiling fragments and queries.

---

## Documentation

- **[Relay connections](./docs/RELAY_CONNECTIONS.md)** — `@connection` directive, append/prepend/replace, de-dup, policy matrix
- **[Optimistic updates](./docs/OPTIMISTIC_UPDATES.md)** — layering, rollback, entity ops, connection ops (`addNode` / `removeNode` / `patch`)
- **[Queries](./docs/QUERIES.md)** — `readQuery()`, `writeQuery()`, `watchQuery()` for imperative cache access
- **[Fragments](./docs/FRAGMENTS.md)** — `identify()`, `readFragment()`, `writeFragment()`, `watchFragment()`
- **[Composables](./docs/COMPOSABLES.md)** — `useCache()`, `useFragment()`
- **[SSR](./docs/SSR.md)** — dehydrate/hydrate, one-time cache render, Suspense notes

---

## Keynotes

A quick architectural overview of how Cachebay works — see **[Keynotes](./docs/KEYNOTES.md)**.

---

## Demo app

**[Nuxt 4 Demo App ϟ](./packages/demo)**

or try live [https://harrypotter.exp.lockvoid.com/](https://harrypotter.exp.lockvoid.com/)

---

## Install

Package installation using npm or pnpm to add Villus and Cachebay dependencies to your project.

```bash
npm i villus cachebay
# or
pnpm add villus cachebay
```

---

## Quick start

Basic setup for creating a Cachebay-enabled Villus client with normalized caching and network transport configuration.

```ts
// client.ts
import { createClient } from 'villus'
import { createCachebay } from 'cachebay'
import { fetch as fetchPlugin } from 'villus'

export const cache = createCachebay({
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
import { createCachebay } from 'cachebay'

const cache = createCachebay({
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
import { createCachebay } from 'cachebay'
import { fetch as fetchPlugin, dedup as dedupPlugin } from 'villus'

export default defineNuxtPlugin((nuxtApp) => {
  const cache = createCachebay()

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

## Imperative Cache Access

### Queries

Direct cache operations for reading, writing, and watching query results without network requests.

```js
import { useCache } from 'cachebay'
const { readQuery, writeQuery, watchQuery } = useCache()

// Read from cache synchronously
const data = readQuery({ query: POSTS_QUERY, variables: { first: 10 } })

// Write to cache (triggers reactive updates)
writeQuery({ query: POSTS_QUERY, variables: { first: 10 }, data: { posts: { edges: [...] } } })

// Watch for cache changes (reactive)
const unsubscribe = watchQuery({
  query: POSTS_QUERY,
  variables: { first: 10 },
  onData: (data) => console.log('Cache updated:', data)
})
```

See **[Queries](./docs/QUERIES.md)** for detailed API documentation.

### Fragments

Reactive fragment system for reading and writing normalized entities. Returns Vue proxies that automatically update when underlying data changes, enabling granular cache management and optimistic updates.

```js
import { useCache } from 'cachebay'
const { identify, readFragment, writeFragment, watchFragment } = useCache()

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

// Watch for changes (reactive)
const unsubscribe = watchFragment({
  id: 'Post:42',
  fragment: `fragment PostFields on Post { id title }`,
  onData: (post) => console.log('Post updated:', post)
})
```

See **[Fragments](./docs/FRAGMENTS.md)** for the complete API (`identify`, `readFragment`, `writeFragment`, `watchFragment`) and examples.

---

## Optimistic updates (entities & connections)

Layered optimistic updates let you stage cache changes immediately while a request is in flight. You can patch/delete **entities** and edit **connections** (add/remove/patch) with zero array churn—then **finalize** with `commit(data?)` or **undo** with `revert()`.

```ts
const tx = cache.modifyOptimistic((o, ctx) => {
  // Entities
  o.patch('Post:999', { title: 'New (optimistic)' })
  o.delete('Post:999')

  // Connections
  const c = o.connection({ parent: 'Query', key: 'posts' })

  // Add (dedup by node key)
  c.addNode({ __typename: 'Post', id: '999', title: 'New' }, { position: 'start' })
  c.addNode({ __typename: 'Post', id: '100', title: 'Before 123' }, { position: 'before', anchor: 'Post:123' })
  c.addNode({ __typename: 'Post', id: '101', title: 'After 123'  }, { position: 'after',  anchor: { __typename: 'Post', id: '123' } })

  // Remove
  c.removeNode('Post:999')

  // Patch connection meta / pageInfo (shallow)
  c.patch(prev => ({ pageInfo: { ...prev.pageInfo, hasNextPage: false } }))
})

// Finalize this layer (optionally using server data, e.g. replace a temp id)
tx.commit({ id: '123' })

// Or undo this layer only:
tx.revert()
```

- `commit(data?)` **finalizes** the layer: your builder runs once in write-through mode with `{ phase: 'commit', data }`, and the layer is **dropped** (nothing left to replay).
- `revert()` undoes **only** that layer; other layers remain and continue to apply in order.
- Layers stack in insertion order.
- `addNode` de-dups by entity key and refreshes edge meta in place.
- `position`: `"start" | "end" | "before" | "after"` (for the latter two, provide an `anchor`).

See **[Optimistic updates](./docs/OPTIMISTIC_UPDATES.md)** for more details and patterns.
---

MIT © LockVoid Labs ~●~
