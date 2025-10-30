# Operations

Cachebay’s **agnostic** client exposes three network operations:

* `executeQuery` — fetch data with cache policies
* `executeMutation` — perform network writes
* `executeSubscription` — stream network updates

Use these APIs directly in any environment (no framework required). For framework‑specific hooks, see:

* **Queries** [QUERIES.md](./QUERIES.md)
* **Mutations:** [MUTATIONS.md](./MUTATIONS.md)
* **Subscriptions:** [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)

## Queries

`executeQuery` respects Cachebay’s policies and normalizes responses into the cache. You can observe whether the result came from cache or network via `result.meta?.source`.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`
* `cachePolicy?: 'cache-first' | 'network-only' | 'cache-only' | 'cache-and-network'`
* `onCacheData?: (data, meta: { willFetchFromNetwork: boolean }) => void`
* `onNetworkData?: (data) => void`
* `onError?: (error: CombinedError) => void`

**Returns**

`Promise<OperationResult<TData>>`

```ts
interface OperationResult<TData = any> {
  data: TData | null;
  error: CombinedError | null;
  meta?: { source?: 'cache' | 'network' };
}
```

### Example

```ts
const { data, error, meta } = await cache.executeQuery({
  query: `
    query Post($id: ID!) {
      post(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },
});
```

Deep dive: [QUERIES.md](./QUERIES.md)

## Mutations

`executeMutation` sends writes and merges results into the cache.

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
const { data, error } = await cache.executeMutation({
  query: `
    mutation CreatePost($input: CreatePost!) {
	    createPost(input: $input) {
	      post {
	        id
	        title
	      }
	    }
	  }
  `
  variables: {
    input: { id: 'p1', name: 'New post' },
  },
});
```

Deep dive: [MUTATIONS.md](./MUTATIONS.md)

## Subscriptions

`executeSubscription` streams results and writes them into the cache. Requires a **WS transport**.

**Options**

* `query: string | DocumentNode | CachePlan`
* `variables?: Record<string, any>`
* `onData?: (data) => void`
* `onError?: (error: CombinedError) => void`
* `onComplete?: () => void`

**Returns**

`ObservableLike<OperationResult<TData>>` — an observable with `subscribe({ next, error, complete })`.

**Example**

```ts
const subscription = cache.executeSubscription({
  query: `
    subscription PostUpdated($id: ID!) {
      postUpdated(id:$id) {
        id
        title
      }
    }
  `,

  variables: {
    id: 'p1',
  },
})

const { unsubscribe }  = subscription.subscribe({
  next: ({ data, error }) => {
    if (data) {
      console.log(data)
    }

    if (error) {
      console.error(error);
    }
  },

  error: (error) => {
    console.error(error);
  },

  complete: () => {
     console.log('done');
  }
});
```

Deep dive: [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)

## Next steps

Continue to `QUERIES.md`, `MUTATIONS.md`, and `SUBSCRIPTIONS.md` for detailed guides and adapter examples.

## See also

* **Setup** — transports, policies, identity: [SETUP.md](./SETUP.md)
* **Queries** — planning, normalization, pagination: [QUERIES.md](./QUERIES.md)
* **Mutations** — merging & optimistic writes: [MUTATIONS.md](./MUTATIONS.md)
* **Subscriptions** — transport & streaming patterns: [SUBSCRIPTIONS.md](./SUBSCRIPTIONS.md)
