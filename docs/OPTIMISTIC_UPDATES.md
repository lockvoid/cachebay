
# Optimistic updates

Cachebay’s optimistic engine is **layered**. Each `modifyOptimistic(...)` call creates a layer that applies immediately. You can **commit** the layer (keep it) or **revert** only that layer later; Cachebay restores the base and **replays** remaining layers so state stays correct and deterministic.

Works for **entities** and **Relay connections** — no array churn; updates are microtask-batched.

---

## TL;DR

```ts
// Start a layer
const tx = cache.modifyOptimistic((o) => {
  // 1) Entity: patch fields (normalized by __typename:id)
  o.patch('Post:999', { title: 'Draft' }, { mode: 'merge' })

  // 2) Get the canonical connection
  const c = o.connection({ parent: 'Query', key: 'posts' })

  // 3) Prepend an optimistic node
  c.addNode({ __typename: 'Post', id: '999', title: 'Draft' }, { position: 'start' })

  // 4) Patch connection pageInfo/extras (shallow-merge)
  c.patch((prev) => ({ pageInfo: { ...prev.pageInfo, hasNextPage: false } }))
})

// Success:
tx.commit?.() // layer applied & remembered

// Error:
tx.revert?.() // remove only this layer; remaining layers are replayed
```

---

## API surface

```ts
const tx = cache.modifyOptimistic((o) => {
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

  c.patch(partialOrUpdater) /
})

// later...
tx.commit?.()
tx.revert?.()
```

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

- Re-adding the same **node**  refreshes edge meta/cursor in place while preserving the order.
- If **anchor** isn’t found: `before` → **start**, `after` → **end**.

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

```ts
cache.modifyOptimistic((o) => {
  const c = o.connection({ parent: 'Query', key: 'posts' })

  // add at start
  c.addNode({ __typename: 'Post', id: '999', title: 'New (optimistic)' }, { position: 'start' })

  // patch pageInfo
  c.patch({ pageInfo: { hasNextPage: false } })

  // patch extras with an updater
  c.patch((prev) => ({ totalCount: (typeof prev.totalCount === 'number' ? prev.totalCount : 0) + 1 }))
}).commit?.()
```

---

## Layering semantics

Layers apply **in insertion order** and can be reverted individually:

- Rendered state = `base + L1 + L2 + …`
- Revert **L1** → rendered = `base + L2 + …`
- Revert **L2** → rendered = `base + L1 + …`

After a revert, Cachebay restores the base and **replays remaining layers**, keeping the UI consistent and deterministic.

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

## Patterns

**Create (optimistic) → server success**

```ts
const tx = cache.modifyOptimistic((o) => {
  o.patch('Post:tmp:1', { title: 'Creating…' }, { mode: 'merge' })

  const c = o.connection({ parent: 'Query', key: 'posts' })
  c.addNode({ __typename: 'Post', id: 'tmp:1', title: 'Creating…' }, { position: 'start' })
})

// Success:
tx.commit?.()

// When the server responds with the real ID:
cache.modifyOptimistic((o) => {
  o.patch('Post:1', { title: 'Created' }, { mode: 'merge' })
}).commit?.()
```

**Update (optimistic) → server failure**

```ts
const tx = cache.modifyOptimistic((o) => {
  o.patch('Post:123', { title: 'New title (optimistic)' }, { mode: 'merge' })
})

// Success:
tx.commit?.()

// Error:
tx.revert?.()
```

**Delete (optimistic) → server failure**

```ts
const tx = cache.modifyOptimistic((o) => {
  o.delete('Post:123')

  const c = o.connection({ parent: 'Query', key: 'posts' })
  c.removeNode('Post:123')
})

// Success:
tx.commit?.()

// Error:
tx.revert?.()
```

---

## See also

- **Relay connections** — modes, de-dup, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Fragments** — `identify` / `readFragment` / `writeFragment`: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
- **SSR** — hydrate/dehydrate, first-mount CN behavior: [SSR.md](./SSR.md)
