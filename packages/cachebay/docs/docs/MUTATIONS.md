# Mutations

**Writing data** with Cachebay.

* Core API: `executeMutation`
* Vue: `useMutation` (from `cachebay/vue`)

---

## `executeMutation`

Sends a write to the server and merges the result into the normalized cachebay.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`
* `onData?: (data) => void`
* `onError?: (error: CombinedError) => void`

**Returns**

`Promise<OperationResult<TData>>`

```ts
interface OperationResult<TData = any> {
  data: TData | null;
  error: CombinedError | null;
}
```

**Example**

```ts
const { data, error } = await cachebay.executeMutation({
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
    input: { id: 'p1', title: 'New post' },
  },
});
```

> Notes
>
> * Partial responses are written too (even if `error` exists) — useful fields are kept.
> * Watchers (`watchQuery`/`useQuery`) update automatically based on dependency tracking.

---

## Optimistic at a glance

Render changes **immediately** before the server responds using a **layered** optimistic transaction. When the network result arrives, Cachebay merges and stabilizes identities.

Use `modifyOptimistic` — it understands entities and Relay connections and avoids manual edge churn.

**Minimal example (entity patch)**

```ts
const { execute } = useMutation(
  query: `
    mutation UpdatePost($input: UpdatePostInput!) {
      updatePost(input: $input) {
        post {
          id
          title
        }
      }
    }
  `,
)

// 1) Start optimistic layer
const tx = cachebay.modifyOptimistic((o) => {
  o.patch('Post:p1', { title: 'Draft…' }, { mode: 'merge' })
})

// 2) Send network write and finalize
try {
  const result = await cachebay.executeMutation({
    query: `
      mutation UpdatePost($input: UpdatePostInput!) {
        updatePost(input: $input) {
          post {
            id
            title
          }
        }
      }
    `,

    variables: {
      input: { id: 'p1', title: 'Real Title' },
    }
  })

  tx.commit(result.data?.updatePost?.post)
} catch (e) {
  tx.revert();

  throw e
}
```

See **[OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)** for layering semantics and rollback patterns.

---

## Vue

### `useMutation`

A lightweight wrapper that exposes reactive state and an `execute` function.

**Returns**

* `data: Ref<TData | null>`
* `error: Ref<Error | null>`
* `isFetching: Ref<boolean>`
* `execute(variables?): Promise<OperationResult<TData>>`

**Basic usage**

```vue
<script setup lang="ts">
import { useMutation } from 'cachebay/vue'

const { data, error, isFetching, execute } = useMutation(
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
)

await execute({
  input: { id: 'p1', title: 'New post' },
})
</script>
```

---

### Pattern: optimistic **add**

```ts
import { useMutation, useCachebay } from 'cachebay/vue'

export const useCreatePost = () => {
  const cachebay = useCachebay()

  const createPost = useMutation(
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
  )

  const execute = async (variables: { input: { id?: string; title: string } }) => {
    const tx = cachebay.modifyOptimistic((o, { data }) => {
      const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

      for (const key of keys) {
        const c = o.connection(key)

        if (data?.post) {
          c.addNode(data.post, { position: 'start' })
        } else {
          c.addNode({ __typename: 'Post', id: variables.input.id ?? `tmp:${Date.now()}`, title: variables.input.title })
        }
      }
    })

    try {
      const result = await createPost.execute({ input: variables.input })

      tx?.commit(result.data?.createPost?.post)

      return result
    } catch (error) {
      tx?.revert()
      throw error
    }
  }

  return { ...createPost, execute }
}
```

### Pattern: optimistic **remove**

```ts
export const useDeletePost = () => {
  const cachebay = useCachebay()

  const deletePost = useMutation({
    query:`
      mutation DeletePost($input: DeletePostInput!) {
        deletePost(input: $input)
      }
    `,
  })

  const execute = async (variables: { input: { id: string } }) => {
    const tx = cachebay.modifyOptimistic((o) => {
      // Remove from all matching connections
      const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

      for (const key of keys) {
        o.connection(key).removeNode(`Post:${variables.input.id}`)
      }
    })

    try {
      const result = await deletePost.execute({ input: variables.input })

      tx?.commit()

      return result;
    } catch (error) {
      tx?.revert()

      throw error;
    }
  }

  return { ...deletePost, execute }
}
```

### Pattern: optimistic **patch** (entity-only, using `modifyOptimistic`)

```ts
export const useUpdatePost = () => {
  const cachebay = useCachebay()

  const updatePost = useMutation(`
    mutation UpdatePost($input: UpdatePostInput!) {
      updatePost(input: $input) {
        post {
          id
          title
        }
      }
    }
  `)

  const execute = async (variables: { input: { id: string; title?: string } }) => {
    const tx = cachebay.modifyOptimistic((o, { data }) => {
      const id = `Post:${variables.input.id}`

      if (data?.post) {
        // Commit phase: merge server payload
        o.patch(id, data.post);
      } else {
        // Optimistic phase: merge what we know from variables
        o.patch(id, variables.input),
        )
      }
    })

    try {
      const result = await updatePost.execute({ input: variables.input })

      tx?.commit(result.data?.updatePost?.post)

      return result
    } catch (error) {
      tx?.revert()

      throw error
    }
  }

  return { ...updatePost, execute }
}
```

---

## Svelte

### `createMutation`

A lightweight wrapper that exposes reactive state and an `execute` function. Import from **`cachebay/svelte`**.

**Returns**

* `readonly data: TData | null`
* `readonly error: Error | null`
* `readonly isFetching: boolean`
* `execute(variables?): Promise<OperationResult<TData>>`

**Basic usage**

```svelte
<script lang="ts">
  import { createMutation } from 'cachebay/svelte'

  const { data, error, isFetching, execute } = createMutation({
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
  })

  const handleCreate = async () => {
    await execute({
      input: { id: 'p1', title: 'New post' },
    })
  }
</script>

<button onclick={handleCreate} disabled={isFetching}>
  {isFetching ? 'Creating...' : 'Create Post'}
</button>
```

---

### Pattern: optimistic **add**

```ts
import { createMutation, getCachebay } from 'cachebay/svelte'

export const useCreatePost = () => {
  const cachebay = getCachebay()

  const createPost = createMutation({
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
  })

  const execute = async (variables: { input: { id?: string; title: string } }) => {
    const tx = cachebay.modifyOptimistic((o, { data }) => {
      const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

      for (const key of keys) {
        const c = o.connection(key)

        if (data?.post) {
          c.addNode(data.post, { position: 'start' })
        } else {
          c.addNode({ __typename: 'Post', id: variables.input.id ?? `tmp:${Date.now()}`, title: variables.input.title })
        }
      }
    })

    try {
      const result = await createPost.execute({ input: variables.input })

      tx?.commit(result.data?.createPost?.post)

      return result
    } catch (error) {
      tx?.revert()
      throw error
    }
  }

  return { ...createPost, execute }
}
```

### Pattern: optimistic **remove**

```ts
export const useDeletePost = () => {
  const cachebay = getCachebay()

  const deletePost = createMutation({
    query: `
      mutation DeletePost($input: DeletePostInput!) {
        deletePost(input: $input)
      }
    `,
  })

  const execute = async (variables: { input: { id: string } }) => {
    const tx = cachebay.modifyOptimistic((o) => {
      const keys = cachebay.inspect.getConnectionKeys({ parent: 'Query', key: 'posts' })

      for (const key of keys) {
        o.connection(key).removeNode(`Post:${variables.input.id}`)
      }
    })

    try {
      const result = await deletePost.execute({ input: variables.input })

      tx?.commit()

      return result
    } catch (error) {
      tx?.revert()
      throw error
    }
  }

  return { ...deletePost, execute }
}
```

### Pattern: optimistic **patch** (entity-only, using `modifyOptimistic`)

```ts
export const useUpdatePost = () => {
  const cachebay = getCachebay()

  const updatePost = createMutation({
    query: `
      mutation UpdatePost($input: UpdatePostInput!) {
        updatePost(input: $input) {
          post {
            id
            title
          }
        }
      }
    `,
  })

  const execute = async (variables: { input: { id: string; title?: string } }) => {
    const tx = cachebay.modifyOptimistic((o, { data }) => {
      const id = `Post:${variables.input.id}`

      if (data?.post) {
        o.patch(id, data.post)
      } else {
        o.patch(id, variables.input)
      }
    })

    try {
      const result = await updatePost.execute({ input: variables.input })

      tx?.commit(result.data?.updatePost?.post)

      return result
    } catch (error) {
      tx?.revert()
      throw error
    }
  }

  return { ...updatePost, execute }
}
```

> Notes:
>
> * `createMutation` is purely imperative — no reactive options, no `$effect`. Call `execute()` when needed.
> * Optimistic patterns are identical to the Vue adapter — the `modifyOptimistic` API is framework-agnostic.
> * Helper functions (e.g., `useCreatePost`) must be called inside a component context (they call `getCachebay()` internally).

## Next steps

Continue to [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md) to learn about streaming real-time updates via WebSocket or SSE transports.

## See also

* **Queries** — read/write/watch + policies: [QUERIES.md](./QUERIES.md)
* **Subscriptions** — transport & streaming: [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)
* **Optimistic updates** — layering & helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
* **Relay connections** — pagination & merge modes: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
