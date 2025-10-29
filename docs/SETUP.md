cachebay/docs/SETUP.md#L1-220
# Setup — createCachebay (agnostic core)

This page explains how to create and configure the Cachebay cache (the agnostic core). Keep this page as the authoritative setup reference: how to call `createCachebay`, what the important options mean, how Cachebay instances are scoped (server vs client), and short framework examples for Vue and Nuxt.

See also:
- `INSTALLATION.md` — install instructions
- `QUICK_START.md` — one-shot runnable example
- `FRAGMENTS.md`, `QUERIES.md`, `OPTIMISTIC_UPDATES.md`, `RELAY_CONNECTIONS.md`, `SSR.md` — deeper topics

---

## Core idea

- Cachebay is framework-agnostic. You create a cache instance with `createCachebay(options)`.
- The instance is the cache: it holds normalized data, optimistic layers, and SSR snapshots.
- On the server you should create one cache instance per request. On the client you typically create a single app-wide instance.

---

## createCachebay — minimal example

A minimal `fetch`-based transport:

```/dev/null/create-cachebay-example.ts#L1-40
import { createCachebay } from 'cachebay'

const cache = createCachebay({
  transport: {
    http: async ({ query, variables }) => {
      const res = await fetch('/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      })
      return await res.json() // { data?: any, errors?: any[] }
    }
  }
})
```

---

## Important options

This is a compact reference for the most used `createCachebay` options.

- `transport` (required)
  - `http: async (ctx) => Promise<OperationResult>` — required for queries & mutations. Receives `{ query, variables, operationName, ... }`.
  - `ws?: async (ctx) => Promise<ObservableLike<OperationResult>>` — optional, for subscriptions (returns an observable/stream).
- `cachePolicy?: 'cache-first' | 'cache-and-network' | 'network-only' | 'cache-only'`
  - Default behavior for operations; can be overridden per-call.
- `keys?: Record<string, (obj: any) => string | null>`
  - Per-type id functions used to compute `Type:id`.
- `interfaces?: Record<string, string[]>`
  - Map of interface/abstract type to concrete implementors (helps `readFragment` address abstract types).
- `hydrationTimeout?: number` (ms)
  - Short window after `hydrate()` to suppress initial `cache-and-network` revalidate (SSR UX guard).
- `suspensionTimeout?: number` (ms)
  - Short window after a result to avoid duplicate Suspense re-executions.
- `other` — additional internal tuning rarely needed for typical use.

Instance methods you will use often:
- `executeQuery`, `executeMutation`, `executeSubscription`
- `readQuery`, `writeQuery`, `watchQuery`
- `readFragment`, `writeFragment`, `watchFragment`
- `modifyOptimistic` (optimistic layers)
- `dehydrate()` / `hydrate(snapshot)` / `isHydrating()`
- `identify(obj)` — compute `Type:id` or `null`

---

## Instance scoping (server vs client)

- Server: create a fresh cache per incoming request. Run your render flow (queries write into the cache), then call `dehydrate()` to produce a snapshot to embed in HTML.
- Client: create one cache instance at app boot. Call `hydrate(snapshot)` before mounting if you embedded a server snapshot. Cachebay provides a short hydration window to avoid duplicate revalidation for `cache-and-network`.

Short server/client flow:

```/dev/null/ssr-flow.md#L1-20
// Server (per request)
const cache = createCachebay({ transport: { http } })
// render app -> queries run against cache
const snapshot = cache.dehydrate() // serialize and embed

// Client
const cache = createCachebay({ transport: { http } })
cache.hydrate(window.__CACHEBAY__) // if present, before mount
```

---

## Vue adapter (short)

The Vue adapter is available at the `cachebay/vue` entrypoint. It wraps the agnostic instance in a tiny plugin that `provide`s the cache to your app, and ships composables (`useQuery`, `useMutation`, `useFragment`, `useSubscription`) that use the cache under the hood.

Install & provide the plugin:

```/dev/null/vue-main.ts#L1-24
import { createApp } from 'vue'
import { createCachebay } from 'cachebay/vue'
import App from './App.vue'

const cache = createCachebay({ transport: { http: async ({ query, variables }) => fetch('/graphql', { method:'POST', body:JSON.stringify({query,variables}) }).then(r=>r.json()) } })
createApp(App).use(cache).mount('#app')
```

In components use:

```/dev/null/vue-component.md#L1-20
import { useQuery } from 'cachebay/vue'

const { data, error, isFetching, refetch } = useQuery({
  query: `query Posts { posts { __typename id title } }`,
  cachePolicy: 'cache-and-network'
})
```

Notes:
- The Vue plugin does not change cache semantics — it only provides integration (DI + composables).
- `useQuery` composable wraps `watchQuery` + `executeQuery` and supports Suspense, lazy mode, reactive variables, and refetch.

---

## Nuxt example (short)

For Nuxt (server + client hydration), create the cache per server request and persist the snapshot to Nuxt state; hydrate on the client:

```/dev/null/nuxt-plugin.ts#L1-60
export default defineNuxtPlugin((nuxtApp) => {
  const cache = createCachebay({ transport: { http: async ({ query, variables }) => fetch('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) }).then(r => r.json()) } })

  // Server: store snapshot after render
  if (process.server) {
    nuxtApp.hook('app:rendered', () => {
      useState('cachebay').value = cache.dehydrate()
    })
  }

  // Client: hydrate once
  if (process.client) {
    const state = useState('cachebay').value
    if (state) cache.hydrate(state)
  }

  nuxtApp.vueApp.use(cache)
})
```

---

## Where to go next

- `QUICK_START.md` — copy-paste runnable example
- Adapter docs:
  - `docs/adapters/VUE.md` — full Vue API & composable reference
- Deep topics:
  - `FRAGMENTS.md`, `QUERIES.md`, `OPTIMISTIC_UPDATES.md`, `RELAY_CONNECTIONS.md`, `SSR.md`

If you want, I can now:
- Create `QUICK_START.md` (single-file example).
- Expand `SETUP.md` into a full `CREATE_CACHEBAY.md` with typed option shapes and expanded examples.
Which would you prefer?