
# Optimistic updates

Cachebay’s optimistic engine is **layered**. Each `modifyOptimistic(...)` call creates a layer that applies immediately. You can **commit** the layer (keep it) or **revert** only that layer later; Cachebay restores the base and **replays** remaining layers so state stays correct and deterministic.

Works for **entities** and **Relay connections** — no array churn; updates are microtask-batched.

## TL;DR

```ts
import { gql } from 'graphql-tag'

const POST_FRAGMENT = gql`
  fragment PostFields on Post {
    id
    title
    comments @connection(key: "PostComments") {
      edges { node { id text } }
      pageInfo { hasNextPage }
    }
  }
`

// Start a layer
const tx = cachebay.modifyOptimistic((o, { data }) => {
  // 1) Entity: patch fields (normalized by __typename:id)
  o.patch('Post:1', { title: 'Draft' }, { mode: 'merge' })

  // 2) Get the canonical connection
  const c = o.connection({ parent: 'Query', key: 'posts' })

  // 3) Prepend an optimistic node with fragment (auto-initializes nested connections)
  c.addNode(
    { id: data?.id ?? 'temp:123456', title: 'Draft' },
    { 
      position: 'start',
      fragment: POST_FRAGMENT,
      fragmentName: 'PostFields'
    }
  )

  // 4) Patch connection pageInfo/extras (shallow-merge)
  c.patch((prev) => ({ pageInfo: { ...prev.pageInfo, hasNextPage: false } }))
})

// Success:
tx.commit({ id: '123' }) // layer applied with server data & remembered

// Error:
tx.revert?.() // remove only this layer; remaining layers are replayed
```

## API surface

```ts
const tx = cachebay.modifyOptimistic(
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
      fragment?: string | DocumentNode | CachePlan,
      fragmentName?: string,
      variables?: Record<string, any>,
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
cachebay.modifyOptimistic((o) => {
  o.patch('Post:42', { title: 'Renaming…' }, { mode: 'merge' })
}).commit?.()

// Replace entirely
cachebay.modifyOptimistic((o) => {
  o.patch('Post:42', { title: 'Fresh', tags: [] }, { mode: 'replace' })
}).commit?.()

// Delete
cachebay.modifyOptimistic((o) => {
  o.delete('Post:42')
}).commit?.()
```


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
  fragment?: string | DocumentNode | CachePlan,
  fragmentName?: string,
  variables?: Record<string, any>,
})
```

- De-dups by **entity key**; re-adding refreshes edge meta in place without reordering.
- Missing `anchor` falls back to **start** for `before` and **end** for `after`.
- **Fragment support**: Provide a `fragment` to auto-initialize nested `@connection` fields and ensure type consistency.
  - Nested connections are initialized with empty edges and pageInfo automatically.
  - Uses fragment's `__typename` if not provided in node data.
  - **Idempotent**: calling `addNode` multiple times with the same fragment won't reset existing nested connections.

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

## Helpers

Find canonical @connection keys for pages that match the filter. Pagination args are ignored; remaining args become connection. This lets you fan-out an optimistic add/remove across every matching connection without guessing filter shapes.

```ts
const keys = cachebay.inspect.getConnectionKeys({
  parent: 'Query', // optional
  key: 'posts', // optional (field name)
  // argsFn?: (rawArgs) => boolean // optional predicate on raw args
})
```

## Recipes

**Add Post (prepend into all Query.posts)**

```ts
async function createPost(cache, client, input) {
  // Build optimistic layer
  const tx = cachebay.modifyOptimistic((o, { data }) => {
    const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

    for (const key of keys) {
      const c = o.connection(key)

      // Use server-passed data in commit() if available later, or a temp node now
      const node = data ?? { __typename: 'Post', id: `tmp:${Math.random()}`, title: input.title }

      c.addNode(node, { position: 'start' })
    }
  })

  try {
    const result = await client.executeMutation({
      query: `
        mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            post {
              id
              title
            }
          }
        }
      `,

      variables: {
        input,
      },
    })

    // Promote layer using server payload
    tx.commit(result.data?.createPost?.post)

    return result
  } catch (e) {
    tx.revert();

    throw e;
  }
}
```

**Add Post with nested connections (using fragments)**

```ts
import { gql } from 'graphql-tag'

const POST_FRAGMENT = gql`
  fragment PostFields on Post {
    id
    title
    author {
      id
      name
    }
    comments @connection(key: "PostComments") {
      edges {
        node {
          id
          text
        }
      }
      pageInfo {
        hasNextPage
      }
    }
  }
`

async function createPost(cache, client, input) {
  const optimisticId = `tmp:${Date.now()}`

  const tx = cachebay.modifyOptimistic((o, { data }) => {
    const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

    for (const key of keys) {
      const c = o.connection(key)

      // Fragment auto-initializes nested connections (comments)
      c.addNode(
        {
          id: data?.id ?? optimisticId,
          title: data?.title ?? input.title,
          author: { id: 'me', name: 'Current User' },
        },
        {
          position: 'start',
          fragment: POST_FRAGMENT,
          fragmentName: 'PostFields',
        }
      )
    }
  })

  try {
    const result = await client.executeMutation({
      query: `
        mutation CreatePost($input: CreatePostInput!) {
          createPost(input: $input) {
            post {
              ...PostFields
            }
          }
        }
        ${POST_FRAGMENT}
      `,
      variables: { input },
    })

    tx.commit(result.data?.createPost?.post)
    return result
  } catch (e) {
    tx.revert()
    throw e
  }
}
```

**Delete Post (remove from all Query.posts)**

```ts
const DELETE_POST =

async function deletePost(cache, client, id) {
  const tx = cachebay.modifyOptimistic((o) => {
    const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

    for (const key of keys) {
      o.connection(key).removeNode(`Post:${id}`) // or: o.connection(key).removeNode({ __typename: 'Post', id })
    }
  })

  try {
    const result = await client.executeMutation({
      query: `
        mutation DeletePost($id: ID!) {
          deletePost(id: $id)
        }
      `,

      variables: {
        id,
      },
    })

    if (result.error) {
      throw result.error;
    }

    tx.commit()

    return result
  } catch (e) {
    tx.revert()
    throw e
  }
}
```

> Notes
>
> * Re-adding an existing node updates edge meta **in place** (no reordering).
> * `pageInfo` updates are merged **field-by-field**.
> * Edge creation is **O(1)** by using a monotonic edge index (no scans over `edges`).
> * `cursor` (if provided on `edge`) is treated as meta; Cachebay maintains a cursor→position index for stable inserts/removals.
> * **Fragment benefits**:
>   - **Type safety**: Fragment structure matches your queries exactly.
>   - **DRY**: Reuse the same fragment in queries and optimistic updates.
>   - **Auto-initialization**: Nested `@connection` fields are initialized automatically.
>   - **Consistency**: Variables ensure connection canonical keys match between optimistic and real data.
>   - **Idempotent**: Multiple `addNode` calls with the same fragment won't reset existing nested connections.

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

## Next steps

Continue to [SSR.md](./SSR.md) to learn about server-side rendering with dehydrate/hydrate and Suspense integration.

## See also

- **Queries** — read/write/watch + policies: [QUERIES.md](./QUERIES.md)
- **Mutations** — write merging & optimistic patterns: [MUTATIONS.md](./MUTATIONS.md)
- **Relay connections** — modes, de-dup, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **SSR** — hydrate/dehydrate, first-mount CN behavior: [SSR.md](./SSR.md)
