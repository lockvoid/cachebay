# Cachebay for Villus — SSR-safe normalized cache & Relay-style connections

Blazing-fast normalized cache + Relay-style connections for Villus.

A tiny, instance-scoped cache layer for **Villus** that gives you:

- **Fast** (microtask batched), **~14KB gzipped**
- Normalized **entities** (with auto-`__typename`)
- **Relay-style connections** with reactive “splice” updates (no array churn)
- **Optimistic** helpers & fragment read/write
- **SSR dehydrate/hydrate** that suppresses duplicate client re-requests
- A clean **resolver spec** system (`defineResolver`) with built-ins:
  - `relay(...)` — pagination & connection views
  - `datetime({ to: 'date' | 'timestamp' })` — scalar transforms
- A `useCache()` hook to read/write fragments, run optimistic edits, and inspect

---

## Quick start

```ts
// plugins/villus.client-server.ts (Nuxt 3 example)
import { createClient, fetch as fetchPlugin, dedup as dedupPlugin } from 'villus'
import { createCachebay } from '~/lib/cachebay'

export default defineNuxtPlugin((nuxtApp) => {
  const cachebay = createCachebay({
    addTypename: true,
    keys: () => ({
      User: (o) => (o.id ?? o._id ? String(o.id ?? o._id) : null),
    }),
    resolvers: ({ relay, datetime }) => ({
      Query: {
        assets: relay(),                         // Relay connection
      },
      Asset: {
        createdAt: datetime({ to: 'date' }),     // Convert ISO string → Date
      },
    }),
  })

  const client = createClient({
    url: useRuntimeConfig().public.apiHttpUrl + '/graphql',
    cachePolicy: 'cache-and-network',
    use: [
      dedupPlugin(),  // keep *before* network
      cachebay,       // Cachebay (Villus plugin)
      fetchPlugin(),  // network
    ],
  })

  // Villus + Cachebay (also provides useCache())
  nuxtApp.vueApp.use(client)
  nuxtApp.vueApp.use(cachebay)
})
```

### SSR hydrate / dehydrate (Nuxt)

```ts
// Same plugin file
export default defineNuxtPlugin({
  name: 'villus+cachebay',
  setup(nuxtApp) {
    const cachebay = /* …createCachebay(...) as above… */

    // …set up Villus client & app.use(cachebay) …

    if (import.meta.client) {
      const snap = useState('cachebay:snapshot').value
      if (snap) cachebay.hydrate(snap) // ⟵ suppresses first client re-fetch
    }
  },
  hooks: {
    'app:rendered'() {
      if (import.meta.server) {
        useState('cachebay:snapshot').value =
          (globalThis as any).__cachebay?.dehydrate?.()
          ?? /* if you kept a local variable */ cachebay.dehydrate()
      }
    },
  },
})
```

> **Hydration notes.** During `hydrate()`, Cachebay re-registers cached results and issues a one-time **ticket** per operation key so `cache-and-network` won’t re-fire *immediately* on the client. We also guard the immediate post-Suspense re-entry. Subsequent remounts still refresh as usual.

---

## Concepts

- **Instance scoped.** `createCachebay(...)` returns a Villus plugin *with methods*. Create one per SSR request.
- **Resolvers.** Pure, instance-agnostic “specs” via `defineResolver`. Cachebay binds them to the instance on install.
- **Keys.** A per-instance factory mapping `__typename -> (obj) => id` used to build normalized keys like `User:123`.
- **Connections.** Relay-style connection state + reactive **views** that splice updates (no array recreation).

---

## API surface

### `createCachebay(options) → CachebayInstance`

```ts
type CachebayOptions = {
  typenameKey?: string;                    // default "__typename"
  addTypename?: boolean;                   // default true
  writePolicy?: 'replace' | 'merge';       // default 'replace'
  idFromObject?: (obj:any) => string | null;

  keys?: () => Record<string, (obj:any)=>string|null>;
  resolvers?: (builtins:{
    relay: (opts?: RelayOptsPartial) => ResolverSpec;
    datetime: (opts:{ to:'date'|'timestamp' }) => ResolverSpec;
  }) => Record<string, Record<string, ResolverSpec | FieldResolver>>;
}
```

The returned **instance** is both:

- a **Villus plugin** (put in `use: [...]`), and
- a **Vue plugin** (call `app.use(cachebay)` to enable `useCache()`)

It also exposes:

```ts
type CachebayInstance = ClientPlugin & {
  dehydrate(): any
  hydrate(input: any | ((hydrate:(snapshot:any)=>void)=>void)): void

  identify(obj:any): string | null
  readFragment(refOrKey, materialized?: boolean): any
  writeFragment(obj:any): { commit():void; revert():void }
  modifyOptimistic(build:(api:any)=>void): { commit():void; revert():void }

  inspect: {
    entities(typename?: string): string[]
    get(key: string): any
    connections(): string[]
    connection(parent:'Query'|{__typename:string;id?:any;_id?:any}, field:string, variables?:Record<string,any>): any
  }

  install(app: App): void
  gc?: { connections(predicate?:(key:string,state:any)=>boolean): void }
}
```

### Vue integration

- **Provide**: `app.use(cachebay)` or `provideCachebay(app, cachebay)`
- **Consume**:

```ts
const { readFragment, writeFragment, identify, modifyOptimistic, inspect } = useCache()
```

---

## Resolver system

Author resolvers without touching instance internals:

```ts
import { defineResolver } from '~/lib/cachebay'

// Example: uppercase certain fields
export const uppercase = defineResolver((_inst, opts: { fields: string[] }) => {
  return ({ value, set }) => {
    if (!value || typeof value !== 'object') return
    const next = { ...value }
    for (const f of opts.fields) {
      if (typeof next[f] === 'string') next[f] = next[f].toUpperCase()
    }
    set(next)
  }
})
```

Attach resolvers per instance:

```ts
resolvers: ({ relay, datetime }) => ({
  Query:   { assets: relay() },
  Asset:   { createdAt: datetime({ to: 'date' }) },
  // Foo:   { bar: uppercase({ fields: ['title'] }) },
})
```

### Built-ins

#### `relay(opts?)`

```ts
type RelayOptsPartial = {
  edges?: string          // default 'edges'
  node?: string           // default 'node' or 'edge.node'
  pageInfo?: string       // default 'pageInfo'
  after?: string          // default 'after'
  before?: string         // default 'before'
  first?: string          // default 'first'
  last?: string           // default 'last'
  write?: 'replace'|'merge' // entity write policy for nodes
}
```

- Normalizes edge `node`s into the entity store (dedup by normalized key)
- Maintains reactive **views** for `edges[]` and `pageInfo`
- **Stable connection identity** ignores cursor variables (`after/before/first/last`)
- Interface-aware: an `Asset` interface edge will bind to `Image:1` / `Video:1` depending on what exists

#### `datetime({ to })`
Converts ISO strings to **Date** (`to: 'date'`) or to **number** (`to: 'timestamp'`). Works on scalars and arrays.

---

## Relay **view modes** & **merge modes**

These are **per-operation** hints passed via Villus **operation context**.

### View modes (what your component renders)

- `relayView: 'cumulative' | 'windowed'` (default **`'cumulative'`**)

**`'cumulative'`** (default)
Render **everything** present in the connection cache. When you paginate, the view grows and stays grown. Switching tabs and coming back still shows all accumulated pages from cache (then refreshes).

**`'windowed'`**
Render a **window** over cached edges:
- First page (`replace`) sets the window to **that page size**
- Subsequent pages (`append`/`prepend`) **increase** the window by **that page size**
- Switching away and back (fresh view) **resets to one page** again (even though the cache still holds many)

```ts
useQuery({
  query: AssetsQuery,
  variables: { after: null },
  context: {
    relayView: 'windowed',  // or 'cumulative'
  },
})
```

### Merge modes (how incoming pages write into the connection)

- `relayMode: 'append' | 'prepend' | 'replace' | 'auto'` (default **`'append'`**)

**`'append'`** (default) — forward pagination (common case).
**`'prepend'`** — reverse/older-first pagination.
**`'replace'`** — replace edges for this identity (first page semantics).
**`'auto'`** — infer: `after != null → append`, `before != null → prepend`, else `replace` (classic Relay detection).

```ts
useQuery({
  query: AssetsQuery,
  variables: { after: cursor },
  context: {
    relayMode: 'append',     // default
    relayView: 'windowed',
  },
})
```

> **Stale first-page safety.** If a **stale** `replace` arrives (e.g., a late page-1 after you’ve already loaded page-2), Cachebay **does not clear** the list. It upserts nodes/meta only, keeping later pages and avoiding flicker.

---

## Behavior matrix (summary)

| Write kind  | Latest result (publishes)                                   | Stale result (processed & cached)                              |
|-------------|--------------------------------------------------------------|-----------------------------------------------------------------|
| **replace** | **Windowed**: window resets to the page size. **Cumulative**: show all. | **No clear**. Upsert only. **Windowed**: **do not shrink**. Publish only if Relay allowed (pagination + base match). |
| **append**  | Add to tail (dedup). Window grows by page size if windowed. | Same as latest; publish only if allowed.                        |
| **prepend** | Add to head (dedup). Window grows by page size if windowed. | Same as latest; publish only if allowed.                        |

---

## Take-latest & anti-replay (how results publish)

Cachebay installs a tiny concurrency guard:

- **Families.** Queries are grouped by a **family key** (`query body + optional concurrency scope`). Only the **latest** result for a family is eligible to publish.
- **Stale results.** Still **processed and cached** (resolvers run, entities/connection updated), but **not published** unless the **Relay resolver** explicitly sets `allowReplayOnStale` **and** the **base variables** (excluding cursors) match. This allows safe replay for true pagination results.

> You can optionally set a **family scope** on an operation to isolate concurrent runs:
>
> ```ts
> useQuery({ query, variables, context: { concurrencyScope: 'assets-tab-1' } })
> ```

---

## Fragments & optimistic

Available via `useCache()` (or on the instance):

- `identify(obj) → "Type:id" | null`
- `readFragment(refOrKey, materialized = true)`
- `writeFragment(obj) → { commit, revert }`
- `modifyOptimistic(build) → { commit, revert }`

Inside `modifyOptimistic(build)`:

```ts
cache.connections({ parent, field, variables? }) // → array of handles for matching connections
// handle API:
.addNode(node, { cursor?, position?: 'start'|'end', edge?: Record<string,any> | (node)=>Record<string,any>|undefined })
.addNodeByKey('Type:id', { cursor?, position?, edge? })
.removeNode(node)
.removeNodeByKey('Type:id')
.patch('hasNextPage', (v)=>true)

cache.write(obj)                    // upsert entity
cache.patch('Type:id', { name:'…' })// shallow merge fields
cache.del('Type:id')                // delete entity + unlink from connections
cache.identify, cache.readFragment, cache.writeFragment
```

---

## Inspect (dev helpers)

```ts
const { inspect } = useCache()

inspect.entities('Asset')        // → ['Asset:1', 'Asset:2', …]
inspect.get('Asset:1')           // → raw snapshot (no __typename/id copy)
inspect.connections()            // → all connection keys
inspect.connection('Query', 'assets', { status: 'OPEN' })
// → { key, variables, size, edges: [{key,cursor}], pageInfo, meta }
```

---

## Recipes

### Typical infinite scroll (forward)

```ts
const { data, isFetching, execute } = useQuery({
  query: gql`query Assets($after: String) { assets(first: 30, after: $after) { edges { cursor node { id __typename name } } pageInfo { hasNextPage endCursor } } }`,
  variables: { after: null },
  context: { relayView: 'windowed', relayMode: 'append' },
})

async function loadMore() {
  if (!data.value?.assets?.pageInfo?.hasNextPage) return
  await execute({ after: data.value.assets.pageInfo.endCursor })
}
```

- First mount shows **one page** (windowed).
- Each `loadMore()` extends the window by one page (cache accumulates all).
- Switching away/back recreates a fresh view with **one page** again (still cache-first + background refresh).

### Reverse timeline (prepend)

Use `relayMode: 'prepend'` (and your server should support `before/last`).

### Optimistic edge insert

```ts
const { modifyOptimistic, identify } = useCache()

modifyOptimistic((cache) => {
  const id = identify({ __typename:'Asset', id:'temp' })
  cache.write({ __typename:'Asset', id:'temp', name:'Uploading…' })

  cache.connections({ parent:'Query', field:'assets', variables:{ /* your base filters */ } })
    .forEach(conn => conn.addNodeByKey(id!, { position:'start', edge: { cursor:null } }))
})
```

---

## Behavior & guarantees

- **Instance scoped.** New instance per SSR request; no cross-request state.
- **Hydration guard.** The first client pass after `hydrate()` won’t refetch hydrated ops (even under `cache-and-network`).
- **Suspense guard.** The post-Suspense immediate re-exec of the same op is swallowed once (microtask).
- **Plugin order.** `dedupPlugin()` → **cachebay** → `fetchPlugin()`. (Always put Cachebay **before** network.)

---

## Troubleshooting

**“Two requests” in dev**
Dev HMR + Suspense can remount. Keep `dedupPlugin()` enabled and ordered before network. Cachebay swallows the immediate post-hydrate/post-Suspense repeat once.

**Late page-1 collapses my list**
Handled. Stale `replace` no longer clears the list; it upserts only, so page-2+ remain intact. If you still *see* fewer items in the UI under `windowed`, that’s the **view limit** doing its job.

**Why don’t I see stale page results immediately?**
Stale results are cached but not published unless Relay allowed replay (cursor op + same base). Next user action (or a new latest result) will publish consistent state.

**Interface nodes show wrong type**
Make sure your `interfaces` mapping (if you pass one) lists concrete implementors; Cachebay binds proxies to the concrete snapshot it finds.

---

## Performance tips

- Prefer `writePolicy: 'merge'` for large, frequently updated entities to reduce churn.
- Use `identify + writeFragment` in mutation handlers to avoid refetching.
- For connections, prefer `modifyOptimistic` to update edges locally.

---

## Type reference

```ts
export function createCachebay(opts?: CachebayOptions): CachebayInstance

export function provideCachebay(app: App, instance: CachebayInstance): void
export function useCache(): {
  readFragment: (...args:any[]) => any
  writeFragment: (...args:any[]) => { commit():void; revert():void }
  identify: (obj:any) => string | null
  modifyOptimistic: (build:(api:any)=>void) => { commit():void; revert():void }
  inspect: {
    entities(typename?: string): string[]
    get(key: string): any
    connections(): string[]
    connection(parent:'Query'|{__typename:string;id?:any;_id?:any}, field:string, variables?:Record<string,any>): any
  }
}

export function defineResolver<TOpts>(
  binder: (inst: CachebayInternals, opts: TOpts) => FieldResolver
): (opts: TOpts) => ResolverSpec

export const relay: (opts?: RelayOptsPartial) => ResolverSpec
export const datetime: (opts:{ to: 'date'|'timestamp' }) => ResolverSpec
```

---

## Naming cheatsheet

- **View mode** (rendering): `relayView: 'windowed' | 'cumulative'` (default **`'cumulative'`**)
- **Merge mode** (writing): `relayMode: 'append' | 'prepend' | 'replace' | 'auto'` (default **`'append'`**)
  Use `'auto'` to mimic classic after/before detection.

---

## License

MIT © LockVoid Labs \~●~
