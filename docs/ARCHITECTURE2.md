
# Architecture at-a-glance

- **compiler** (`@connection` directive → plan)
  - emits `PlanField`s with:
    - `isConnection === true` only when `@connection` is present
    - `connectionArgs?: string[]` (identity args; default = all non-pagination args)
    - `connectionMode?: "infinite" | "page"` (metadata; default "infinite")
    - `selectionSet` + `selectionMap` (+ `rootSelectionMap`)
    - `buildArgs(rawVars)` and `stringifyArgs(rawVars)`
- **graph** (low-level normalized record store)
  - `putRecord/getRecord/materializeRecord` (reactive proxy per record)
- **views** (reactive view wrappers, WeakMap cache)
  - `getEntityView(proxy, selectionSet, selectionMap, vars)`
  - `getConnectionView(pageKey, field, vars)` (page is reactive; `pageInfo` is plain)
  - `getEdgeView(edgeKey, nodeField, vars)`
- **documents** (operation layer)
  - `normalizeDocument({ document, variables, data })` → **writes pages**, never merges
  - `materializeDocument({ document, variables })` → **one page view** per connection
  - `hasDocument({ document, variables })` → **cache presence** for top-level fields
- **fragments** (entity-scoped layer)
  - `readFragment({ id, fragment, variables })` → reactive entity view
  - `writeFragment({ id, fragment, data, variables })` → targeted partial writes
- **sessions** (read-time composition)
  - provides **connection composers** per `useQuery` (or per container)
  - **accumulate pages** on read; choose `"infinite"` or `"page"` **per session**
  - no writes, no traversal—just compose existing page records

---

# Sessions: model & API

A **session** is created per `useQuery` (lifecycle = component instance). It owns any number of **connection composers** keyed by an identity (field + parent + identity args).

## Session API (conceptual)

```ts
type DedupeStrategy = "cursor" | "node" | "edgeRef";

type MountConnectionOptions = {
  /** Identity key this composer represents (filters-only; stable across pagination) */
  identityKey: string;
  /** Page composition policy for this container; default "infinite" */
  mode?: "infinite" | "page";
  /** Dedupe strategy; default "cursor" */
  dedupeBy?: DedupeStrategy;
};

type ConnectionComposer = {
  /** add a concrete page key (full args, including pagination) */
  addPage: (pageKey: string) => void;
  /** remove a previously added page key */
  removePage: (pageKey: string) => void;
  /** for mode:"page": choose which page to expose */
  setActivePage: (pageKey: string | null) => void;
  /** clear all pages */
  clear: () => void;
  /** reactive composed view (read-time concatenation) */
  getView: () => {
    __typename: string;
    pageInfo?: any; // from active page (mode:"page") or latest page (mode:"infinite"), unchanged by us
    edges: Array<any>; // composed edge views (reactive), deduped
  };
  /** inspect pages & state (for tests/devtools) */
  inspect: () => { pages: string[]; mode: string; dedupeBy: string };
};

type Session = {
  /** obtain or create a composer for an identity; returns same composer on repeated calls */
  mountConnection: (opts: MountConnectionOptions) => ConnectionComposer;
  /** convenience: if you need to hold specific records (rare) */
  mountRecord: (recordId: string) => any; // reactive proxy
  /** dump local state */
  inspect: () => { connections: string[] };
  /** destroy this session (drop references) */
  destroy: () => void;
};

type Sessions = {
  createSession: () => Session;
};
```

### How a composer works internally (read-only, reactive)

- **identity:** e.g. `@.User:u1.posts({"category":"tech"})`
  - built from `PlanField.connectionArgs` + parent record id (no pagination args)
- **pages:** concrete **page keys** from the normalized cache, e.g.
  - `@.User:u1.posts({"category":"tech","first":10,"after":null})`
  - `@.User:u1.posts({"category":"tech","first":10,"after":"p2"})`
- **edges:** the composer reads each page via `views.getConnectionView(pageKey, field, vars)`, collects `edges[]`, and **dedupes** using `dedupeBy`:
  - `"cursor"`: drop the second of duplicate cursors
  - `"node"`: drop the second where `edge.node.__ref` repeats
  - `"edgeRef"`: drop identical edge record refs (lowest-level)

> Page records and edge views are still **reactive** via `views`. The composer only manages which edges to expose.

---

# plugin.ts: mounting flow (villus hook)

The plugin (or your `useQuery` wrapper) does three things per request:

1) **Decide from cache**
   `documents.hasDocument({ document, variables })`
   - cache-first: if true, return the cached view immediately
   - cache-and-network: if true, return cached view & still fetch

2) **Mount connection composers** (root + common nested)
   use the **compiled plan** (no result traversal) and current cache:

- **Root connections:**
  - for each `field` in `plan.root` with `isConnection`:
    - compute **identity key** (filters-only):
      `identityKey = buildConnectionIdentityKey(field, ROOT_ID, vars)`
    - create composer:
      `const conn = session.mountConnection({ identityKey, mode: field.connectionMode ?? "infinite", dedupeBy: "cursor" })`
    - compute **page key** (full args):
      `pageKey = buildConnectionKey(field, ROOT_ID, vars)`
    - if `graph.getRecord(pageKey)`, then `conn.addPage(pageKey)`

- **Nested single-parent connections** (e.g. `post(id:$id){ comments @connection }`):
  - find root **parent** field in `plan.root` (e.g. `post`) and its child connection (e.g. `comments`)
  - compute **parent link key** (for `post`): `buildFieldKey(parentField, vars)`
  - read **parent id** from the root snapshot once:
    `parentId = graph.getRecord(ROOT_ID)[parentLinkKey]?.__ref` (e.g. `"Post:p1"`)
  - if present:
    - `identityKey = buildConnectionIdentityKey(commentsField, parentId, vars)`
    - composer: `session.mountConnection({ identityKey, mode: commentsField.connectionMode ?? "infinite" })`
    - `pageKey = buildConnectionKey(commentsField, parentId, vars)`
    - if `graph.getRecord(pageKey)`, `conn.addPage(pageKey)`

> For multi-parent lists (e.g. `users → edges → node → posts`), you can opt-in to enumerate parents by reading the **root page record’s** `edges[].node.__ref` (no payload traversal), then mounting a composer per parent entity.

3) **On network success**
   - `documents.normalizeDocument({ document, variables: nextVars, data })` → writes the **next page** only
   - compute next **page key** (from plan + vars) and **identity key** (filters-only)
   - `conn.addPage(pageKey)` → composer dedupes; reactive view updates

---

## plugin.ts – concrete sketch

```ts
import { createSessions } from "@/src/core/sessions";
import { buildConnectionKey, buildConnectionIdentityKey, buildFieldKey } from "@/src/core/utils";
import type { DocumentsInstance } from "@/src/core/documents";
import type { PlannerInstance } from "@/src/core/planner";
import { ROOT_ID } from "@/src/core/constants";

export function createVillusAdapter(deps: {
  documents: DocumentsInstance;
  planner: PlannerInstance;
  sessions: ReturnType<typeof createSessions>;
  graph: any;
}) {
  const { documents, planner, sessions, graph } = deps;

  return function useQueryAdapter(document: any, variables: Record<string, any>, opts?: {
    pagination?: Record<string, { mode?: "infinite" | "page"; dedupeBy?: "cursor" | "node" | "edgeRef" }>;
  }) {
    const session = sessions.createSession();

    // 1) cache presence
    const has = documents.hasDocument({ document, variables });

    // 2) materialize current page view for UI
    const view = documents.materializeDocument({ document, variables });

    // 3) mount composers based on plan (no traversal)
    const plan = planner.getPlan(document);

    // root connections
    for (let i = 0; i < plan.root.length; i++) {
      const field = plan.root[i];
      if (!field.isConnection) continue;

      const identityKey = buildConnectionIdentityKey(field, ROOT_ID, variables);
      const mode = opts?.pagination?.[`${plan.rootTypename}.${field.fieldName}`]?.mode
        ?? field.connectionMode
        ?? "infinite";
      const dedupeBy = opts?.pagination?.[`${plan.rootTypename}.${field.fieldName}`]?.dedupeBy
        ?? "cursor";

      const composer = session.mountConnection({ identityKey, mode, dedupeBy });

      const pageKey = buildConnectionKey(field, ROOT_ID, variables);
      if (graph.getRecord(pageKey)) composer.addPage(pageKey);
    }

    // nested single-parent (e.g., post(id){ comments @connection })
    for (let i = 0; i < plan.root.length; i++) {
      const parentField = plan.root[i];
      if (parentField.isConnection) continue; // only single parent root fields

      const parentChildMap = parentField.selectionMap;
      if (!parentChildMap) continue;

      // scan for child connections
      for (const [, childField] of parentChildMap) {
        if (!childField.isConnection) continue;

        // get parent id once from root link
        const parentLinkKey = buildFieldKey(parentField, variables);
        const rootSnap = graph.getRecord(ROOT_ID) || {};
        const parentRef = rootSnap[parentLinkKey]?.__ref;
        if (!parentRef) continue;

        const identityKey = buildConnectionIdentityKey(childField, parentRef, variables);
        const mode = opts?.pagination?.[`${parentField.fieldName}.${childField.fieldName}`]?.mode
          ?? childField.connectionMode
          ?? "infinite";
        const dedupeBy = opts?.pagination?.[`${parentField.fieldName}.${childField.fieldName}`]?.dedupeBy
          ?? "cursor";

        const composer = session.mountConnection({ identityKey, mode, dedupeBy });

        const pageKey = buildConnectionKey(childField, parentRef, variables);
        if (graph.getRecord(pageKey)) composer.addPage(pageKey);
      }
    }

    // 4) expose helpers to add subsequent pages after network success
    const addPage = (fieldPath: { parentId?: string; field: any; vars: Record<string, any> }) => {
      // fieldPath.field is PlanField or resolved via planner externally
      const parent = fieldPath.parentId ?? ROOT_ID;
      const pageKey = buildConnectionKey(fieldPath.field, parent, fieldPath.vars);
      const identityKey = buildConnectionIdentityKey(fieldPath.field, parent, fieldPath.vars);
      const composer = sessions.getConnection(identityKey) || session.mountConnection({ identityKey, mode: "infinite", dedupeBy: "cursor" });
      composer.addPage(pageKey);
    };

    // consumer still controls network flow; on success they call addPage(...) with the right vars
    return { has, view, session, addPage, destroy: () => session.destroy() };
  };
}
```

> `buildConnectionIdentityKey` is a small helper you can keep near `utils`:
> - it calls `field.buildArgs(vars)`, picks `field.connectionArgs` (filters-only), stable-stringifies, and prefixes with `@.` or `@.<parent>.`, then suffixed with ``.

---

## Why this design works

- **Per-container policy**: session decides `"infinite"` vs `"page"` (and dedupe), not the compiler or cache.
- **Zero write-time merging**: the normalized cache stores **pages** only; read-time composition is local and GC-friendly.
- **No traversal**: plugin uses the **plan** + tiny cache reads (root links, page records) to mount pages. Deep multi-parent mounting is opt-in.
- **Directive-driven clarity**: only `@connection` tags connections; no heuristics.

---

## Next steps (if you like)

- land `buildConnectionIdentityKey(vars)` in `utils` (tiny)
- implement `sessions.createSession()` + `mountConnection` composer (we can code this next)
- wire the villus integration (`useResult`) to:
  - call `documents.hasDocument`
  - call `documents.materializeDocument`
  - mount root/nested single-parent connections as above
  - on network success → `normalizeDocument` → `addPage`

Once we agree on the surface API above, I’ll drop in the **sessions.ts** implementation and a tight **sessions.test.ts** that asserts accumulation + dedupe + mode behavior.
