
# Optimistic updates

Cachebay’s optimistic engine is **layered**. Each `modifyOptimistic(...)` call creates a layer that applies immediately. You can **commit** the layer (keep it) or **revert** only that layer later; Cachebay restores the base and **replays** remaining layers so state stays correct and deterministic.

Works for **entities** and **Relay connections** — no array churn; updates are microtask-batched.

---

## TL;DR

```ts
// Start a layer
const tx = cache.modifyOptimistic((o, { data }) => {
  // 1) Entity: patch fields (normalized by __typename:id)
  o.patch('Post:1', { title: 'Draft' }, { mode: 'merge' })

  // 2) Get the canonical connection
  const c = o.connection({ parent: 'Query', key: 'posts' })

  // 3) Prepend an optimistic node
  c.addNode({ __typename: 'Post', id: data.id ? data.id : 'temp:123456', title: 'Draft' }, { position: 'start' })

  // 4) Patch connection pageInfo/extras (shallow-merge)
  c.patch((prev) => ({ pageInfo: { ...prev.pageInfo, hasNextPage: false } }))
})

// Success:
tx.commit({ id: '123' }) // layer applied with server data & remembered

// Error:
tx.revert?.() // remove only this layer; remaining layers are replayed
```

---

## API surface

```ts
const tx = cache.modifyOptimistic(
  (o, ctx: { phase: 'optimistic' | 'commit'; data?: any }) => {
    // Entities
    o.patch(target, partialOrUpdater, { mode?: 'merge' | 'replace' })
    o.delete(target)

    // Connections
    const c = o.connection({
      parent: 'Query' | 'Type:id' | { __typename, id },
      key: string,
      filters?: Record<string, any>,
    })

    c.addNode(node, {
      position?: 'start' | 'end' | 'before' | 'after',
      anchor?: 'Type:id' | { __typename, id },
      edge?: Record<string, any>,
    })

    c.removeNode('Type:id' | { __typename, id })

    c.patch(partialOrUpdater)  // shallow-merge into connection; pageInfo merged field-by-field
  }
)

// Finalize this layer
tx.commit(data?)

// Undo this layer only
tx.revert()
```

### Builder context

- During the optimistic pass, your builder runs with `{ phase: 'optimistic' }`.
- On `commit(data?)`, the same builder runs **once** with `{ phase: 'commit', data }`, writes directly to the cache (no layer recorded), and the layer is then **dropped**.

>**Note:** `commit(data?)` **always** drops the layer. If you need the overlay to remain, don’t call `commit()`.

---

## Entities

### `o.patch(target, partialOrUpdater, { mode })`
- **Target**: `'Type:id'` or `{ __typename, id }`.
- **Mode**:
  - `'merge'` (default): shallow-merge fields into the existing snapshot.
  - `'replace'`: replace the snapshot with exactly the provided fields.
- You may pass a **function** to compute the patch from the **previous** entity snapshot.

### `o.delete(target)`
- Removes the entity snapshot (if present) and unlinks it from any connections that reference it.

**Examples**

```ts
// Merge/rename
cache.modifyOptimistic((o) => {
  o.patch('Post:42', { title: 'Renaming…' }, { mode: 'merge' })
}).commit?.()

// Replace entirely
cache.modifyOptimistic((o) => {
  o.patch('Post:42', { title: 'Fresh', tags: [] }, { mode: 'replace' })
}).commit?.()

// Delete
cache.modifyOptimistic((o) => {
  o.delete('Post:42')
}).commit?.()
```

---

## Connections

### 1) Get a connection handle

```ts
const c = o.connection({
  parent: 'Query' | 'Type:id' | { __typename, id },
  key: string,
  filters?: Record<string, any>,
})
```

### 2) Methods

#### `c.addNode(node, opts?)`
```ts
c.addNode(node, {
  position?: 'start' | 'end' | 'before' | 'after',
  anchor?: 'Type:id' | { __typename, id },
  edge?: Record<string, any>,
})
```

- De-dups by **entity key**; re-adding refreshes edge meta in place without reordering.
- Missing `anchor` falls back to **start** for `before` and **end** for `after`.

#### `c.removeNode(ref)`
```ts
c.removeNode('Type:id' | { __typename, id })
```

- Removes the first occurrence of that node from the canonical list (no effect on the underlying entity snapshot).

#### `c.patch(partialOrUpdater)`
```ts
// Updater
c.patch((prev) => ({
  pageInfo: { ...prev.pageInfo, hasNextPage: false },
  totalCount: (typeof prev.totalCount === 'number' ? prev.totalCount : 0) + 1,
}))

// Partial object
c.patch({ pageInfo: { hasNextPage: false }, totalCount: 10 })
```

- Shallow-merged into the connection object.
- If you include `pageInfo`, it’s merged **field-by-field** (existing fields preserved unless overridden).

**Examples**

**Temp → server ID (connection)**

```ts
const tx = cache.modifyOptimistic((o, ctx) => {
  const c = o.connection({ parent: 'Query', key: 'posts' })
  const id    = ctx.data?.id    ?? 'tmp:1'
  const title = ctx.data?.title ?? 'Creating…'

  c.addNode({ __typename: 'Post', id, title }, { position: 'start' })
})

// later, when the server returns the real id:
tx.commit({ id: '123', title: 'Created' })
```

**Finalize an entity snapshot**

```ts
  const tx = cache.modifyOptimistic((o, ctx) => {
    const id = ctx.data?.id ?? 'draft:42'

    o.patch({ __typename: 'Post', id }, { title: ctx.data?.title ?? 'Draft' })
  })

  tx.commit({ id: '42', title: 'Ready' })
```

---

## Layering semantics

Layers apply **in insertion order** and can be reverted individually:

- Rendered state = `base + L1 + L2 + …`
- Revert **L1** → rendered = `base + L2 + …`
- Revert **L2** → rendered = `base + L1 + …`

After a revert, Cachebay restores just the affected records and **replays** other layers, keeping the UI consistent.

**Timeline**

```
Base:                   [A]
L1: add B (start)     → [B*, A]
L2: patch A.title     → [B*, A'*]
revert(L1)            → [A'*]
revert(L2)            → [A]
```

`*` = optimistic.

---

## See also

- **Relay connections** — modes, de-dup, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Fragments** — `identify` / `readFragment` / `writeFragment`: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
- **SSR** — hydrate/dehydrate, first-mount CN behavior: [SSR.md](./SSR.md)
