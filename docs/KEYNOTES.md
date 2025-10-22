# Keynotes

This note sketches how Cachebay works at a high level—what the graph stores, how pages merge, how optimistic layers roll back, and how SSR/Suspense are handled. It’s a white-paper overview, not an API guide.

---

## 1) Core model: a normalized graph

Everything is kept in a single, normalized **graph**:

- **Entities** — one record per `Type:id` (e.g., `Post:42`) containing field snapshots.
- **Edges** — tiny records that carry **edge meta** (e.g., `cursor`, `score`) and a **pointer** to an entity:
  ```json
  { "__typename":"PostEdge", "cursor":"p42", "node": { "__ref":"Post:42" } }
  ```
- **Connections** — records with:
  - `edges: [{ "__ref": "<EdgeKey>" }, ...]`
  - `pageInfo: { ... }` (reactive)
  - any extra **connection-level fields** your server returns (merged shallowly)
- **Pages** — concrete page slices (e.g., `@.posts({"first":2,"after":"p2"})`) whose `edges[]` are re-used by the canonical list.

Pointers are simple `__ref` strings; views “chase” refs—no deep tree copies—so updates are fast, deterministic, and shared across components.

---

## 2) The plan: what to fetch vs what to cache

Each document is compiled into a **plan**:

- Produces a **network query** (client directives stripped, `__typename` ensured).
- Marks **connection fields** (mode, filters) and builds helpers to map variables → keys.
- Keeps enough metadata so we can normalize, canonicalize, and read views predictably.

This is small and deterministic—turns UI intent into cache keys.

---

## 3) Documents: normalize → canonicalize → materialize

**Normalize**
Network frames are written as entities, edges, and **page** records.

**Canonicalize**
For every connection key:
- **infinite**: append/prepend page edges into a **growing union**; **de-dup by node key** and **refresh** kept edge meta (cursor/score/etc) in place.
- **page**: **replace** the visible window with the last page.
- `pageInfo` and any connection-level fields are **shallow-merged**.

Ordering is anchored by the **leader** (no cursor). “After” extends the tail; “before” extends the head. **Out-of-order** arrivals converge to the same canonical list.

**Materialize**
Views are **reactive proxies**:
- `edges[]` containers are **stable**; their contents update (no array churn).
- `pageInfo` & connection fields are reactive.
- `edge.node` is a **shared entity proxy**; the same object appears everywhere.

---

## 4) Optimistic engine: layered & reconstructive

`modifyOptimistic()` creates a **layer** that applies immediately:

- Entities: `patch('Type:id', {...}, { mode })`, `delete('Type:id')`
- Connections: `addNode(...)`, `removeNode(...)`, `patch(...)` (incl. `pageInfo`)

`commit()` keeps the layer. `revert()` **removes only that layer**, then Cachebay:
1) Restores earliest baselines,
2) Rebuilds canonical lists from recorded pages,
3) Replays remaining layers.

This avoids fragile diffing; final state is **correct and deterministic**.

---

## 5) Villus plugin: policies, SSR, Suspense windows

- **Policies**
  - `cache-only`: serve cache or `CacheMiss`.
  - `cache-first`: cached terminal else one network.
  - `cache-and-network`: cached immediately **and** revalidate.
  - `network-only`: always network.

- **SSR**
  - `dehydrate()` → JSON snapshot (entities, pages, edges, connections).
  - `hydrate()` → restore snapshot; first CN mount renders **cached without duplicate fetch**, then CN behaves normally.

- **Suspense windows**
  - A tiny **hydration window** suppresses the first CN refetch after hydrate.
  - A tiny **suspension window** suppresses immediate Suspense re-exec duplicates by serving cached terminally instead of refetching.
  - These are **UX guards**, not correctness knobs.

- **Mutations & subscriptions**
  - Mutations normalize side effects and **forward the original payload**.
  - Subscriptions stream normalized frames as **non-terminating** updates.

---

## 6) Identity: keys & interfaces

- **Keys** — optional per-type functions define how to compute `Type:id`.
- **Interfaces** — map parent → concrete types (e.g., `Post: ['AudioPost','VideoPost']`) so `readFragment('Post:42')` can target the concrete record and connection de-dup works across unions.

---

## 7) Performance principles

- **Microtask batching** — write bursts collapse; UIs update once per tick.
- **Zero array churn** — container arrays stay; elements mutate in place.
- **Pointer-chasing only** — `__ref` hops and O(1) map lookups; **no deep tree walks**.
- **No spread storms** — shallow merges where needed; avoid full-object cloning.
- **Idempotent merges** — replays, retries, out-of-order pages converge.
- **Small hot path** — plans are cached; read costs stay flat.

---

## 8) Failure & edge cases

- **Network errors**: passed through; graph untouched.
- **Out-of-order pages**: still merge deterministically.
- **Duplicates**: suppressed; kept edge’s meta is refreshed.
- **Relative insert (optimistic)**: if anchor is missing, `before` ⇒ start, `after` ⇒ end.

---

## 9) Data flow (at a glance)

```text
          ┌──────────┐
Network ─▶│ Normalize│───▶ Entities / Edges / Page records
          └────┬─────┘
               │
               ▼
          ┌─────────────┐     (mode-aware merge, de-dup by node key,
          │ Canonicalize│───▶  refresh kept edge meta, update pageInfo/fields)
          └────┬────────┘
               │
               ▼
     (if any) Reapply optimistic layers (layered, reconstructive)
               │
               ▼
          ┌────────────┐
          │ Materialize│───▶ Reactive views (edges[], pageInfo, shared node proxies)
          └────┬───────┘
               │
               ▼
          Publish (policy-aware; SSR/Suspense windows considered)
```

The graph is the single source of truth; views are reactive projections of it.

---

## 10) Compiler mode (alpha)

- **Compiler mode (alpha)** pre-analyzes documents (queries & fragments) ahead of time:
  - strips client directives,
  - stamps connection metadata (mode, filters),
  - inlines selection knowledge to fast-path normalization/materialization.

  The aim is to trim per-request work and improve hot-path predictability on large trees.

MIT © LockVoid Labs ~●~
