# Composables

Cachebay ships a small set of Vue composables that sit on top of the normalized cache. They are available **after** you install Cachebay as a Vue plugin:

```ts
import { createApp } from 'vue'
import { createCachebay } from 'cachebay'

const app = createApp(App)

const cachebay = createCachebay()

app.use(cachebay) // <-- provides composables
app.mount('#app')
```

The key composables are:

- **`useCache()`** – low-level cache API (queries, fragments, optimistic)
- **`useFragment()`** – read one entity by key (reactive proxy)

> Fetching still uses Villus’ `useQuery()` / `useMutation()` — Cachebay covers the cache & normalization layer.

---

## `useCache()`

```ts
import { useCache } from 'cachebay'

const {
  // Query APIs
  readQuery,
  writeQuery,
  watchQuery,

  // Fragment APIs
  identify,
  readFragment,
  writeFragment,
  watchFragment,

  // Optimistic APIs
  modifyOptimistic,
} = useCache()
```

### Query APIs

**Read from cache**
```ts
import { useCache } from 'cachebay'

const { readQuery } = useCache()

const data = readQuery({
  query: POSTS_QUERY,
  variables: { first: 10 }
})
```

**Write to cache**
```ts
import { useCache } from 'cachebay'

const { writeQuery } = useCache()

writeQuery({
  query: POSTS_QUERY,
  variables: { first: 10 },
  data: { posts: { edges: [...], pageInfo: {...} } }
})
```

**Watch for changes**
```ts
import { useCache } from 'cachebay'

const { watchQuery } = useCache()

const { unsubscribe } = watchQuery({
  query: POSTS_QUERY,
  variables: { first: 10 },
  onData: (data) => {
    console.log('Cache updated:', data)
  }
})

// Clean up
onUnmounted(() => unsubscribe())
```

See **[QUERIES.md](./QUERIES.md)** for detailed documentation.

### Fragment APIs

**Identify**

```ts
import { useCache } from 'cachebay'

const { identify } = useCache()

identify({ __typename: 'User', id: 'u1' }) // → "User:u1"
```

**Read (reactive)**

```ts
import { useCache } from 'cachebay'

const { readFragment } = useCache()

const post = readFragment({ id: 'Post:42', fragment: PostFragment }) // Vue proxy that stays in sync
```

**Write**

```ts
import { useCache } from 'cachebay'

const { writeFragment } = useCache()

writeFragment({ id: 'Post:42', fragment: PostFragment, data: { title: 'Updated' } })
```

**Watch**

```ts
import { useCache } from 'cachebay'

const { watchFragment } = useCache()

const { unsubscribe } = watchFragment({
  id: 'Post:42',
  fragment: PostFragment,
  onData: (post) => console.log('Updated:', post.title)
})

// Clean up
onUnmounted(() => unsubscribe())
```

### Optimistic

```ts
import { useCache } from 'cachebay'

const { modifyOptimistic } = useCache()

const tx = modifyOptimistic((o) => {
  // Patch entity
  o.patch({ __typename: 'Post', id: '42', title: 'Draft…' }, 'merge')

  // Connection edits
  const c = o.connection({ parent: 'Query', key: 'posts' })

  c.addNode( { __typename: 'Post', id: 'tmp:1', title: 'Creating…' }, { position: 'start' })

  c.patch(prev => ({ pageInfo: { ...prev.pageInfo, hasNextPage: false } }))
})

// Success::
tx.commit?.()

// Error:
tx.revert?.()
```

See **[OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)** for the full API.

---

## `useFragment(source)`

Read a single entity by key (string or reactive key). Returns the **entity proxy directly**.

**Static key**

```ts
import { useFragment } from 'cachebay'

const post = useFragment({ id: 'Post:42', fragment: PostFragment }) // proxy; post.title stays in sync
```

**Dynamic key (ref/computed)**

```ts
import { useFragment } from 'cachebay'

const options = ref<string | null>({ id: 'Post:42', fragment: PostFragment })

const post = useFragment(options) // swaps automatically when options change
```

Use `writeFragment` to update fields rather than mutating proxies directly.

---

## Nuxt 4

With the plugin pattern from your Nuxt setup (installing Cachebay and Villus in a single plugin), these composables are available in any component once you `app.use(cachebay)`.

```vue
<script setup lang="ts">
import { useFragment, useCache } from 'cachebay'

const post = useFragment({ id: 'Post:42', fragment: PostFragment })

const { writeFragment } = useCache()

const handleRename = () => {
  writeFragment({ id:'Post42', fragment: PostFragment, data: { title:'New title' } })
}
</script>

<template>
  <article>
    <h1>{{ post?.title }}</h1>
    <button @click="handleRename">Rename</button>
  </article>
</template>
```

---

## See also

- **Fragments** — overview & usage patterns: [FRAGMENTS.md](./FRAGMENTS.md)
- **Relay connections** — directive, merge modes, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, entity ops, `addNode` / `removeNode` / `patch`: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
