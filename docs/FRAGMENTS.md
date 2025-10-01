# Fragments

Fragments are the ergonomic surface for working with **normalized entities**:

- Compute an entity key (`__typename:id`) with **`identify`**
- Read a **reactive** entity via **`readFragment`** (materialized proxy that stays in sync)
- Update fields with **`writeFragment`**
- Pairs cleanly with **Relay connections** and **optimistic updates**

---

## Identify

Computes a unique entity key for a given object based on its `__typename` and identifier field. Returns a string key in the format `"Type:id"` or `null` if the object cannot be identified. Uses custom key configuration if provided during cache creation, otherwise falls back to the `id` field.

**Options:**
- `object` - The entity object containing `__typename` and identifier fields

**Imperative**
```ts
const key = cache.identify({ __typename: 'Post', id: '42' }) // → "Post:42" | null
```

**Composable**
```ts
import { useCache } from 'villus-cachebay'
const { identify } = useCache()
identify({ __typename: 'User', id: 'alice123' }) // → "User:alice123"
identify({ __typename: 'Comment', uuid: 'comment-xyz' }) // → "Comment:comment-xyz" (if uuid is configured as key)
```

If you configured type keys in `createCachebay({ keys: { ... } })`, those rules are used first.

---
## Read Fragment

Retrieves a normalized entity from the cache as a reactive Vue proxy. The returned object automatically updates when the underlying entity changes through queries, mutations, optimistic updates, or fragment writes. Accepts an entity key and optional GraphQL fragment to specify which fields to include.

**Options:**
- `id` - Entity key in format `"Type:id"`
- `fragment` - GraphQL fragment string (optional)
- `fragmentName` - Name of the fragment (optional)
- `variables` - Variables for the fragment (optional)

**Imperative**
```ts
const post = cache.readFragment('Post:42', PostFragment, 'PostDetails', { locale: 'en' })
```

**Composable**
```ts
import { useCache } from 'villus-cachebay'
const { readFragment } = useCache()
const post = readFragment('Post:42')
const userProfile = readFragment('User:alice123', `
  fragment UserProfile on User {
    id
    name
    email
    avatar
  }
`, 'UserProfile')
```

**Composable (useFragment)**
```ts
import { useFragment } from 'villus-cachebay'
const post = useFragment({
  id: 'Post:42',
  fragment: `
    fragment PostDetails on Post {
      id
      title
      content
      author { name }
    }
  `,
  fragmentName: 'PostDetails',
  variables: { includeComments: true }
})
```

Returns a **Vue proxy** that updates when the store changes (queries, mutations, optimistic edits, fragment writes).

---

## Write Fragment

Updates a single normalized entity in the cache immediately. Accepts an entity key, GraphQL fragment definition, and the new data to write. The update is synchronous and will trigger reactivity for any components reading this entity. Commonly used for optimistic updates and local state modifications.

**Options:**
- `id` - Entity key in format `"Type:id"`
- `fragment` - GraphQL fragment string
- `fragmentName` - Name of the fragment
- `variables` - Variables for the fragment (optional)
- `data` - The data object to write to the entity

**Imperative**
```ts
cache.writeFragment({
  id: 'Post:42',
  fragment: PostFragment,
  fragmentName: 'PostUpdate',
  variables: {},
  data: {
    __typename: 'Post',
    id: '42',
    title: 'Updated Post Title',
    updatedAt: new Date().toISOString(),
  }
})
```

**Composable**

```ts
import { useCache } from 'villus-cachebay'
const { writeFragment } = useCache()
writeFragment({
  id: 'User:alice123',
  fragment: `
    fragment UserStatus on User {
      isOnline
      lastSeen
    }
  `,
  fragmentName: 'UserStatus',
  data: {
    __typename: 'User',
    id: 'alice123',
    isOnline: true,
    lastSeen: new Date().toISOString(),
  }
})
```

**Composable (useFragment)**

```ts
import { useFragment } from 'villus-cachebay'
const { writeFragment } = useFragment()
writeFragment({
  id: 'Post:42',
  fragment: `
    fragment PostContent on Post {
      title
      content
      tags
    }
  `,
  fragmentName: 'PostContent',
  data: {
    __typename: 'Post',
    id: '42',
    title: 'New Title',
    content: 'Updated content...',
    tags: ['react', 'graphql']
  }
})
```

---
## Entity keys & interfaces

Customize identity and enable interface-style addressing at **cache creation**:

```ts
import { createCachebay } from 'villus-cachebay'

const cache = createCachebay({

  keys: {
    User: (user) => user.id ?? null,
    Post: (post) => post.uuid ?? null,
  },

  interfaces: {
    Post: ['AudioPost', 'VideoPost'],
  },
})

```

**How keys work**

- A key function receives the raw object and must return a **stable string** or `null`.
- `identify()` and the normalizer derive the canonical record id (`"Type:value"`).
- If no key rule matches a type, Cachebay falls back to `id` (if present).

**How interfaces work**

- Declaring `interfaces.Post = ['AudioPost','VideoPost']` lets you **address by parent type**:
  - `readFragment('Post:123')` resolves to the concrete record once known (e.g., `"AudioPost:123"`).
- Writes still happen on **concrete** records (e.g., `{ __typename:'AudioPost', uuid:'123' }`).
- Best practice: ensure implementors don't **collide** on the same id space unless that's intentional.

---

## See also

- **Composables** — `useCache()`, `useFragment()`: [COMPOSABLES.md](./COMPOSABLES.md)
- **Relay connections** — directive, merge modes, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, entity ops, `addNode` / `removeNode` / `patch`: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
