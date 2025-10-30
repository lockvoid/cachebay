# Queries

**Querying data** with Cachebay, both agnostic APIs and Vue bindings.

* Agnostic API: `executeQuery`, plus low‑level `readQuery` / `writeQuery` / `watchQuery`
* Vue: `useQuery` (from `cachebay/vue`)

---

## `executeQuery` (agnostic)

High‑level query that respects cache policies and normalizes results.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`
* `cachePolicy?: 'cache-first' | 'network-only' | 'cache-only' | 'cache-and-network'`
* `onCacheData?: (data, meta: { willFetchFromNetwork: boolean }) => void`
* `onNetworkData?: (data) => void`
* `onError?: (error: CombinedError) => void`

**Returns**

`Promise<OperationResult<TData>>`

```ts
interface OperationResult<TData = any> {
  data: TData | null;
  error: CombinedError | null;
  meta?: { source?: 'cache' | 'network' };
}
```

**Example** (revalidate)

```ts
const { data, error, meta } = await cache.executeQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },

  cachePolicy: 'cache-and-network',
});
// meta?.source: 'cache' | 'network'
```

---

## Low‑level helpers (agnostic)

Use these when you need **manual control** over cache reads/writes and real‑time updates.

### `readQuery`

Materializes from cache only.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`

**Returns**

`T | null`

**Example**

```ts
const post = cache.readQuery<{ post: { id: string; title: string } }>({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },
});
```

### `writeQuery`

Writes raw data into the cache using a query shape.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`
* `data: any`

**Returns**

`void`

**Example**

```ts
cache.writeQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },

  data: {
    post: { __typename: 'Post', id: 'p1', title: 'Hello' },
  },
});
```

### `watchQuery`

Watches a query and pushes updates when dependent records change. Effectively recycles views for rendering performance.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`
* `onData: (data: any) => void`
* `onError?: (error: Error) => void`
* `immediate?: boolean` (default: `true`)

**Returns**

`{ unsubscribe(): void; update({ variables?, immediate? }): void }`

**Example**

```ts
const watcher = cache.watchQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },

  onData: (data) => {
    console.log(data);
  },

  onError: (error) => {
    console.error(error);
  },
});

// Later: change variables (emits according to cache state)
watcher.update({ variables: { id: 'p2' }, immediate: true });

// Cleanup
watcher.unsubscribe();
```

---

## Vue

`useQuery` comes from **`cachebay/vue`**. It integrates cache policies, watchers, and Suspense.

**Basic usage**

```vue
<script setup lang="ts">
import { useQuery } from 'cachebay/vue'

const { data, error, isFetching, refetch } = useQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },

  cachePolicy: 'cache-first', // reactive allowed
})
</script>
```

**With Suspense**

```vue
<script setup lang="ts">
import { useQuery } from 'cachebay/vue'

const { data, error, isFetching, refetch } = await useQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },
})
</script>
```

**Refetch** (defaults to `network-only`)

```ts
await refetch({ variables: { id: 'p2' } })
// or override
await refetch({ cachePolicy: 'cache-and-network' })
```

**Enabled**

```ts
import { ref } from 'vue'
import { useQuery } from 'cachebay/vue'

const enabled = ref(false)

const query = useQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },

  enabled,
})

// Later: start the query (creates watcher and runs it unless `lazy: true`)
enabled.value = true
```

**Lazy**

```ts
import { useQuery } from 'cachebay/vue'

const query = useQuery({
  query: `
    query ($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },

  lazy: true,
})

// Later: fetch on demand
await query.refetch()
```

> Notes:
>
> * When `enabled: false`, `refetch()` is a **no‑op**. Toggle `enabled` to `true` first.
> * `refetch()` merges provided variables into the last set (Apollo‑style).
> * Policy/watchers interplay is handled internally via `watchQuery` and `executeQuery`.
> * `lazy: true` is **incompatible** with Suspense (throws by design).

---

## Pagination & variable changes

For cursor pagination and merge rules, see **Relay connections**. Changing variables re‑materializes watchers and (depending on policy) fetches fresh pages.

* Use `cache.executeQuery({ cachePolicy: 'cache-and-network', variables: { after } })` to revalidate while showing current items.
* The watcher’s `update({ variables })` coalesces emissions and updates dependency tracking.

Deep dive: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)

---


## Next steps

Continue to `MUTATIONS.md` to learn about write network data and optimistic updates.

## See also

* **Mutations** — write merging: [MUTATIONS.md](./MUTATIONS.md)
* **Subscriptions** — streaming & transport: [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)
* **Relay connections** — pagination & merge modes: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
* **Optimistic updates** — layering & helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
