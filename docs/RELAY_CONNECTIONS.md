# Relay connections — deep guide

Relay-style pagination in Cachebay gives you **stable, reactive lists** with:

- De-duplication by **entity key** (`__typename:id`)
- In-place updates of duplicate nodes (cursor / edge meta)
- Reactive **pageInfo** and connection **meta**
- **No array churn**: the view updates the *contents*, not the reference

This document covers: **how connection state is stored**, **merge modes** (append / prepend / replace), **policy behavior** (CF / CN), **limit sizing**, **patching pageInfo/meta**, SSR notes, and examples.

---

## Mental model

For every unique connection key (derived from `parent + field + variables` and your `relay()` options), Cachebay stores:

- `list: Array<{ key: EntityKey; cursor: string | null; edge?: Record<string, any> }>`
- `pageInfo: { ... }` *(reactive)*
- `meta: { ... }` *(reactive)* — any extra fields the server returns on the connection object
- `views: Set<View>` where **View** maps `list → edges[]` with a **limit** (how many items to show)

**Mode** decides *how* a page writes to `list`.
**Policy** decides *when* we publish cached vs fetch.
**Limit** decides *how much* of `list` the UI shows.

You opt-in at the resolver level:

```ts
const cache = createCache({
  resolvers: ({ relay }) => ({
    Query: {
      colors: relay(/* opts? */),
    },
  }),
})
```

---

## Modes

> You don’t set a “mode” directly on the API — it’s inferred by the **shape of the request** and `relay()` options. The three behaviors below explain what Cachebay does when a page lands.

### 1) append (next page)
- Adds **unique** entries to the **end** of the list.
- If a node is already present, it’s **updated in place** (cursor/meta shallow-merged).
- The view **limit increases** by the **page size**.

### 2) prepend (previous page)
- Adds **unique** entries to the **front** of the list.
- Duplicate nodes **update in place**.
- The view **limit increases** by the **page size**.

### 3) replace (one-page view)
- Clears previously visible window and keeps **only this page** visible.
- The view **limit** is set to **page size of the replacement**.

> Choose `append`/`prepend` for infinite lists, `replace` for strict page switches.
> The resolver infers intent by the presence of cursors like `after` / `before` (you can expose your own “hard replace” control via context if you need).

---

## Policy matrix (Cache policies)

### `cache-first` (CF)
- If cached → **publish cached** and **terminate** (no network).
- If not cached → wait for network and publish when it arrives.

### `cache-and-network` (CN)
- If cached → **publish cached immediately** and also **revalidate** via network.
- If not cached → fetch, then publish.

**SSR + first mount:** After `hydrate()`, Cachebay drops a one-time “ticket” per op-key so your first CN mount **renders cached without an immediate duplicate request**. After that, CN behaves normally (cached + revalidate). See **SSR.md**.

---

## Limits, pageInfo, and meta

- **Limit**: the latest view’s visible item count. With append/prepend pages, the limit **adds** the new page size; with replace, the limit is **exactly** the page size of that page.
- **pageInfo**: a reactive object on the connection (e.g., `endCursor`, `hasNextPage`), updated property-wise whenever a page lands.
- **meta**: any *non-edge* fields the server returns on the connection object are shallow-merged here (e.g. `totalCount`, `filters`, etc).

### Patching pageInfo / meta in optimistic flows

Use the connection handle’s **`patch(field, valueOrFn)`**:

- If `field` exists on `pageInfo`, patch **pageInfo[field]**
- Otherwise patch **meta[field]**
- `valueOrFn` can be a concrete value or updater `(prev) => next`

```ts
const tx = cache.modifyOptimistic(c => {
  const [conn] = c.connections({ parent:'Query', field:'colors' })
  // pageInfo patch
  conn.patch('hasNextPage', false)
  // meta patch (updater)
  conn.patch('totalCount', (n:number) => (typeof n === 'number' ? n : 0) + 3)
})
tx.commit?.()
```

---

## De-duplication & in-place updates

When a page lands, edges are de-duped by **entity key** (e.g., `'Color:1'`):

- If the node is new → insert (front or end, depending on mode)
- If the node already exists → **update its cursor** and edge meta **in place** (list order is preserved)

This guarantees stable lists without accidental duplication across pages.

---

## Concurrency & replay notes

- Cursor pages can be **replayed** onto the same connection safely (they merge incrementally).
- For non-cursor race handling (e.g., “take latest”), prefer a separate request-management plugin in your Villus chain (`dedup`, abort controllers, etc). Cachebay focuses on **cache and merge semantics**.

---

## SSR

On **dehydrate**, Cachebay serializes entities, connection state, and op-cache.
On **hydrate({ materialize:true })**, it **reconstructs views** and stitches hydrated result objects to live proxies, so fragments and connections are reactive immediately.

With **cache-and-network** at first client mount, hydrated connections **render from cache without a duplicate request**; from there on, CN behaves normally (cached + revalidate).

See **SSR.md** for details, variable cleaning rules, and Suspense notes.

---

## Examples

### Basic paging

```ts
import { useQuery } from 'villus'

// page 1
const { data } = useQuery({
  query: COLORS,
  variables: { first: 20 },                  // append baseline
  cachePolicy: 'cache-and-network',
})

// next page (append)
const end = computed(() => data.value?.colors?.pageInfo?.endCursor)
function loadMore() {
  useQuery({
    query: COLORS,
    variables: { first: 20, after: end.value },
    cachePolicy: 'cache-and-network',
  })
}
```

### Replace a page (strict window)

```ts
// some view explicitly wants a single “page window”
useQuery({
  query: COLORS,
  variables: { first: 20, after: someCursor /* plus a context switch if you expose it */ },
  cachePolicy: 'cache-first', // show cached page window if present; else wait for network
})
```

### Optimistic patches (pageInfo/meta)

```ts
const tx = cache.modifyOptimistic(c => {
  const [conn] = c.connections({ parent: 'Query', field: 'colors' })

  // optimistic removal from the list
  conn.removeNode({ __typename:'Color', id: 42 })

  // pretend the API decrements totalCount by a list of ids
  const ids = [42, 43]
  conn.patch('totalCount', (n:number) => (typeof n === 'number' ? n - ids.length : 0))

  // if you know the next page is not available optimistically
  conn.patch('hasNextPage', false)
})
tx.commit?.()
```

---

## Tips

- Return **`__typename` + `id`** (or `_id`) in nodes to ensure de-dup works.
- Keep your **dedup/fetch** plugins in the recommended order:
  `cachebay → dedup() → fetch()` or with a custom dedup: `dedup() → cachebay → fetch()`.
  (The key is: request-management first, cache second, transport last.)
- For strict “one window” pagination, use **`replace`** semantics in the resolver (or expose a per-query switch via context and check for it in a small wrapper).
- In tests, remember updates are **microtask-batched**; `await tick()` after a write to observe changes.

---

## See also

- **Optimistic updates** — layering, `patch` / `delete`, connection helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **SSR** — hydrate/dehydrate, first-mount CN behavior: [SSR.md](./SSR.md)
- **Fragments** — identify/read/write & interface keys: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
