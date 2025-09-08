# Cache fragments

Cache fragments are the **ergonomic surface** for working with normalized entities:

- Compute an entity key (`__typename:id`) with **`identify`**
- Read a **materialized proxy** (reactive) or a **raw snapshot**
- Write/merge fields into the store with **`writeFragment`**
- List and inspect what’s in the cache

Fragments pair perfectly with **Relay connections** and **optimistic updates**.

> You can access the fragment API directly from the cache instance or via the Vue hook `useCache()` if you’ve `app.use(cache)`.

---

## Identify

```ts
// From the cache instance:
const key = (cache as any).identify({ __typename: 'Asset', id: 42 }) // → "Asset:42" | null

// Via the hook:
import { useCache } from 'villus-cachebay'
const { identify } = useCache()
identify({ __typename: 'User', _id: 'a1' }) // → "User:a1"
```

- Works with `id` or `_id`.
- If you configured `keys()` in `createCache()`, `identify` uses those per-type rules first.

---

## Read

### Materialized (reactive proxy)

```ts
const asset = (cache as any).readFragment('Asset:42') // reactive proxy
// OR
const { readFragment } = useCache()
const asset = readFragment('Asset:42')
```

A **materialized** entity is a Vue proxy that **tracks future changes**:
- Server results, optimistic edits, and fragment writes **update the same object**.
- Use in templates/composables for live UIs.

### Raw snapshot (non-reactive)

```ts
const raw = (cache as any).readFragment('Asset:42', false) // plain object copy
```

Raw reads are useful for one-off computations or equality checks. Mutating a raw object does **not** change the store—use `writeFragment` to update.

### Interfaces & `Node:*`

If you’ve configured interfaces in `createCache({ interfaces() { ... } })`, you can:
- List entities for an **interface** type via `listEntityKeys('Node')`.
- Read concrete implementors seamlessly: `readFragment('Node:1')` resolves to the concrete type (`Image:1`, `Video:1`, etc.) if present.

---

## Write

`writeFragment(obj)` merges or replaces fields for a **single entity**. It returns an object with `{ commit, revert }`.

```ts
// Merge fields into an entity (most common)
;(cache as any).writeFragment({ __typename: 'Asset', id: 42, name: 'Renamed' }).commit?.()

// Replace semantics (rare): use policy in your cache config or write low-level via optimistic engine
```

> The return shape matches the optimistic API so you can use `.revert?.()` in tests. For fragment writes, `commit()` is effectively a **no-op** (already applied), but calling it is fine for consistency.

### Typical mutation handler

```ts
// inside a component / composable after a mutation succeeds:
const { writeFragment } = useCache()

writeFragment({
  __typename: 'Asset',
  id: 42,
  name: 'Final name from server',
}).commit?.()
```

**Gotchas**
- You must include `__typename` and a resolvable `id` (or `_id` / custom key).
- Avoid writing nested objects unless they have resolvable keys too—prefer one entity per `writeFragment`. Nested lists belong to Relay connections.

---

## List & inspect

### Keys and entity lists

```ts
// keys for a concrete type
const keys = (cache as any).listEntityKeys('Asset')     // e.g. ["Asset:1","Asset:2"]

// materialized proxies
const proxies = (cache as any).listEntities('Asset')    // [proxy, proxy, ...]

// raw snapshots
const raws = (cache as any).listEntities('Asset', false)
```

### Debug snapshots

```ts
const key = 'Asset:42'
const snapshot = (cache as any).inspect.get(key)        // raw record
const all = (cache as any).inspect.entities()           // all keys
```

### Connections (for context)

```ts
// See the internal connection bucket(s) for a field
const buckets = (cache as any).inspect.connection('Query', 'assets')
// Each bucket: { edges: [{ key, cursor, edge? }...], pageInfo, meta, ... }
```

---

## Patterns

### “Upsert this one thing after mutation”

```ts
const { writeFragment } = useCache()
writeFragment({ __typename: 'User', id: 'me', name: 'You' }).commit?.()
```

### “Read-modify-write”

```ts
const user = (cache as any).readFragment('User:me') // proxy
;(cache as any).writeFragment({ __typename:'User', id:'me', name: user.name.toUpperCase() }).commit?.()
```

> You can also just edit `user.name` directly if it’s a materialized proxy, but prefer `writeFragment` to keep your intent explicit and avoid proxy pitfalls in tricky cases.

### “Interface fans”

```ts
// list all concrete implementors for Node
const nodeKeys = (cache as any).listEntityKeys('Node') // ["Image:1","Video:5",...]
const nodes = (cache as any).listEntities('Node')      // proxies
```

### “SSR: show hydrated fragments immediately”

Hydrate with `{ materialize: true }`:

```ts
(cache as any).hydrate(snapshot, { materialize: true })
// Now readFragment('Asset:42') returns a proxy wired to hydrated data.
// writeFragment will update the UI without waiting for revalidate.
```

---

## With the Vue hook

If you `app.use(cache)`, grab the API via `useCache()` anywhere in setup:

```ts
import { useCache } from 'villus-cachebay'

const { identify, readFragment, writeFragment, modifyOptimistic, inspect } = useCache()
```

- `modifyOptimistic` pairs nicely with fragments: apply optimistic patches first, then write the real server result or revert later.
- `inspect` helps debug what’s in the store during development.

---

## Tips & best practices

- Always include `__typename` and an **id** (or `_id`) for fragment writes.
- Use **materialized** reads (`readFragment(key)`) in templates; they keep your UI up to date.
- Use **raw** reads (`readFragment(key, false)`) for comparisons or logs.
- Don’t use fragments to maintain paginated **lists**—that’s what **Relay connections** are for.
- In tests, remember writes are **microtask-batched**; `await tick()` before asserting.

---

## See also

- **Relay connections** — merge modes, limits, policy matrix, and `patch(field, fn)`: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, `patch`/`delete`, and connection helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **SSR** — hydrate/dehydrate, first-mount CN behavior, Suspense notes: [SSR.md](./SSR.md)
