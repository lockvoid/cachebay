# Optimistic updates

Cachebay’s optimistic engine is **layered**: every call to `modifyOptimistic(...)` creates one layer that applies immediately. You can **commit** the layer (keep it) or **revert** just that layer later; the cache then **replays** the remaining layers from the base so state stays correct.

> Works for **entities** and **Relay connections**. No array churn, microtask-batched.

---

## TL;DR

```ts
// Start a layer
const tx = (cache as any).modifyOptimistic((c) => {
  // 1) Entity: patch fields (normalized by __typename:id)
  c.patch({ __typename: 'Asset', id: 999, name: 'Draft' }, 'merge')

  // 2) Connection: prepend the optimistic node
  const [conn] = c.connections({ parent: 'Query', field: 'assets' })
  conn.addNode(
    { __typename: 'Asset', id: 999, name: 'Draft' },
    { cursor: 'client:999', position: 'start' }
  )

  // 3) Patch connection pageInfo / meta (in-place)
  conn.patch('hasNextPage', false)
  conn.patch('totalCount', (n:number) => (typeof n === 'number' ? n : 0) + 1)
})

tx.commit?.()   // layer applied & remembered

// Later if a mutation fails:
tx.revert?.()   // remove only this layer; remaining layers are replayed
```

---

## API surface

```ts
const tx = cache.modifyOptimistic((c) => {
  // Entities
  c.patch(entity, policy?)              // entity = { __typename, id/_id, ... }, policy: 'merge' | 'replace'
  c.delete('Type:id')                   // remove entity snapshot + unlink from connections

  // Relay connections
  const [conn] = c.connections({
    parent: 'Query' | { __typename:string; id?:any; _id?:any } | string,
    field:  string,
    variables?: Record<string, any>,
  })

  conn.addNode(node, {
    cursor?: string | null,
    position?: 'start' | 'end',         // default 'end'
    edge?: Record<string, any>,         // shallow-merged edge meta
  })

  conn.removeNode({ __typename:string; id?:any; _id?:any })

  // NEW: generic patch
  // If 'field' exists on pageInfo, patch pageInfo[field]; otherwise state.meta[field].
  // valueOrFn: concrete value or (prev) => next
  conn.patch(field:string, valueOrFn:any)
})

tx.commit?.()
tx.revert?.()
```

---

## Entities

### `patch(entity, policy?: 'merge' | 'replace')`
- Writes an entity snapshot into the normalized store using `__typename` + `id` (or `_id`) or the key from your `keys()` config.
- `merge` (default): shallow-merge fields into existing snapshot.
- `replace`: replace snapshot with exactly the given fields.

### `delete('Type:id')`
- Removes the entity snapshot if present.
- Unlinks the entity from any connections referencing it.

**Examples**

```ts
// rename (merge)
const tx1 = cache.modifyOptimistic(c => {
  c.patch({ __typename: 'Asset', id: 42, name: 'Renaming…' }, 'merge')
})
tx1.commit?.()

// delete
const tx2 = cache.modifyOptimistic(c => {
  c.delete('Asset:42')
})
tx2.commit?.()
```

---

## Relay connections

Use `connections({ parent, field, variables? })` to obtain a handle for one specific connection key (based on parent + field + variables + your `relay()` options).

### `addNode(node, { cursor?, position?, edge? })`
- Upsert by **entity key** (`__typename:id`) — no duplicates.
- `position` default is `'end'`; `'start'` prepends.
- `edge` shallow-merges to edge meta on the list entry.

### `removeNode(ref)`
- Removes a single entry referenced by `{ __typename, id?/_id? }`.

### `patch(field, valueOrFn)`
- If `field` exists on **pageInfo**, patches `pageInfo[field]`.
- Else patches connection **meta** (`state.meta[field]`).
- `valueOrFn` may be a value or `(prev) => next`.

**Examples**

```ts
const tx = cache.modifyOptimistic(c => {
  const [conn] = c.connections({ parent: 'Query', field: 'assets' })

  // add at start
  conn.addNode({ __typename:'Asset', id: 999, name:'New (optimistic)' }, { position:'start', cursor:null })

  // patch pageInfo
  conn.patch('hasNextPage', false)

  // patch meta with updater
  conn.patch('totalCount', (n:number) => (typeof n === 'number' ? n : 0) + 1)
})
tx.commit?.()
```

> Need to decrement by an input list length?
> `conn.patch('totalCount', (n:number) => (typeof n === 'number' ? n - variables.input.ids.length : 0))`

---

## Layering semantics

Layers are applied **in order** and can be reverted individually:

- Rendered state = `base + L1 + L2 + …`
- `revert(L1)` → render = `base + L2 + …`
- `revert(L2)` → render = `base + L1 + …`

> Later layers win while present. After a revert, Cachebay restores the base and **replays remaining layers** so your UI stays consistent.

**Timeline example**

```
Base:    [A]
L1: add B (start)      → [B*, A]
L2: patch A.name       → [B*, A' *]
revert(L1)             → [A'*]
revert(L2)             → [A]
```

`*` = optimistic state.

---

## Error handling

- On **success**, write the server result (`identify` + `writeFragment` or `patch` again). This replaces the optimistic placeholders if they represent the same entity keys.
- On **failure**, call `tx.revert?.()` for the failed layer. Other layers remain and are replayed in order.

---

## Tips

- **Entity keys**: ensure your objects have `__typename` + `id` (or `_id`), or define `keys()` per type in `createCache()`.
- **Dedup rule**: `addNode(...)` dedups by entity key; re-adding updates cursor/meta in place and preserves order.
- **View limits**: append/prepend increase the connection’s **view limit** by the page size; `replace` mode shows only the current page window (see Relay docs).
- **Microtask batching**: optimistic effects are batched; in tests, `await tick()` after writes to observe UI updates.
- **Combine with mutations**: do optimistic writes first; when the mutation resolves, apply the official server snapshot (or revert on error).

---

## Patterns

**Create (optimistic) → server success**
```ts
const tx = cache.modifyOptimistic(c => {
  c.patch({ __typename:'Asset', id:'tmp:1', name:'Creating…' }, 'merge')
  const [conn] = c.connections({ parent:'Query', field:'assets' })
  conn.addNode({ __typename:'Asset', id:'tmp:1', name:'Creating…' }, { position:'start' })
})
tx.commit?.()

// server response replaces 'tmp:1'
;(cache as any).patch({ __typename:'Asset', id:123, name:'Created' }, 'merge')
```

**Update (optimistic) → server failure**
```ts
const tx = cache.modifyOptimistic(c => {
  c.patch({ __typename:'Asset', id: 123, name:'New name (optimistic)' }, 'merge')
})
tx.commit?.()
// failure:
tx.revert?.()
```

**Delete (optimistic) → server failure**
```ts
const tx = cache.modifyOptimistic(c => {
  c.delete('Asset:123')
  const [conn] = c.connections({ parent:'Query', field:'assets' })
  conn.removeNode({ __typename:'Asset', id:123 })
})
tx.commit?.()
// failure:
tx.revert?.()
```

---

## See also

- **Relay connections** — modes, dedup, view limits, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Fragments** — identify/read/write & interface keys: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
- **SSR** — hydrate/dehydrate, CN first-mount behavior: [SSR.md](./SSR.md)
