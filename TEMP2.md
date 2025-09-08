Core query & cache-policy matrix

Cover each with slow/fast network variants + out-of-order results
	•	cache-first
	•	With cache miss → single network request, render on response.
	•	With cache hit → render immediately from cache; no network if configured not to; otherwise verify one network and no double render of identical object.
	•	cache-and-network
	•	With cache hit → render immediately from cache; network arrives later → re-render once.
	•	With cache miss → behaves like network-only until first response.
	•	network-only
	•	Never reads cache; renders only when network returns.
	•	cache-only
	•	With cache hit → render immediately.
	•	With cache miss → no render; no network.

Relay connections (end-to-end)

Run each with all cache policies where relevant
	•	Modes: replace, append, prepend.
	•	Edge behavior
	•	Dedup by node key (id+typename) across pages; edge meta updates in place.
	•	pageInfo merge semantics (next/prev flags, cursors) across pages.
	•	Write policy: entity merge vs replace effects on fields not present in payload.
	•	Custom paths: alternative edges/node/pageInfo paths (e.g., items, item.node, meta).
	•	Cursor replay: older page results (after/before) are allowed to apply even if a newer family member exists (take-latest exception).

Take-latest, dedup & concurrency scope
	•	Basic take-latest: Older op finishes after newer → older is dropped (no empty payload).
	•	Cursor exception: Older cursor page allowed to apply after the latest.
	•	Scope isolation: Same query in concurrencyScope:A and B → both deliver.
	•	No follower blanking: Attaching new leaders during rapid switching should not emit {} or undefined data (no “undefined edges”).

UI latency / tab switching flows
	•	A→C→D (pending) → B (immediate) → C (final): stays on last good (A → B) until C arrives; no blanks.
	•	A→B→C→A→B→C (final C): renders A then C only; older in-flights (B1/C1) never render.
	•	“Return to cached tab”: revisiting a tab with identical cached object must not re-emit duplicate render (skip identical reference).

Non-Relay result tracking
	•	trackNonRelayResults=true: object links are reactive—writeFragment immediately updates published arrays/objects.
	•	trackNonRelayResults=false: no reactive linking—published arrays stay static until re-query.

Optimistic updates (entities & connections)
	•	Entity
	•	write+commit, then revert restores previous snapshot.
	•	Layering: T1 & T2; revert T1 preserves T2; revert T2 restores T1; final revert returns to baseline.
	•	Connection
	•	addNode at start/end, removeNode, updatePageInfo.
	•	Dedup keys on optimistic add; re-add after remove inserts at specified position.
	•	Invalid nodes (missing id/__typename) are ignored safely.
	•	Layering + revert sequence on connections (state list/pageInfo integrity).

1 SSR / hydration
	•	Dehydrate on server → hydrate on client
	•	Entities and connections restored; views bound (edges/pageInfo are reactive).
	•	Hydration tickets
	•	cache-first on client should not refetch initially when server already fetched (ticket present).
	•	cache-and-network respects “no initial refetch” during hydration; subsequent variable change triggers network.
	•	Initial render
	•	Client receives SSR HTML + state; first render on client uses hydrated cache (no flash/empty arrays).

Operation identity & keys (object-hash)
	•	operationKey stability: same body + variables (different key order) → same key.
	•	familyKey includes scope: different concurrencyScope → different family.
	•	connectionKey: ignores cursor args and is deep order-independent.

2 Errors
	•	Network/GraphQL error
	•	Latest-only gating for non-cursor errors.
	•	Cursor page error replay rules (if you allow).
	•	No “empty” emission before/after error.
	•	Transport reordering: multiple ops complete out of order; asserts above behaviors hold.

4 edgecases + Performance/behavior guards (assertions sprinkled across flows) + &
	•	Never emit empty payloads to consumers (no {}, undefined, or missing edges).
	•	Single render per logical result: no triple-renders on cache-first + network unless data is actually different.
	•	No array churn in relay views: edges array length only grows/shrinks as expected; entries mutate in place (where applicable).
	•	Cache eviction (LRU)
	•	Hit op-cache max → oldest evicted; next cache-first with evicted key should not render immediately.
	•	Interface reads: Node:* returns concrete implementors, both keys and materialized objects.

0 Fragments & interfaces (consumer APIs)
	•	useFragment (ref & static) updates on entity change; asObject returns stable non-ref snapshot.
	•	useFragments (selector) reacts to entity add/remove; raw vs materialized.

GC & lifecycle
	•	Connection GC: removing all views & empty list allows GC of connection state (if you expose gc.connections).
	•	Unmount/remount: subscriptions or watchers don’t leak in-flight dedup/take-latest state; re-mounted component still receives future results correctly.

Subscriptions (if in scope now or later)
	•	Ably/websocket payload → resolver runs before publish; non-relay linking works; relay append/prepend on subscription events.
