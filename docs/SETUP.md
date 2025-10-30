# Setup


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
const snapshot = cachebay.dehydrate() // serialize and embed

// Client
const cache = createCachebay({ transport: { http } })
cachebay.hydrate(window.__CACHEBAY__) // if present, before mount
```

---

## Vue

The Vue adapter is available at the `cachebay/vue` entrypoint. It wraps the agnostic instance in a tiny plugin that `provide`s the cache to your app, and ships composables (`useQuery`, `useMutation`, `useFragment`, `useSubscription`) that use the cache under the hood.

Install & provide the plugin:

```
import { createApp } from 'vue'
import { createCachebay } from 'cachebay/vue'
import App from './App.vue'

const cachebay = createCachebay({
  transport: { http:
    async ({ query, variables }) => {
      return fetch('/graphql', { method:'POST', body:JSON.stringify({query,variables}) }).then(response => response.json()) } });
    }
});

createApp(App).use(cachebay).mount('#app')
```

In components use:

```
import { useQuery } from 'cachebay/vue'

const { data, error, isFetching, refetch } = useQuery({
  query: `query Posts { posts { __typename id title } }`,
})
```

---

### Nuxt example

For Nuxt (server + client hydration), create the cache per server request and persist the snapshot to Nuxt state; hydrate on the client:

```/dev/null/nuxt-plugin.ts#L1-60
export default defineNuxtPlugin((nuxtApp) => {
  const cache = createCachebay({ transport: { http: async ({ query, variables }) => fetch('/graphql', { method: 'POST', body: JSON.stringify({ query, variables }) }).then(r => r.json()) } })

  // Server: store snapshot after render
  if (process.server) {
    nuxtApp.hook('app:rendered', () => {
      useState('cachebay').value = cachebay.dehydrate()
    })
  }

  // Client: hydrate once
  if (process.client) {
    const state = useState('cachebay').value
    if (state) cachebay.hydrate(state)
  }

  nuxtApp.vueApp.use(cache)
})
```

---
