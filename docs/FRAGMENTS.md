# Fragments

Fragments are the ergonomic surface for working with **normalized entities**:

- Compute an entity key (`__typename:id`) with **`identify`**
- Read a **reactive** entity via **`readFragment`** (materialized proxy that stays in sync)
- Update fields with **`writeFragment`**
- Pairs cleanly with **Relay connections** and **optimistic updates**

---

## Identify

```ts
// Imperative
const key = cache.identify({ __typename: 'Post', id: '42' }) // → "Post:42" | null

// Composable
import { useCache } from 'villus-cachebay'

const { identify } = useCache()

identify({ __typename: 'User', id: 'u1' }) // → "User:u1"
```

If you configured type keys in `createCachebay({ keys: { ... } })`, those rules are used first.

---

## Read (reactive)

```ts
// Imperative
const post = cache.readFragment('Post:42')

// Composable
import { useCache } from 'villus-cachebay'

const { readFragment } = useCache()

const post = readFragment('Post:42')

// Composable (useFragment)
import { useFragment } from 'villus-cachebay'

const post = useFragment({
  id: 'Post:42',

  fragment: `
    fragment P on Post {
      id
      title
    }
  `,
})
```

Returns a **Vue proxy** that updates when the store changes (queries, mutations, optimistic edits, fragment writes).

---

## Write

`writeFragment(input)` updates a **single entity** immediately.

```ts
// Imperative
cache.writeFragment({
  __typename: 'Post',
  id: '42',
  title: 'Renamed',
})

// Composable
import { useCache } from 'villus-cachebay'

const { writeFragment } = useCache()

writeFragment({ __typename: 'User', id: 'u1', name: 'Updated' })
```

---

## Entity keys & interfaces

Customize identity and enable interface-style addressing at **cache creation**:

```ts
import { createCachebay } from 'villus-cachebay'

const cache = createCachebay({
  // Custom key functions (when your id field isn’t "id")
  keys: {
    User: (o) => o.id ?? null,
    Post: (o) => o.uuid ?? null,
  },

  // Interface/union mapping for address-by-parent-type (Post has two subtypes)
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
- Best practice: ensure implementors don’t **collide** on the same id space unless that’s intentional.

---

## See also

- **Composables** — `useCache()`, `useFragment()`: [COMPOSABLES.md](./COMPOSABLES.md)
- **Relay connections** — directive, merge modes, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, entity ops, `addNode` / `removeNode` / `patch`: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
