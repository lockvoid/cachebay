# AI Coding Style

> Single source of truth for how I want AI to write code. Keep it short, unambiguous, and easy to follow.

---

## Core Rules (non-negotiable)
1. **Performance first.** Avoid unnecessary work, allocations, and dependencies.
2. **Human-friendly code.** Use clear, descriptive names (no cryptic or shorthand vars, but not very long).
3. **Logical code** Add logical blank lines between steps.
4. **No hacks.** Code must be straightforward and understandable; prefer simple, explicit solutions.
5. **Minimal deps.** Prefer stdlib. If adding a library, justify in one sentence (why it’s needed vs cost).
6. **Full, runnable outputs.** Provide complete, compiling examples (not fragments) unless I explicitly request a snippet.
7. **No premature abstractions.** Avoid over-engineering (hooks/services/providers) until there’s repeated need. Start simple.
8. **Braces & newlines (K&R across languages).** Always wrap control structures (`if/else`, `for`, `while`, `try/catch`, etc.) with `{}` and use **K&R braces**: opening brace on the **same line**; `else`/`catch` on the same line as the closing brace.
9. DON'T keep backward compatibility unless I ask for it.
10. Keep types declarations concise and readable at the top of each file.
11. Use jsdoc comments for all public functions and classes.
12. You are writing code for modern environments, ensuring compatibility with the latest standards and best practices.
13. ALL "if" statements should be formatted with K&R braces and newlines.
---

## Formatting & Style Details
- **K&R braces** everywhere (functions, classes, control flow).
- **Whitespace:** one blank line between logical steps; no trailing spaces.
- **Naming:** meaningful, explicit names; avoid single letters except for tight loops.
- **Errors:** throw explicit `Error` with helpful messages. Don’t swallow errors.
- **Comments:** explain *why*, not *what*; keep comments short and useful if the code is complex or non-obvious.

---

## Output Contract (for every task)
1. **Plan** — 3–7 bullets: approach and trade-offs.
2. **Code** — full, runnable files (minimal dependencies) with instructions if needed.
3. **(Optional) Tests** — add a couple of realistic checks if it’s non-trivial.
4. **Notes** — caveats or future improvements in ≤5 lines.

**Final self-check:**
- [ ] Performance: no obvious extra work or allocations
- [ ] Readability: names descriptive; logical blank lines present
- [ ] No hacks/cleverness; direct solution
- [ ] No unnecessary deps (or one-line justification present)
- [ ] Control flow uses **K&R braces** and `{}` even for single lines

---

## JavaScript & TypeScript

1. Prefer arrow functions over function expressions.
2. Use `const` for variables that don’t change.
3. Use `let` for variables that change.
4. Prefer for (let i = 0, keys = Object.keys(object); i < keys.length; i++) for iterating over object keys if performance is critical.
5. Avoid ...spread operators if performance is critical.
