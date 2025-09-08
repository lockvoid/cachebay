# Composables

Cachebay ships a small set of Vue composables that sit on top of the normalized cache. They are available **after** you install the cache as a Vue plugin:

```ts
import { createApp } from 'vue'
import { createCache } from 'villus-cachebay'

const app = createApp(App)
const cache = createCache({ /* keys, resolvers, … */ })

app.use(cache) // <-- provides composables
app.mount('#app')
```

The key composables are:

- **`useCache()`** – low-level cache API (identify/read/write/optimistic/inspect).
- **`useFragment()`** – read one entity by key (reactive proxy by default).
- **`useFragments()`** – read a list by selector (e.g. `'Asset:*'` or interfaces like `'Node:*'`).

> You still use Villus’ `useQuery()` / `useMutation()` for data fetching. Cachebay only covers the cache & normalization layer.

---

## `useCache()`

```ts
import { useCache } from 'villus-cachebay'

const {
  identify,
  readFragment,     // (key, materialized=true?) => entity
  writeFragment,    // (obj) => { commit, revert }
  modifyOptimistic, // (build) => { commit, revert }
  listEntityKeys,   // ('Asset' | 'Node' | selector[]) => string[]
  listEntities,     // (selector, materialized=true?) => any[]
  inspect,          // low-level inspect helpers (debug only)
} = useCache()
```

### Identify

```ts
const k = identify({ __typename:'Asset', id: 42 }) // → "Asset:42" | null
```

Supports `id`, `_id`, and any per-type `keys()` you configured.

### Read

- **Materialized** (default): `readFragment('Asset:42')` returns a **reactive proxy** that updates when new snapshots arrive.
- **Raw snapshot**: `readFragment('Asset:42', false)` returns a plain object copy (non-reactive).

### Write

```ts
writeFragment({ __typename:'Asset', id: 42, name:'Renamed' }).commit?.()
```

You can `.revert?.()` in tests; for writes, `commit()` is effectively a no-op (already applied).

### Optimistic

```ts
const tx = modifyOptimistic(c => {
  c.patch({ __typename:'Asset', id: 999, name:'Draft' }, 'merge')
  const [conn] = c.connections({ parent:'Query', field:'assets' })
  conn.addNode({ __typename:'Asset', id: 999, name:'Draft' }, { position:'start', cursor:null })
  conn.patch('hasNextPage', false)
})
tx.commit?.()
// later: tx.revert?.()
```

See **[OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)** for details.

---

## `useFragment(source, options?)`

Read a single entity by key (or a reactive source for the key).

```ts
import { useFragment } from 'villus-cachebay'

/** 1) Static key → reactive proxy */
const asset = useFragment('Asset:42')  // proxy; asset.name updates as cache changes

/** 2) Dynamic key (ref/computed) */
const currentKey = ref<string | null>('Asset:42')
const current = useFragment(currentKey) // swaps automatically when key changes

/** 3) Options: materialized/raw & snapshot shape */
const snap = useFragment('Asset:42', {
  asObject: true,      // <- return a stable non-ref object
  materialized: false, // <- raw snapshot rather than a proxy
})
```

### Options

```ts
type UseFragmentOptions = {
  asObject?: boolean        // default false; when true returns a non-ref object
  materialized?: boolean    // default true; false returns a raw snapshot
}
```

- **Default** (`materialized: true`): returns a **live proxy**; mutate via `writeFragment` to avoid proxy pitfalls.
- **`asObject: true`** + `materialized: false`: returns a stable copy that doesn’t change under your feet (handy for static display/compare).

> In tests, remember updates are **microtask-batched**. Call `await tick()` after a write to observe changes.

---

## `useFragments(selector, options?)`

Read a **list** of entities from the cache.

```ts
import { useFragments } from 'villus-cachebay'

// 1) Concrete type
const assets = useFragments('Asset:*')        // array of proxies

// 2) Interface selection
const nodes  = useFragments('Node:*')         // proxies for Image, Video, …

// 3) Raw snapshots (non-reactive) – update on add/remove (tick bump)
const rawTs  = useFragments('Tag:*', { materialized: false })
```

### Options

```ts
type UseFragmentsOptions = {
  materialized?: boolean   // default true
}
```

- **Materialized** (default): returns an array of **proxies**, each of which updates when that entity changes.
- **Raw** (`materialized: false`): returns a **snapshot array**; updates appear when the set changes (add/remove). Editing raw items won’t change the cache; use `writeFragment`.

> The selector is a concrete typename with `:*` or an interface name you configured in `createCache({ interfaces: () => ({ Node: ['Image','Video'] }) })`.

---

## Patterns

### Mutations: optimistic + final fragment write

```ts
const { modifyOptimistic, writeFragment } = useCache()

// optimistic
const tx = modifyOptimistic(c => {
  c.patch({ __typename:'Asset', id:'tmp:1', name:'Creating…' }, 'merge')
  const [conn] = c.connections({ parent:'Query', field:'assets' })
  conn.addNode({ __typename:'Asset', id:'tmp:1', name:'Creating…' }, { position:'start' })
})
tx.commit?.()

// server success: upsert real entity
writeFragment({ __typename:'Asset', id:123, name:'Created' }).commit?.()
// (optional) revert the optimistic layer; end state is the same either way
```

### Subscriptions: streaming frames (plain objects)

If your transport does not provide an Observable, you can push frames directly and Cachebay will normalize them and stream non-terminating updates:

```ts
// inside a custom sub handler / test harness:
ctx.useResult({ data: { color: { __typename:'Color', id:1, name:'C1' } } }, false)
ctx.useResult({ data: { color: { __typename:'Color', id:1, name:'C1b' } } }, false)
// readFragment('Color:1').name → "C1b"
```

---

## Nuxt 3

With the plugin pattern from **[SSR.md](./SSR.md)**, these composables are available in any component once you `app.use(cache)` in your Nuxt plugin.

```vue
<script setup lang="ts">
import { useFragments, useFragment, useCache } from 'villus-cachebay'

const list = useFragments('Asset:*')
const asset = useFragment('Asset:42')
const { writeFragment } = useCache()

function rename() {
  writeFragment({ __typename:'Asset', id:42, name:'New name' }).commit?.()
}
</script>
```

---

## Troubleshooting

- **“My proxy didn’t update after write”**
  Ensure you wrote to the same entity key (`__typename:id`). In tests, add `await tick()`.

- **“useFragments(raw) didn’t change on field update”**
  Raw lists update on membership changes (add/remove). For live field updates, use materialized lists.

- **“Interface selector returns empty”**
  Check your `interfaces()` config and that concrete implementors are actually in the store.

---

## See also

- **Fragments & low-level API** – read/write/inspect: [CACHE_FRAGMENTS.md](./CACHE_FRAGMENTS.md)
- **Optimistic updates** – `patch`/`delete`, connection helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **SSR** – hydrate/dehydrate and CN first-mount behavior: [SSR.md](./SSR.md)
- **Relay connections** – modes, dedup, view limits, patching pageInfo/meta: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
