windowed vs cumulative (what each mode means)
	•	cumulative (default in your cachebay):
	•	The view reveals everything that’s already in the connection state.
	•	As more pages land in the cache (from previous requests or SSR/hydrate), the list expands to include them all.
	•	windowed:
	•	The view reveals only the pages you’ve explicitly asked for in this session.
	•	Page 1 request shows 1 page; when you request page 2 (e.g., after: cursor), the window grows by exactly one page; and so on.
	•	Switching away and back should still show only the last requested window, not “all that happens to be cached”.

“Reveal” here means “set the connection view limit” — not whether the data exists. The connection state may already contain more edges; the view decides how many to show.

⸻

how each mode behaves under Villus cache policies

1) cache-first

Initial tab load (page 1)
	•	cumulative:
	•	If any cached data for this connection exists (from earlier sessions/hydrate), it shows all of it immediately.
	•	If nothing cached → do the network once; publish result; no second network pass.
	•	windowed:
	•	If page 1 is cached → show exactly page 1 (not the rest), even if later pages are present in the cache.
	•	If not cached → fetch; publish page 1; stop (no extra request).

When you request page 2 (scroll/paginate with after)
	•	cumulative:
	•	If page 2 op is cached, it appears instantly; no extra network (cache-first).
	•	If not cached → network; then reveal when it returns.
	•	windowed:
	•	If page 2 op is cached → instantly extend the window by one page (now pages 1–2), no network.
	•	If not cached → network; when it returns, extend by one page.

Switching tabs and coming back
	•	cumulative: shows everything in the connection state immediately.
	•	windowed: shows only the last requested window size (e.g., if you had asked for 2 pages before, you see 2).

⸻

2) cache-and-network

Initial tab load (page 1)
	•	cumulative:
	•	If cached exists → publish it immediately, showing all cached pages; then also fire the network and reconcile.
	•	If no cache → wait for network result, then publish (and possibly reconcile again if transport emits twice).
	•	windowed:
	•	If page 1 is cached → publish only page 1 immediately; still fire the network (which might update fields or pageInfo).
	•	If not cached → show nothing (or your skeleton) until the network returns.

When you request page 2
	•	cumulative:
	•	If page 2 op is cached → show immediately, but still send the network to keep things fresh; reconcile on return.
	•	If not cached → send network; reveal when it returns (unless you implement a “connection-only reveal” optimization).
	•	windowed:
	•	If page 2 op is cached → extend the window immediately by one page, and still send the network (so UX feels instant but data stays fresh).
	•	If not cached → send network; extend on return.

Switching tabs and coming back
	•	cumulative: immediately shows all cached pages; still refreshes from the network in the background.
	•	windowed: immediately shows only the current window (e.g., 1 page if you hadn’t paged yet), then background refresh.

⸻
