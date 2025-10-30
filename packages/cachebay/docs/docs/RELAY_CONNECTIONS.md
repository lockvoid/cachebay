# Relay Connections

Cachebay provides first-class support for Relay-style, cursor-based pagination—making it straightforward to request, cache, and navigate paginated data using standardized connection patterns.

## The  `@connection`  directive

A GraphQL directive that configures how connection fields are cached and merged. Enables declarative pagination handling with automatic edge deduplication, cursor management, and page merging strategies.

**Options:**

- `mode`  - Merge strategy:  `"infinite"`  (append/prepend) or  `"page"`  (replace window)
- `filters`  - Array of non-cursor arguments that define connection identity
- `key`  - Optional stable identifier for isolating multiple views of the same field

**Basic Usage**

```graphql
query Posts($category: String, $first: Int, $after: String) {
  posts(category: $category, first: $first, after: $after)
    @connection(mode: "infinite", filters: ["category"]) {
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

**Isolating Multiple Views**

```graphql
# Feed results (kept separate from search)
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

> **Identity rule of thumb:**  `identity = parent + field + filters (+ key)`. Cursor args (`first/last/after/before`) do  **not**  affect identity.

## How merges work

### `mode: "infinite"`  (append/prepend)

-   New edges append (or prepend) to the canonical list.
-   If a node already exists (by  `__typename:id`), its  **edge meta (incl. cursor)**  is  **refreshed in place**—no duplicates.
-   `pageInfo`  is shallow-updated (e.g.,  `endCursor`,  `hasNextPage`).
-   Extra fields returned at the connection level (e.g.,  `totalCount`) are  **shallow-merged on the connection object**.


### `mode: "page"`  (replace)

-   The visible window is  **replaced**  by the last fetched page.
-   `pageInfo`  reflects that page; connection-level fields are shallow-merged.


## Cache policies

Cache policies determine when and how connection data is fetched and rendered. Can be applied globally during cache creation or overridden per-query to control network behavior and user experience.

**Options:**

-   `cache-first`  - Render cached data if available, skip network request
-   `cache-and-network`  - Render cached data immediately, then revalidate with network
-   `network-only`  - Always fetch from network, ignore cache
-   `cache-only`  - Only use cached data, throw  `CacheMiss`  if not available

Use any policy with either  `mode`.

## Recipes

### Infinite feed (append)

Implements infinite scrolling by appending new pages to existing results. Uses reactive variables to track pagination state and automatically merges new edges while preserving scroll position and user context.

**Options:**

-   Uses  `mode: "infinite"`  for appending behavior
-   `cache-and-network`  policy for immediate rendering with background updates
-   Reactive variables for cursor-based pagination state


**Implementation**

```ts
import { reactive } from 'vue'
import { useQuery } from 'cachebay/vue'

const variables = reactive({
  category: 'tech',
  first: 10,
  after: null,
})

const { data } = useQuery({
  query: `
    query Posts($category: String, $first: Int, $after: String) {
      posts(category: $category, first: $first, after: $after)
        @connection(mode: "infinite", filters: ["category"]) {
        pageInfo {
          endCursor
          hasNextPage
        }

        edges {
          cursor

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
const loadMore = () => {
  const pageInfo = data.value?.posts?.pageInfo

  if (pageInfo?.hasNextPage) {
    variables.after = pageInfo.endCursor
  }
}
```

### Infinite feed (prepend / load previous)

Prepend older items when navigating upward in a chat or timeline.

```ts
import { reactive } from 'vue'
import { useQuery } from 'cachebay/vue'

const variables = reactive({
  category: 'tech',
  last: 10,
  before: null,
})

const { data } = useQuery({
  query: `
    query Posts($category: String, $last: Int, $before: String) {
      posts(category: $category, last: $last, before: $before)
      @connection(mode: "infinite", filters: ["category"]) {
        pageInfo {
          startCursor
          hasPreviousPage
        }

        edges {
          cursor

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

function loadPrevious() {
  const pageInfo = data.value?.posts?.pageInfo

  if (pageInfo?.hasPreviousPage) {
    variables.before = pageInfo.startCursor
  }
}

```

### Strict paging (replace)

Implements traditional pagination where each page replaces the previous view. Suitable for data tables, search results, or scenarios where users navigate between discrete page views rather than accumulating results.

**Options:**

-   Uses  `mode: "page"`  for replacement behavior
-   `cache-first`  policy for fast navigation between previously visited pages
-   Page-based navigation with discrete windows


**Implementation**

```ts
import { reactive } from 'vue'
import { useQuery } from 'cachebay/vue'

const variables = reactive({
  category: 'tech',
  first: 10,
  after: null,
})

const { data } = useQuery({
  query: `
    query Posts($category: String, $first: Int, $after: String) {
      posts(category: $category, first: $first, after: $after)
        @connection(mode: "page", filters: ["category"]) {
        pageInfo {
          endCursor
          hasNextPage
        }

        edges {
          cursor

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

## Next steps

Continue to [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md) to learn about layered optimistic updates for instant UI feedback with clean rollback.

## See also

-   **Queries**  — pagination & variable changes:  [QUERIES.md](./QUERIES.md)
-   **Mutations**  — write merging & connection updates:  [MUTATIONS.md](./MUTATIONS.md)
-   **Optimistic updates**  — layering,  `patch`  /  `delete`, connection helpers:  [OPTIMISTIC_UPDATES.md](./OPTIMISTIC_UPDATES.md)
-   **SSR**  — hydrate/dehydrate, first-mount requests behavior:  [SSR.md](./SSR.md)
