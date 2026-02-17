# Queries

**Querying data** with Cachebay.

* Core API: `executeQuery`, plus low‑level `readQuery` / `writeQuery` / `watchQuery`
* Vue: `useQuery` (from `cachebay/vue`)

---

## `executeQuery`

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

## Low‑level helpers

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

## Svelte

`createQuery` comes from **`cachebay/svelte`**. It integrates cache policies, watchers, and reactive getters.

**Basic usage**

```svelte
<script lang="ts">
  import { createQuery } from 'cachebay/svelte'

  const { data, error, isFetching, refetch } = createQuery({
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

    cachePolicy: 'cache-first',
  })
</script>

{#if isFetching}
  <p>Loading...</p>
{:else if error}
  <p>Error: {error.message}</p>
{:else}
  <h1>{data?.post?.title}</h1>
{/if}
```

**Reactive variables** (via getter functions)

Options that accept `MaybeGetter<T>` can be a plain value **or** a `() => T` getter. Svelte 5's `$effect` auto-tracks reads inside the getter, so the query re-executes when dependencies change.

```svelte
<script lang="ts">
  import { createQuery } from 'cachebay/svelte'

  let postId = $state('p1')

  const { data } = createQuery({
    query: `
      query ($id: ID!) {
        post(id:$id) {
          id
          title
        }
      }
    `,

    variables: () => ({
      id: postId,
    }),
  })
</script>

<button onclick={() => postId = 'p2'}>Load Post 2</button>
<pre>{JSON.stringify(data, null, 2)}</pre>
```

**Refetch** (defaults to `network-only`)

```ts
await refetch({ variables: { id: 'p2' } })
// or override
await refetch({ cachePolicy: 'cache-and-network' })
```

**Enabled**

```svelte
<script lang="ts">
  import { createQuery } from 'cachebay/svelte'

  let enabled = $state(false)

  const query = createQuery({
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

    enabled: () => enabled,
  })
</script>

<!-- Later: start the query -->
<button onclick={() => enabled = true}>Enable</button>
```

**Lazy**

```svelte
<script lang="ts">
  import { createQuery } from 'cachebay/svelte'

  const query = createQuery({
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
</script>

<!-- Fetch on demand -->
<button onclick={() => query.refetch()}>Load</button>
```

> Notes:
>
> * Return values are **plain objects with reactive getters** — no `$` prefix, no stores. Access `data`, `error`, `isFetching` directly in templates.
> * When `enabled` returns `false`, `refetch()` is a **no‑op**. Toggle `enabled` to `true` first.
> * `refetch()` merges provided variables into the last set (Apollo‑style).
> * `lazy: true` skips the initial query execution; use `refetch()` later to trigger it.
> * Cleanup (watcher unsubscription) is automatic via `onDestroy`.

---

## Pagination & variable changes

For cursor pagination and merge rules, see **Relay connections**. Changing variables re‑materializes watchers and (depending on policy) fetches fresh pages.

* Use `cache.executeQuery({ cachePolicy: 'cache-and-network', variables: { after } })` to revalidate while showing current items.
* The watcher’s `update({ variables })` coalesces emissions and updates dependency tracking.

Deep dive: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)

---


## Next steps

Continue to [FRAGMENTS.md](./FRAGMENTS.md) to learn about reading and watching partial entity data without full queries.

## See also

* **Fragments** — partial entity reads/writes: [FRAGMENTS.md](./FRAGMENTS.md)
* **Mutations** — write merging: [MUTATIONS.md](./MUTATIONS.md)
* **Subscriptions** — streaming & transport: [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)
* **Relay connections** — pagination & merge modes: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
* **Optimistic updates** — layering & helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
