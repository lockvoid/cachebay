# Composables

Cachebay ships a small set of Vue composables that sit on top of the normalized cache. They are available **after** you install Cachebay as a Vue plugin:

```ts
import { createApp } from 'vue'
import { createCachebay } from 'villus-cachebay'

const app = createApp(App)

const cachebay = createCachebay()

app.use(cachebay) // <-- provides composables
app.mount('#app')
```

The key composables are:

- **`useCache()`** – low-level cache API (identify / read / write / optimistic)
- **`useFragment()`** – read one entity by key (reactive proxy)

> Fetching still uses Villus’ `useQuery()` / `useMutation()` — Cachebay covers the cache & normalization layer.

---

## `useCache()`

```ts
import { useCache } from 'villus-cachebay'

const {
  identify,
  readFragment,
  writeFragment,
  modifyOptimistic,
} = useCache()
```

### Identify

```ts
import { useCache } from 'villus-cachebay'

const { identify } = useCache()

identify({ __typename: 'User', id: 'u1' }) // → "User:u1"
```

### Read (reactive)

```ts
import { useCache } from 'villus-cachebay'

const { readFragment } = useCache()

const post = readFragment('Post:42') // Vue proxy that stays in sync
```

### Write

```ts
import { useCache } from 'villus-cachebay'

const { writeFragment } = useCache()

writeFragment({ __typename: 'User', id: 'u1', name: 'Updated' })
```

### Optimistic

```ts
import { useCache } from 'villus-cachebay'

const { modifyOptimistic } = useCache()

const tx = modifyOptimistic((o) => {
  // Patch entity
  o.patch({ __typename: 'Post', id: '42', title: 'Draft…' }, 'merge')

  // Connection edits
  const c = o.connection({ parent: 'Query', key: 'posts' })

  c.addNode(
    { __typename: 'Post', id: 'tmp:1', title: 'Creating…' },
    { position: 'start' },
  )

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
import { useFragment } from 'villus-cachebay'

const post = useFragment('Post:42') // proxy; post.title stays in sync
```

**Dynamic key (ref/computed)**

```ts
import { useFragment } from 'villus-cachebay'

const keyRef = ref<string | null>('Post:42')

const currentKey = useFragment(keyRef) // swaps automatically when key changes
```

Use `writeFragment` to update fields rather than mutating proxies directly.

---

## Nuxt 4

With the plugin pattern from your Nuxt setup (installing Cachebay and Villus in a single plugin), these composables are available in any component once you `app.use(cachebay)`.

```vue
<script setup lang="ts">
import { useFragment, useCache } from 'villus-cachebay'

const post = useFragment('Post:42')

const { writeFragment } = useCache()

const handleRename = () => {
  writeFragment({ __typename:'Post', id:'42', title:'New title' })
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
