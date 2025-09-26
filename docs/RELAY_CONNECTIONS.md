
# Relay Connections — How to use them

Cachebay provides first-class support for Relay-style, cursor-based pagination— making it straightforward to request, cache, and navigate paginated data using standardized connection patterns.

---

## The `@connection` directive

Annotate list fields you want treated as Relay connections.

```graphql
query Posts($category: String, $first: Int, $after: String) {
  posts(category: $category, first: $first, after: $after) @connection(mode: "infinite", filters: ["category"]) {
    pageInfo {
      startCursor
      endCursor
      hasNextPage
      hasPreviousPage
    }

    edges {
      cursor # Optional

      node {
        id
        title
      }
    }
  }
}
```

- **`mode`**
  - `"infinite"` (default): merge pages into a growing union (append / prepend).
  - `"page"`: the last fetched page **replaces** the visible window.
- **`filters`** — list the **non-cursor** args that define identity (here: `category`).

### Isolating multiple views of the same field

Give the connection a stable directive **key**. Each key produces an independent canonical list.

```graphql
# Feed results  (kept separate from search)
posts(category: $category, first: $first, after: $after)
  @connection(key: "feed", mode: "infinite", filters: ["category"]) {
  pageInfo { endCursor hasNextPage }
  edges { cursor node { __typename id title } }
}

# Search results (kept separate from feed)
posts(category: $category, first: $first, after: $after)
  @connection(key: "search", mode: "page", filters: ["category"]) {
  pageInfo { startCursor endCursor hasNextPage hasPreviousPage }
  edges { cursor node { __typename id title } }
}
```

---

## How merges work

### `mode: "infinite"` (append/prepend)

- New edges append (or prepend) to the canonical list.
- If a node already exists (by `__typename:id`), its **edge meta (incl. cursor)** is **refreshed in place**—no duplicates.
- `pageInfo` is shallow-updated (e.g., `endCursor`, `hasNextPage`).
- Extra fields returned at the connection level (e.g., `totalCount`) are **shallow-merged on the connection object**.

### `mode: "page"` (replace)

- The visible window is **replaced** by the last fetched page.
- `pageInfo` reflects that page; connection-level fields are shallow-merged.

---

## Cache policies

- **cache-first** — if cached, render cached and stop; else wait for network.
- **cache-and-network** — if cached, render cached immediately **and** revalidate via network; if not cached, fetch then render.
- **network-only** — always request from network.
- **cache-only** — render cached or raise `CacheOnlyMiss` (no network).

Use any policy with either `mode`.

---

## Out-of-order, retries, and idempotency

Connections are designed to be **idempotent**:

- **Out-of-order pages** (e.g., page 2 before page 1) merge safely. The canonical list is ordered by the leader slice (no-cursor request) plus `before`/`after` hints.
- **Retriggered pages** (replays, retries) simply refresh edge meta/cursors **in place** and won’t duplicate nodes.
- **Transient failures** can be retried without special handling; merges remain deterministic and de-duplicated.

---

## Recipes

### Infinite feed (append)

```ts
import { useQuery } from 'villus'

const variables = reactive({
  category: 'tech',
  first: 10,
  after: null as string | null,
})

const { data } = useQuery({
  query: `
    query Posts($category: String, $first: Int, $after: String) {
      posts(category: $category, first: $first, after: $after) @connection(mode: "infinite", filters: ["category"]) {
        pageInfo {
          endCursor
          hasNextPage
        }

        edges {
          cursor # Optional

          node {
            id
            title
          }
        }
      }
    }
  `,
  variables,

  cachePolicy: 'cache-and-network', // Override per request
})

// Load next page by updating reactive variables
function loadMore() {
  const pageInfo = data.value?.posts?.pageInfo

  if (pageInfo?.hasNextPage) {
    variables.after = pageInfo.endCursor;
  }
}
```

### Strict paging (replace)

```ts
import { useQuery } from 'villus'

const variables = reactive({
  category: 'tech',
  first: 10,
  after: null as string | null,
})

const { data } = useQuery({
  query: `
    query Posts($category: String, $first: Int, $after: String) {
      posts(category: $category, first: $first, after: $after) @connection(mode: "page", filters: ["category"]) {
        pageInfo {
          endCursor
          hasNextPage
        }

        edges {
          cursor # Optional

          node {
            id
            title
          }
        }
      }
    }
  `,

  variables,

  cachePolicy: 'cache-first', // Override per request
})
```

## See also

- **Optimistic updates** — layering, `patch` / `delete`, connection helpers: [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
- **SSR** — hydrate/dehydrate, first-mount requests behavior: [SSR.md](./SSR.md)
- **Fragments** — identify/read/write & interface keys: [FRAGMENTS.md](./CACHE_FRAGMENTS.md)
