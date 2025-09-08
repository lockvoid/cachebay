
What should happen (general rule)

If you have two optimistic updates A then B:
	1.	Apply A (optimistic)
	2.	Apply B (optimistic) → state is base + A + B
	3.	A fails → revert only A, then rebase B → state becomes base + B
	4.	B succeeds → remove B’s optimistic layer and write the real server result for B → state base + real(B)

Net effect: B sticks, A is rolled back. If A and B touched the same fields, the final values reflect B (or B’s server-confirmed data).

How Apollo Client handles it
	•	Apollo keeps an ordered stack of optimistic transactions keyed by mutation IDs.
	•	Each optimistic mutation writes to a temporary layer.
	•	On success, Apollo removes that optimistic layer and writes the real result.
	•	On failure, Apollo rolls back only that layer and replays the remaining optimistic layers in order on top of the base cache.
	•	Watchers are notified at each meaningful transition (apply A, apply B, rollback A, commit B).

So in your scenario: A fails, B succeeds → final cache = base + real(B).

Collisions / same fields
	•	If A and B write the same field, order matters: later layers win while they’re applied.
	•	When A is rolled back, Apollo replays B, so B’s values remain.
	•	When B commits, the server response for B becomes the source of truth (may differ from optimistic).

⸻

Recommendations for villus-cachebay

Mirror Apollo’s semantics:
	•	Maintain a stack of optimistic layers (each with a unique id).
	•	On failure: remove that one layer and replay the remaining ones.
	•	On success: replace the optimistic layer with the real result.
	•	For Relay connections, use stable ids for placeholder edges so rollback/commit adjusts the same edge (don’t duplicate).

If you want, I can sketch a couple of tight tests:
	•	“A then B; A fails; B succeeds → final equals base+real(B)”
	•	“A and B overlap same field; rollback A preserves B’s write”
	•	“Connection insert optimistic; rollback removes the edge; commit re-inserts with server id”
