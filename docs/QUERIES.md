# Queries

Imperative cache API for reading, writing, and watching query results without network requests. These APIs provide direct access to the normalized cache, enabling manual cache updates, optimistic UI patterns, and reactive subscriptions.

- Read query results with **`readQuery`** (synchronous cache read)
- Write query results with **`writeQuery`** (triggers reactive updates)
- Watch for changes with **`watchQuery`** (reactive subscriptions)
- Pairs cleanly with **Relay connections** and **optimistic updates**

---

## Read Query

Reads a query result from the cache synchronously. Returns the cached data if available, or `undefined` if not found or incomplete. Does not trigger network requests.

**Options:**
- `query` - GraphQL query string or DocumentNode
- `variables` - Query variables (optional)
- `decisionMode` - `'canonical'` (default) or `'strict'` for connection handling

**Imperative**
```ts
const data = cachebay.readQuery({
  query: POSTS_QUERY,
  variables: { first: 10, after: null }
})

if (data) {
  console.log('Posts from cache:', data.posts.edges)
}
```

**Composable**
```ts
import { useCache } from 'cachebay'
const { readQuery } = useCache()

const data = readQuery({
  query: `
    query Posts($first: Int!) {
      posts(first: $first) @connection {
        edges {
          node { id title }
        }
        pageInfo {
          endCursor
          hasNextPage
        }
      }
    }
  `,
  variables: { first: 20 }
})
```

**Returns:** Query data object or `undefined` if not in cache

---

## Write Query

Writes a query result into the cache immediately. Normalizes the data, updates entities, and triggers reactivity for any components reading this query or related entities. Commonly used for optimistic updates and manual cache management.

**Options:**
- `query` - GraphQL query string or DocumentNode
- `variables` - Query variables (optional)
- `data` - The data object to write to the cache

**Imperative**
```ts
cachebay.writeQuery({
  query: POSTS_QUERY,
  variables: { first: 10 },
  data: {
    posts: {
      __typename: 'PostConnection',
      edges: [
        {
          __typename: 'PostEdge',
          cursor: 'cursor1',
          node: {
            __typename: 'Post',
            id: '1',
            title: 'New Post'
          }
        }
      ],
      pageInfo: {
        __typename: 'PageInfo',
        endCursor: 'cursor1',
        hasNextPage: false
      }
    }
  }
})
```

**Composable**
```ts
import { useCache } from 'cachebay'
const { writeQuery } = useCache()

// After a mutation, update the cache manually
const handleCreatePost = async (newPost) => {
  // Optimistically update cache
  writeQuery({
    query: POSTS_QUERY,
    variables: { first: 10 },
    data: {
      posts: {
        edges: [
          { node: newPost, cursor: newPost.id },
          ...existingEdges
        ],
        pageInfo: existingPageInfo
      }
    }
  })

  // Then make the actual mutation
  await createPost(newPost)
}
```

**Note:** `writeQuery` normalizes the data and updates all related entities. Any components reading these entities will automatically re-render.

---

## Watch Query

Subscribes to changes for a specific query in the cachebay. Returns an unsubscribe function. The callback is invoked whenever the query result changes through network responses, mutations, optimistic updates, or manual cache writes.

**Options:**
- `query` - GraphQL query string or DocumentNode
- `variables` - Query variables (optional)
- `decisionMode` - `'canonical'` (default) or `'strict'` for connection handling
- `onData` - Callback invoked with updated query data
- `onError` - Callback invoked on errors (optional)
- `skipInitialEmit` - Skip calling `onData` immediately (default: false)

**Imperative**
```ts
const { unsubscribe } = cachebay.watchQuery({
  query: POSTS_QUERY,
  variables: { first: 10 },
  onData: (data) => {
    console.log('Posts updated:', data.posts.edges.length)
  },
  onError: (error) => {
    console.error('Query error:', error)
  }
})

// Later: stop watching
unsubscribe()
```

**Composable**
```ts
import { useCache } from 'cachebay'
import { onUnmounted } from 'vue'

const { watchQuery } = useCache()

const { unsubscribe } = watchQuery({
  query: `
    query UserProfile($id: ID!) {
      user(id: $id) {
        id
        name
        email
        posts @connection {
          edges {
            node { id title }
          }
        }
      }
    }
  `,
  variables: { id: 'user123' },
  onData: (data) => {
    console.log('User profile updated:', data.user.name)
  }
})

// Clean up when component unmounts
onUnmounted(() => unsubscribe())
```

**Use Cases:**
- React to cache changes from other parts of the app
- Sync UI with optimistic updates
- Build custom reactive patterns
- Debug cache behavior

---

## Decision Modes

Both `readQuery` and `watchQuery` support two decision modes for handling Relay connections:

### Canonical Mode (default)

Returns the **merged view** of all pages loaded so far for a connection. Best for infinite scroll and pagination UIs.

```ts
const data = readQuery({
  query: POSTS_QUERY,
  variables: { first: 10, after: 'cursor10' },
  decisionMode: 'canonical' // default
})

// Returns ALL edges loaded so far (page 1 + page 2 + ...)
```

### Strict Mode

Returns **only the specific page** requested by the variables. Best for testing or when you need exact page boundaries.

```ts
const data = readQuery({
  query: POSTS_QUERY,
  variables: { first: 10, after: 'cursor10' },
  decisionMode: 'strict'
})

// Returns ONLY the edges for this specific page
```

---

## Patterns

### Optimistic UI with writeQuery

```ts
import { useCache } from 'cachebay'
import { useMutation } from 'villus'

const { writeQuery, readQuery } = useCache()
const { execute: createPost } = useMutation(CREATE_POST_MUTATION)

const handleCreate = async (title: string) => {
  const tempId = `temp:${Date.now()}`

  // 1. Optimistically update cache
  const existing = readQuery({ query: POSTS_QUERY, variables: { first: 10 } })
  writeQuery({
    query: POSTS_QUERY,
    variables: { first: 10 },
    data: {
      posts: {
        edges: [
          { node: { __typename: 'Post', id: tempId, title }, cursor: tempId },
          ...existing.posts.edges
        ],
        pageInfo: existing.posts.pageInfo
      }
    }
  })

  // 2. Make the actual mutation
  const { data } = await createPost({ title })

  // 3. Update with real ID (optional - network response will update cache)
  if (data) {
    writeQuery({
      query: POSTS_QUERY,
      variables: { first: 10 },
      data: {
        posts: {
          edges: [
            { node: data.createPost, cursor: data.createPost.id },
            ...existing.posts.edges.slice(1) // Remove temp
          ],
          pageInfo: existing.posts.pageInfo
        }
      }
    })
  }
}
```

### Cache Synchronization with watchQuery

```ts
import { useCache } from 'cachebay'
import { ref, onUnmounted } from 'vue'

const { watchQuery } = useCache()
const postCount = ref(0)

const { unsubscribe } = watchQuery({
  query: POSTS_QUERY,
  variables: { first: 100 },
  onData: (data) => {
    postCount.value = data.posts.edges.length
  }
})

onUnmounted(() => unsubscribe())
```

---

## See also

- **Fragments** — entity-level cache operations: [FRAGMENTS.md](./FRAGMENTS.md)
- **Composables** — `useCache()`, `useFragment()`: [COMPOSABLES.md](./COMPOSABLES.md)
- **Relay connections** — directive, merge modes, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, entity ops, `addNode` / `removeNode` / `patch`: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
