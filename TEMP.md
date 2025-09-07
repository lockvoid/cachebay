I need you to refactor resolvers/relay. Don't touch the tests. we will do later

here is spec:
# Cachebay Relay: Deep Guide (modes + cache behavior)

This document describes exactly how **Cachebay’s Relay connection** logic behaves for each **mode** (`append | prepend | replace`) under **Villus** cache policies (**cache-first**, **cache-and-network**, plus notes on `cache-only` / `network-only` for completeness). It also covers merging, dedup, view sizing, cursor boundaries, concurrency, SSR, and recommended patterns.

---

## 0) Quick mental model

- **Connection state** (per unique connection key) stores:
  - `list: Array<{ key: EntityKey; cursor: string | null; edge?: Record<string, any> }>`
  - `pageInfo: { ... }` (reactive)
  - `meta: { ... }` (reactive)
  - `views: Set<View>` where each **View** maps the state into a live UI array (`edges`) with a **limit** (how many edges are revealed to users)

- **Mode** decides **how new pages are applied** and **how much of the list becomes visible**:
  - `append`: add items to the end; reveal **one page more** than before
  - `prepend`: add items to the beginning; reveal **one page more**
  - `replace`: show **only** the latest requested page

- **Policy** decides **whether to hit the network if a cached op exists**:
  - `cache-first`: publish from cache and **do not** fetch
  - `cache-and-network`: publish from cache **and still fetch** (revalidate)

- **Dedup + take-latest** prevent replay/flicker when multiple requests race.

> “Reveal” means bumping the **View limit**; the connection state can hold more edges than you show right now.

---

## 1) Operation identity

- `opKey = print(query) + '::' + stableStringify(variables)`
- **Family key**: same query (+ optional concurrency scope) regardless of cursor vars.
  Used for **take-latest** (ignore stale responses).

- **Connection key**:
  `parentKey.fieldName(filteredVars)` where `filteredVars` excludes cursor params (`after/before/first/last`).
  This ensures all pages with the same base filters go into the **same connection state**.

---

## 2) Resolver shape (what Relay expects)

On a connection field (e.g., `Query.assets`), the resolver looks for:

- `edges` (array)
  - each `edge` can contain `cursor` and optional meta fields *besides* `node`
- `node` path (default `"node"`, can be nested like `"item.node"`)
- `pageInfo` (object) — merged in as-is

These paths are configurable in `relay({ edges, node, pageInfo })`.

---

## 3) Modes (authoritative behavior)

### `append` (pagination down / “next page”)

**Write**
- New edges are **added after** existing entries.
- If a `node` key (e.g., `Post:123`) already exists anywhere in the list, that **entry is updated in place** (cursor, edge meta) — no duplicates.

**View sizing**
- The visible **limit** increases by **exactly the page size** when this page is handled.
- Limit never shrinks automatically.

---

### `prepend` (pagination up / “previous page”)

**Write**
- New edges are **added before** existing entries.
- Duplicate nodes update in place.

**View sizing**
- The visible **limit** increases by **exactly the page size**.

---

### `replace` (show a single page)

**Write**
- Before writing, the connection **list is cleared** (destructive) for a fresh page.
- The new page becomes the **entire** list.

**View sizing**
- The visible **limit** is set to **the page size** (only that page is shown).

> This is intentional: `replace` is the “show this page only” mode. Use it for strict paged UIs where you don’t want the rest of the list in view.

---

## 4) Policy matrix

Below we describe what happens **when a cached operation exists** and when it doesn’t.

### A) `cache-first`

- **If cached op exists** → publish cached result, **no network**.
- **Else** → wait for network; publish when it returns.

**Initial tab (page 1):**
- `append`/`prepend`: show **page 1 only** if cached; no fetch.
- `replace`: show **page 1 only** if cached; no fetch.

**Request page 2:**
- `append`/`prepend`: if page-2 cached → **reveal** it immediately; no fetch. Else → fetch then reveal.
- `replace`: if page-2 cached → show **only page-2**; no fetch. Else → fetch then show **only page-2**.

---

### B) `cache-and-network`

- **If cached op exists** → publish cached result **immediately**, **still fetch** (revalidate).
- **Else** → fetch, then publish.

**Initial tab (page 1):**
- `append`/`prepend`: show **page 1 only** from cache, **revalidate** page 1; merge in-place on return.
- `replace`: show **page 1 only** from cache, **revalidate**; result still shows **only page 1**.

**Request page 2:**
- `append`/`prepend`: if page-2 cached → **reveal page-2 immediately**, **still revalidate** page-2; merge in-place on return.
  If not cached → fetch then reveal.
- `replace`: if page-2 cached → **show only page-2 immediately**, **still revalidate**; result replaces in-place.
  If not cached → fetch then show only page-2.

**Multiple quick requests** (e.g., p2 then p3)
- `append`/`prepend`: cached pages become visible immediately; each network response **dedups by key** and **extends limit by page size**; no shrink.
- `replace`: take-latest wins; you end up showing only the **last** requested page.

---

## 5) Smart merge & dedup (details)

- **Entity dedup**: edges are normalized by `node.__typename + ':' + (id || _id)`.
  If an incoming edge targets a node already in `list`, that **entry** is updated; no duplicates added.

- **Edge meta**: any additional edge fields (besides `cursor` and `node`) are merged onto the edge entry.

- **Order**:
  - For `append`, new unique entries are appended in **server order** of the page.
  - For `prepend`, new unique entries are inserted at the **front**, preserving their internal order.
  - Updates to duplicates **do not move** the entry; position is stable.

- **Limit**:
  - `append`/`prepend`: `limit += pageSize` at publish time (cached or network).
  - `replace`: `limit = pageSize`.
  - Limit never auto-decreases; you can programmatically reduce it if your UI requires.

- **pageInfo / meta**:
  - `pageInfo` is **assigned property-wise** from the server response.
  - Any non-edges fields on the connection object are merged into `state.meta` (last writer wins).

---

## 6) Cursor boundaries after data changed mid-chain (e.g., item deleted on page B)

Under `cache-and-network`, keep UX instant and fix correctness **as results return**:

**Policy**

1) **On return**: revalidate **page 1** only (no need to waterfall).
   If its `endCursor` changed, mark the chain **dirty from page 2**.

2) **When a page becomes visible/prefetched**:
   - Compute its **boundary** from its predecessor’s **current** `endCursor`.
   - If we already requested with *that* boundary, skip.
   - Else:
     - If cached page was fetched with **same** boundary: reveal + revalidate (for freshness).
     - If cached page has **different** boundary: reveal **now**, immediately refetch with the **new** boundary; merge/replace in place.

3) **When a page result lands** and its `endCursor` changed:
   - Mark **next page dirty**; if next page is visible/prefetched, re-request with new boundary (only as far as the visible edge).

This avoids network storms and keeps the list cursor-correct as you scroll.

---

## 7) Concurrency & dedup

- **Inflight dedup**: identical queries share one network request; late subscribers receive the result.
- **Take-latest per family**: later requests for the same family (same query + concurrency scope) supersede earlier ones. Older results are ignored if a newer sequence number exists.
- Optional: you can add `AbortController` to cancel obsolete in-flight requests when boundaries change.

---

## 8) SSR/Hydration

- On **hydrate** we reconstruct:
  - `entityStore` (normalized entities)
  - `connectionStore` (edges list + pageInfo/meta)
  - `operationCache` (per-op data)
- **View registration** runs to wire the hydrated connection objects to views.
- With `cache-first`, you’ll publish hydrated ops and **not** fetch.
- With `cache-and-network`, you’ll publish hydrated ops and **revalidate**.

---

## 9) Configuration & usage

### Declare the field as a connection

```ts
import { relay } from '~/lib/villus-cachebay';

const resolvers = () => ({
  Query: {
    assets: relay({
      paginationMode: 'append',         // 'append' | 'prepend' | 'replace' | 'auto'
      writePolicy: 'replace',         // 'merge' | 'replace'
    }),
  },
});
```

> `mode: 'auto'` infers from presence of `after`/`before`:
> - `after != null` → `append`
> - `before != null` → `prepend`
> - otherwise       → `replace` (page 1)

### Queries

```ts
// page 1
useQuery({ query: ASSETS, variables: { first: 20 }, cachePolicy: 'cache-and-network' });

// page 2 (append)
useQuery({ query: ASSETS, variables: { first: 20, after: endCursorOfPage1 }, cachePolicy: 'cache-and-network' });

// page 2 (replace view with only page 2)
useQuery({ query: ASSETS, variables: { first: 20, after: endCursorOfPage1 }, cachePolicy: 'cache-first', context: { cachebayMode: 'replace' } });
```

> If you always want `replace` on the field, set `paginationMode: 'replace'` in `relay(...)`.
> If you want to steer it per-request, pass a small context flag and have a tiny wrapper set `ctx.hint.relayMode` from it.
