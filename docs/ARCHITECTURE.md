# Connections & Views: Architecture, Semantics, and Usage

**Goal:** a predictable, fast pagination model that:
- Stores data once in a normalized graph.
- Exposes **one shared connection** per logical feed (query + non‑pagination vars).
- Supports **many consumers (“views”)** of that connection at the same time.
- Preserves **stable identity** and **reactivity** with minimal work.
- Handles **forward/backward** paging, **out‑of‑order** arrivals, and **cache‑only expansion**.
- Gives you explicit control over **memory (trimming)** via per‑view windows.

---

## 0) Quick summary

- **Connection scope** = *query + non‑pagination variables* (e.g., `filter`, `search`).
  Pagination vars (`first/last/after/before`) are **excluded** from the key.
- **One connection state per scope** with **one shared `pageInfo`** and **one shared `edges[]`** array.
- **Views (plural)** = *consumer handles* over a connection. Each view tracks its **window/limit** (how many edges it needs alive). The connection keeps an **aggregate window** `state.window = max(view.limit)`.
- **Pagination merges** mutate the shared list **in place**:
  - `after + first` → **append** (tail)
  - `before + last` → **prepend** (head)
  - *Baseline* (no cursor) → initialize/replace visible slice (see “Replace” notes)
- **`pageInfo` is shared**, updated only on actual data merges/resets/trims.
  Each view derives any **per‑view navigation cues** from the shared list + its own window.
- **Entities** are **reactive singletons** (materialized proxies) keyed as `Type:id`.
  **Never clone**; **never replace** containers—mutate in place.

---

## 1) Core data model

### Entities
- **Key:** `EntityKey = "${typename}:${id}"` (e.g., `Post:1`).
- **Store:** `Map<EntityKey, Record<string, any>>`.
- **Materialization:** return a **reactive proxy** per entity; the *same* proxy everywhere.

### Connections (per scope)
```ts
type Edge = { cursor: string; node: any /* entity proxy */ };

type ConnectionState = {
  list: Edge[];                        // stable reactive array
  pageInfo: {
    startCursor?: string;
    endCursor?: string;
    hasPreviousPage?: boolean;
    hasNextPage?: boolean;
  };                                   // stable reactive object (shared)
  meta: Record<string, any>;           // optional, shallowReactive
  views: Set<View>;                    // registered consumers
  window: number;                      // aggregate: max(view.limit)
  keySet: Set<string>;                 // dedup (cursor and/or node id)
  initialized: boolean;
  __key: string;                       // connection key for debugging
};
type View = { id: symbol; limit: number /* per‑consumer window */ };
```

### Connection key (scope)
- Build from *non‑pagination* variables only.
- If you need truly independent feeds for the same server args, add a **client‑only extra key** (e.g., `viewKey`) to the connection keyer.

```ts
// Pseudo:
function connectionKey(field: string, args: Record<string, any>, filters: string[], extraKey?: string) {
  const scoped = Object.fromEntries(filters.map(k => [k, args[k]]));
  return `${field}(${stableStringify(scoped)}${extraKey ? `,view:${extraKey}` : ''})`;
}
```

---

## 2) Reactivity (“materialization”)

**Never deep clone.** Entities and connections are exposed as **live proxies**:
- Each entity proxy is **cached** (WeakRef) so repeated reads return the **same** object.
- Updating the entity store **overlays** fields into the **existing proxy** (in place).
- Connection containers (`list`, `pageInfo`) are **stable objects**; merges **mutate** them.

**Reference snippet (entities):**
```ts
const HAS_WEAKREF = typeof WeakRef !== 'undefined';
const MATERIALIZED = new Map<string, WeakRef<any>>();
const entityStore  = new Map<string, Record<string, any>>();

function overlay(dst: any, src: Record<string, any>) {
  for (const k of Object.keys(src)) {
    dst[k] = (k === 'id' && src.id != null) ? String(src.id) : src[k];
  }
}

export function materializeEntity(key: string) {
  if (HAS_WEAKREF) {
    const wr = MATERIALIZED.get(key) as WeakRef<any> | undefined;
    const hit = wr?.deref?.();
    const src = entityStore.get(key);
    if (hit) { if (src) overlay(hit, src); return hit; }
    if (wr) MATERIALIZED.delete(key);

    const [typename, id] = key.includes(':') ? key.split(':') : [key, undefined];
    const raw: any = { __typename: typename, ...(id ? { id: String(id) } : {}) };
    if (src) overlay(raw, src);
    const proxy = reactive(raw);
    MATERIALIZED.set(key, new WeakRef(proxy));
    return proxy;
  }

  // Fallback (no WeakRef)
  const [typename, id] = key.includes(':') ? key.split(':') : [key, undefined];
  const raw: any = { __typename: typename, ...(id ? { id: String(id) } : {}) };
  const src = entityStore.get(key);
  if (src) overlay(raw, src);
  return reactive(raw);
}
```
> **Do not** use `structuredClone`—it breaks identity and adds allocation.

---

## 3) Watching efficiently (skip the global scan)

Avoid “scan all watchers” ticks. Use **reverse dependency index + versions**:

- `entityVersion: Map<EntityKey, number>` — increment on any field change.
- `depIndex: Map<EntityKey, Set<WatcherId>>` — which watchers depend on the entity.
- Each watcher holds `seen: Map<EntityKey, number>`.

On write: bump the entity’s version and add it to `changedEntities`.
On tick: for each changed entity, notify only watchers in `depIndex.get(key)` where `seen.get(key) != entityVersion.get(key)`.

This yields **O(changedEntities + affectedWatchers)** work.

---

## 4) Pagination semantics

**Transforms** (host‑controlled):
- `after != null` + `first` → **append** (tail).
- `before != null` + `last`  → **prepend** (head).
- No cursor → **baseline/reset** (initialize or replace visible slice; see below).

**Merging algorithm (simplified):**
```ts
function mergeEdges(state: ConnectionState, incoming: Edge[], direction: 'append'|'prepend') {
  let headAdded = 0, tailAdded = 0;

  if (direction === 'append') {
    for (const e of incoming) {
      const key = e.cursor; // or `${e.node.__typename}:${e.node.id}`
      if (state.keySet.has(key)) continue;
      state.keySet.add(key);
      state.list.push(e); tailAdded++;
    }
  } else {
    for (let i=incoming.length-1; i>=0; i--) {
      const e = incoming[i];
      const key = e.cursor;
      if (state.keySet.has(key)) continue;
      state.keySet.add(key);
      state.list.unshift(e); headAdded++;
    }
  }

  // cursors always derived from ends
  state.pageInfo.startCursor = state.list[0]?.cursor;
  state.pageInfo.endCursor   = state.list[state.list.length - 1]?.cursor;

  return { headAdded, tailAdded };
}
```

**Out‑of‑order (“cursor replay”)**
If a page arrives whose anchor isn’t present yet, stash it and apply once the anchor appears (either direction). This prevents corruption when page 3 lands before page 2.

**Replace mode**
Destructive “replace this page only” complicates multi‑view sharing. Prefer to:
- Keep the shared list as a **superset** and let that view **render a slice**, or
- Split scopes with a synthetic `viewKey` so consumers don’t fight.

---

## 5) Shared `pageInfo`: when & how to update

**Update only when the data changes** (merge/reset/trim). **Never** for a view window change.

- **Forward merge (append)**:
  - Set `endCursor = last(list).cursor`.
  - Set `hasNextPage` from payload if present; don’t touch `hasPreviousPage`.
- **Backward merge (prepend)**:
  - Set `startCursor = first(list).cursor`.
  - Set `hasPreviousPage` from payload if present; don’t touch `hasNextPage`.
- **Baseline/reset**:
  - Set both cursors from the ends.
  - If provided, set both booleans.
- **Trim**:
  - Recompute cursors from ends.
  - **Leave booleans as last known** (they indicate server availability, not local retention).

**Don’t regress booleans** on stale pages (pages that didn’t grow the side).

---

## 6) Views: windows, anchors, and navigation

- Each mounted `useQuery` is a **view** (consumer) of the shared connection.
- A view tracks **`limit`**: how many edges it needs alive (UI window + overscan).
- The connection maintains `state.window = max(view.limit)` so trimming never drops below what any active consumer needs.

**Registering a view:**
```ts
function acquireView(state: ConnectionState, initialLimit = 0) {
  const view: View = { id: Symbol('view'), limit: initialLimit };
  state.views.add(view);
  state.window = Math.max(state.window, view.limit);

  function setLimit(n: number) {
    if (n === view.limit) return;
    view.limit = n;
    let w = 0; for (const v of state.views) w = Math.max(w, v.limit);
    state.window = w;
  }

  function release() {
    state.views.delete(view);
    let w = 0; for (const v of state.views) w = Math.max(w, v.limit);
    state.window = w;
  }

  return { view, setLimit, release };
}
```

**Deriving per‑view navigation (computed, not stored):**
```ts
function deriveViewInfo(state: ConnectionState, view: View) {
  const edges = state.list;
  const endIdx = Math.min(view.limit, edges.length) - 1;
  const startIdx = 0; // or your view's start if not head-anchored

  const endCursorForView = endIdx >= 0 ? edges[endIdx].cursor : undefined;

  const hasMoreFromCacheTail = edges.length > view.limit;
  const hasMoreFromCacheHead = startIdx > 0;

  return {
    endCursorForView,
    canLoadNext: hasMoreFromCacheTail || !!state.pageInfo.hasNextPage,
    canLoadPrev: hasMoreFromCacheHead || !!state.pageInfo.hasPreviousPage,
  };
}
```

**Which page will “Next” load?**
Two valid policies:

- **Per‑view anchor (recommended UX):**
  Use `endCursorForView`.
  - If page 2 is already cached (fetched by another view), just **increase view.limit**; no network.
  - Next click fetches page 3.

- **Union‑tail anchor:**
  Use `state.pageInfo.endCursor` to jump beyond anything cached so far (e.g., straight to page 3).

**Tagging requests with the initiating view** (so only that view’s limit grows):
```ts
const inflightByOp = new Map<number, View>();

function onExecute(opKey: number, state: ConnectionState, view: View, vars: any) {
  inflightByOp.set(opKey, view);
  const req = (vars.first ?? vars.last ?? 0) | 0;
  if (req > 0) setViewLimit(view, Math.max(view.limit, visibleCount(state.list) + req));
}

function onMerged(opKey: number, state: ConnectionState) {
  const v = inflightByOp.get(opKey); inflightByOp.delete(opKey);
  if (v) setViewLimit(v, Math.max(v.limit, state.list.length));
}
```

---

## 7) Memory & trimming

- Trim only under back‑pressure or by policy, and **never below `state.window`**.
- Optional: separate `headWindow` / `tailWindow` if you require asymmetric retention.

---

## 8) Suspense vs non‑Suspense & cache policy

- **Non‑Suspense**: render immediately; if `cachePolicy` hits (`cache-first`, `cache-and-network`), data appears instantly and a later network revalidate updates it.
- **Suspense**: initial render waits unless there’s a sync cache hit; after first paint, behavior is identical.
- **Seeded pages** can be shown immediately (tests do this with `seedCache`).

---

## 9) Custom connection shapes

If your API doesn’t use `edges` / `pageInfo`:
- Configure paths once (e.g., `edges:'items'`, `node:'item.node'`, `pageInfo:'meta'`).
- Your merging logic works the same; only selectors change.

---

## 10) Pitfalls & best practices

**Avoid**
- Copying reactive data (`{...data.value.posts}` / `[...edges]`) and then using the copy forever — you’ll miss live updates.
- Imperatively mutating `data.value.posts.edges` from components — always drive via variables; let the connection resolver merge/dedup.
- Missing `__typename` or stable `id` — entities won’t normalize.
- Reassigning containers (`state.list = newArray`) — mutate in place.
- Regressing `hasNextPage/hasPreviousPage` on stale/non‑extending pages.

**Do**
- Normalize ids to **strings** consistently (`String(id)`).
- Keep `keySet` for O(pageSize) dedup.
- Use **per‑view window** + **aggregate window** to guard trimming.
- Split scopes with a **client‑only `viewKey`** if you need independent feeds.

---

## 11) How this maps to Apollo & Relay

| Concern | Apollo | Relay | This design |
|---|---|---|---|
| Normalized store | ✅ InMemoryCache | ✅ Modern Store | ✅ Map stores + materialization |
| One connection per non‑pagination scope | ✅ `keyArgs` | ✅ `@connection(filters)` | ✅ connection key (filters) |
| Append/prepend & cursor replay | ✅ `relayStylePagination` | ✅ ConnectionHandler | ✅ merge algorithm + replay |
| Shared `pageInfo` | ✅ | ✅ | ✅ |
| Per‑view windows | ❌ | ❌ | ✅ (views + `state.window`) |
| Dep‑driven invalidation | ✅ (optimism deps) | ✅ (selector deps) | ✅ (dep index + versions) |
| GC/retention | ✅ | ✅ | Trimming + eviction policy |

---

## 12) Reference: update `pageInfo` on merge

```ts
function updatePageInfoOnMerge(
  state: ConnectionState,
  payload: { edges?: Edge[]; pageInfo?: any },
  vars: { first?: number; last?: number; after?: string; before?: string },
  stats: { headAdded: number; tailAdded: number }
) {
  const list = state.list;
  const firstEdge = list[0];
  const lastEdge  = list[list.length - 1];
  const isFwd = vars.after != null;
  const isBack = vars.before != null;

  if (isFwd && stats.tailAdded > 0) {
    state.pageInfo.endCursor = lastEdge?.cursor;
    if (payload.pageInfo && 'hasNextPage' in payload.pageInfo)
      state.pageInfo.hasNextPage = !!payload.pageInfo.hasNextPage;
  }
  if (isBack && stats.headAdded > 0) {
    state.pageInfo.startCursor = firstEdge?.cursor;
    if (payload.pageInfo && 'hasPreviousPage' in payload.pageInfo)
      state.pageInfo.hasPreviousPage = !!payload.pageInfo.hasPreviousPage;
  }
  if (!isFwd && !isBack) {
    state.pageInfo.startCursor = firstEdge?.cursor;
    state.pageInfo.endCursor   = lastEdge?.cursor;
    if (payload.pageInfo) {
      if ('hasPreviousPage' in payload.pageInfo) state.pageInfo.hasPreviousPage = !!payload.pageInfo.hasPreviousPage;
      if ('hasNextPage'     in payload.pageInfo) state.pageInfo.hasNextPage     = !!payload.pageInfo.hasNextPage;
    }
  }
}
```

---

## 13) FAQ

**Q: Why not give each view its own `pageInfo`?**
A: `pageInfo` describes the **connection** (union extents). Per‑view info is **derived**, not stored, to avoid duplication and write amplification.

**Q: If two views paginate differently, do they fight?**
A: Not if both use append/prepend. For destructive “replace” semantics, either render a slice in that view or split scopes via `viewKey`.

**Q: Which page does “Next” load when another view already fetched the next page?**
A: With the **per‑view anchor** policy, it loads the page after the view’s last visible edge; if that page is cached, it expands without network. Using the **union tail** anchor jumps straight to the newest beyond all cached pages.

---

## 14) Testing checklist (what our tests assert)

- Append, Prepend, Replace behaviors mutate the **same** `edges` array.
- Custom shapes (`items`/`meta`) work via configured paths.
- Host‑controlled transformations: `after` → append, `before` → prepend.
- Cursor replay: older pages apply after newer “leader” arrives.
- A→B→A flows: reset and cached append without network; slow revalidate updates later.
- Suspense and non‑Suspense variants behave identically post‑paint.
- Proxy invariants: entities and containers are **reactive** and keep **identity** across executions.

---

### That’s it
With this model, your cache remains **correct** (Relay/Apollo semantics) and becomes **more ergonomic & performant** for multi‑consumer UIs via **views** and **windows**—without duplicating data or fighting over list ownership.
