# Resolvers

Resolvers are small field-level transforms that run on every incoming result **before** the data is normalized and merged into the cache. Use them to:

- Normalize **Relay connections** (`relay()` built-in)
- Convert **scalars** (e.g. ISO → `Date`)
- Compute **derived fields** (`fullName`, safe defaults, renames)
- Post-process API envelopes (trim, map, etc.)

Resolvers are bound **per Cache instance** (so they can access connection internals safely).

---

## Defining resolvers

You provide a *resolver map* when creating the cache:

```ts
import { createCache } from 'villus-cachebay'

const cache = createCache({
  resolvers: ({ relay /*, datetime */ }) => ({
    Query: {
      // Normalize Relay list into connection state
      assets: relay(),  // see docs/RELAY_CONNECTIONS.md
    },

    User: {
      // simple computed field
      fullName: ({ parent, set }) => {
        const f = parent.firstName ?? ''
        const l = parent.lastName ?? ''
        set(`${f} ${l}`.trim())
      },

      // safe defaults + rename-ish transform
      avatarUrl: ({ value, set }) => {
        set(typeof value === 'string' && value.length ? value : '/avatar/default.svg')
      },
    },

    // Example scalar transform (if you add one)
    // Post: { createdAt: datetime({ to: 'date' }) },
  }),
})
```

### Resolver signature

A resolver is a function receiving one argument:

```ts
type ResolverContext = {
  parentTypename: string
  field: string            // field name on parent
  parent: any              // the parent object being transformed
  value: any               // the current field value
  variables: Record<string, any> // variables of the operation
  hint?: { stale?: boolean }      // 'true' if this result is considered stale (e.g. replayed cursor page)
  set: (next: any) => void  // assign new field value (use this, don't mutate directly)
}
```

> Use `set(next)` to assign the transformed value. You can return nothing; the cache applies your `set()`.

A few tips:

- **Keep it local**: do not reach into siblings or “other branches” of the response tree; transform just the given field.
- Treat resolvers as **pure** (no side effects). If you need to enrich connection state, use `relay()` and let the connection machinery update pageInfo/meta.

---

## Built-ins

### `relay(opts?)`

Normalizes a field as a **Relay-style connection**, deduplicates edges by entity key, and keeps a reactive mapping from the canonical list to each view’s `edges[]` and `pageInfo`.

Common usage:

```ts
resolvers: ({ relay }) => ({
  Query: { colors: relay() },
})
```

Custom paths are supported:

```ts
// Server uses: colors { items: [{ item: { node {...} }, cursor }], meta: { ... } }
resolvers: ({ relay }) => ({
  Query: {
    colors: relay({
      // path strings for custom layouts
      edges: 'items',
      node:  'item.node',
      pageInfo: 'meta',
      // optional: paginationMode: 'append' | 'prepend' | 'replace' | 'auto'
    })
  }
})
```

See **[RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)** for modes, policy behavior, view limits, cursor replay, and optimistic `patch()`.

---

## Scalar-style transforms (example)

You can write simple scalar resolvers inline. If you prefer a reusable helper, make a tiny wrapper:

```ts
// datetime.ts (example helper)
export const datetime = (opts: { to: 'date' | 'timestamp' }) =>
  ({ value, set }: any) => {
    if (typeof value !== 'string') return set(value)
    if (opts.to === 'date')      return set(new Date(value))
    if (opts.to === 'timestamp') return set(Date.parse(value))
    set(value)
  }

// use it
resolvers: ({ relay }) => ({
  Query: { posts: relay() },
  Post:  { createdAt: datetime({ to: 'date' }) },
})
```

---

## Examples

### Map/trim strings

```ts
Product: {
  name: ({ value, set }) => set(typeof value === 'string' ? value.trim() : value),
  priceCents: ({ value, set }) => set(Number.isFinite(value) ? value : 0),
}
```

### Coerce arrays

```ts
SearchResult: {
  tags: ({ value, set }) => {
    if (!Array.isArray(value)) return set([])
    set(value.filter(Boolean))
  },
}
```

### Feature flags from meta (connection-level)

If your server injects flags at the connection object, `relay()` copies any non-edge fields into **connection meta** reactively. Read them from `cache.inspect.connection()` or surface them on the view container.

For optimistic changes, use `conn.patch('metaField', next)` inside `modifyOptimistic(...)`.

---

## Ordering & performance notes

- Resolvers run **top-down** while walking the result graph. For each object, field resolvers for that **parent type** are called if present.
- Cachebay caches a **resolve signature** per object (`variables` + “stale” hint) to skip redundant work when the same node is revisited.
- Keep resolvers **fast & side-effect free**; they run on every result frame (including subscriptions and optimistic merges).

### About `hint.stale`

When Cachebay knows a page is a **replayed** cursor result (e.g., older page applied after a newer one within the same connection family), it sets `hint.stale = true`. Most resolvers can ignore it, but if you need to branch behavior (e.g., skip heavy transforms on stales), you can check:

```ts
SomeType: {
  someField: ({ value, set, hint }) => {
    if (hint?.stale) return set(value) // cheap path
    // normal transform
    set(expensiveTransform(value))
  }
}
```

---

## Testing resolvers

- Prefer **integration-style** tests: feed a small query result into the plugin via `ctx.useResult({ data })` and assert the output using `cache.inspect.*` / fragment reads.
- Remember entity/view updates are **microtask-batched**—`await tick()` once after `useResult(...)` before asserting.

---

## Troubleshooting

**“My field doesn’t change”**
Make sure you call **`set(next)`** inside the resolver. Mutating `parent[field]` directly won’t be picked up reliably.

**“Array reference keeps changing”**
Relay resolvers update **in place**; if you replace arrays in your resolver, you may cause churn. Prefer shallow transforms and let Relay maintain edges.

**“Resolver needs request variables”**
They’re available as `variables` in the resolver context. Avoid writing variables into the cache; derive a final display value and `set()` it.

---

## See also

- **Relay connections** — de-dup, merge modes, pageInfo/meta, policy matrix: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
- **Optimistic updates** — layering, `patch` / `delete`, connection helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **SSR** — hydrate/dehydrate, CN first-mount behavior, Suspense notes: [SSR.md](./SSR.md)
