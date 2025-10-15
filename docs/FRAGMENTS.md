# Fragments

**Reading & tracking partial entity data** with Cachebay, agnostic and Vue bindings.

* Agnostic API: `readFragment`, `writeFragment`, `watchFragment`
* Vue: `useFragment` (from `cachebay/vue`)

> IDs are canonical: `"Typename:value"` (e.g., `"Post:p1"`). With interfaces enabled, interface IDs (e.g., `"Post:123"`) resolve to concrete types once known.

---

## `readFragment` (agnostic)

Materializes a fragment for a **single entity** from cache only.

**Options**

* `id: string` — canonical record id (e.g., `"Post:p1"`)
* `fragment: string | DocumentNode | CachePlan`
* `fragmentName?: string` — when the document contains multiple fragments
* `variables?: Record<string, any>`

**Returns**

`T | null`

**Example**

```ts
const post = cache.readFragment<{ id: string; title: string }>({
  id: 'Post:p1',

  fragment: `
    fragment PostFields on Post {
      id
      title
    }
  `,

  fragmentName: 'PostFields',
});
```

---

## `writeFragment` (agnostic)

Writes raw data for a **single entity** under its record id.

**Options**

* `id: string`
* `fragment: string | DocumentNode | CachePlan`
* `fragmentName?: string`
* `data: any`
* `variables?: Record<string, any>`

**Returns**

`void`

**Example**

```ts
cache.writeFragment({
  id: 'Post:p1',

  fragment: `
    fragment PostFields on Post {
      id
      title
    }
  `,

  fragmentName: 'PostFields',

  data: {
    __typename: 'Post', id: 'p1', title: 'Hello'
  },
});
```

---

## `watchFragment` (agnostic)

Watches a fragment and **pushes updates** when dependent fields of that entity change. Effectively recycles views for rendering performance.

**Options**

* `id: string`
* `fragment: string | DocumentNode | CachePlan`
* `fragmentName?: string`
* `variables?: Record<string, any>`
* `onData: (data: any) => void`
* `onError?: (error: Error) => void`
* `immediate?: boolean` (default: `true` — emit current cache value if present)

**Returns**

`{ unsubscribe(): void; update({ id?, variables?, immediate? }): void }`

**Example**

```ts
const watcher = cache.watchFragment({
  id: 'Post:p1',

  fragment: `
    fragment PostFields on Post {
      id
      title
    }
  `,

  fragmentName: 'PostFields',

  onData: (data) => {
    console.log('post updated', data)
  },
});

// Later: retarget to another entity or change variables
watcher.update({ id: 'Post:p2', immediate: true })

// Cleanup
watcher.unsubscribe()
```

> Notes
>
> * Cache misses do **not** trigger `onError`; the watcher waits until data becomes available.
> * Internally uses dependency indexing, microtask batching, and snapshot recycling for stable object identities.

---

## Vue

## `useFragment`

Create a reactive view of a single entity’s fragment.

**Options**

* `id: string | Ref<string>`
* `fragment: string | DocumentNode | CachePlan`
* `fragmentName?: string`
* `variables?: Record<string, any> | Ref<Record<string, any> | undefined>`

**Returns**

`Readonly<Ref<TData | undefined>>`

**Basic usage**

```ts
import { useFragment } from 'cachebay/vue'

const post = useFragment<{ id: string; title: string }>({
  id: 'Post:p1',

  fragment: `
    fragment PostFields on Post {
      id
      title
    }
  `,

  fragmentName: 'PostFields',
})
```

**Reactive id/variables**

```ts
import { ref } from 'vue'
import { useFragment } from 'cachebay/vue'

const id = ref('Post:p1')
const variables = ref<{ locale?: string }>({ locale: 'en' })

const post = useFragment<{ id: string; title: string }>({
  id,

  variables,

  fragment: `
    fragment PostFields on Post {
      id
      title
    }
  `,

  fragmentName: 'PostFields',
})

// Later
id.value = 'Post:p2'
variables.value = { locale: 'de' }
```

> Tip: With interfaces configured, `id: 'Post:123'` will resolve to the concrete record (`'AudioPost:123'`, `'VideoPost:123'`, etc.) once known.

---

## Next steps

Continue to [MUTATIONS.md](./MUTATIONS.md) to learn about executing mutations, write merging, and optimistic update patterns.

## See also

* **Setup** — keys & interfaces: [SETUP.md](./SETUP.md)
* **Queries** — read/write/watch queries: [QUERIES.md](./QUERIES.md)
* **Mutations** — write merging & optimistic: [MUTATIONS.md](./MUTATIONS.md)
* **Optimistic updates** — entity helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
* **Relay connections** — pagination: [RELAY_CONNECTIONS.md](./RELAY_CONNECTIONS.md)
* **SSR** — hydrate/dehydrate entities: [SSR.md](./SSR.md)
