# Changelog

All notable changes to this project will be documented in this file.

## [0.10.0] — 2026-02-18

### Added
- **Persistent storage & cross-tab sync** — IndexedDB-backed cache persistence with journal-based cross-tab synchronization; works in Capacitor iOS. (`cachebay/idb`)
- **Svelte adapter** — first-party Svelte 5 support with `createQuery`, `createFragment`, `createMutation`, `createSubscription`.
- **Inline edges** — support inline edges for optimistic updates on Relay connections.

### Fixed
- Fix demo Dockerfile (`packages/demo` → `packages/demo-vue`).
- Fix Kamal deploy config (double `ghcr.io/` in image path, `demo` → `demo-vue`).

## [0.9.3] — 2025-11-07

### Added
- Imperative callbacks for `useSubscription`.
- Fragment support in the optimistic layer.
- Document deduplication via the compiler.

### Fixed
- Fix `useQuery` race condition when variables change rapidly.
- Fix suspension propagation across nested components.
- Throw error if Suspense is used incorrectly.
- Ignore null or empty objects in subscription normalization.

## [0.9.2] — 2025-10-30

### Fixed
- Fix ESM exports for all entry points.

## [0.9.1] — 2025-10-30

### Fixed
- Fix package exports configuration.

## [0.9.0] — 2025-10-30

### Changed
- **Framework-agnostic refactor** — extracted core into a standalone engine with pluggable adapters. Vue adapter now lives in `cachebay/vue`.

## [0.8.0] — 2025-10-15

### Added
- Nested query benchmark.

### Fixed
- Emit new refs for edges & `pageInfo` to trigger Vue reactivity correctly.
- Fix version bumping across workspace packages.

## [0.7.1] — 2025-10-14

### Fixed
- Fix alias materialization.
- Fix JSON scalar normalization.

## [0.7.0] — 2025-10-14

### Changed
- New core architecture to support containers inside Relay connections.
- Compiler is now interface-aware with polymorphic `hasDocument`.

### Added
- Base for performance tests.

## [0.6.2] — 2025-10-05

### Changed
- Stabilize `connection.edges` identity with in-place reactive updates to fix optimistic UI refresh and reduce allocations.

### Added
- `inspect` API for optimistic layers.

## [0.6.1] — 2025-10-04

### Fixed
- Fix prepend pagination `pageInfo` and cursors.

## [0.6.0] — 2025-10-03

### Changed
- Two-phase optimistic updates — separate prepare and commit phases for cleaner rollback semantics.

## [0.5.0] — 2025-10-03

### Changed
- Strict `hasDocument` check — refuse to materialize partial cache, preventing incomplete renders.

## [0.4.3] — 2025-10-01

### Fixed
- Fix subscriptions handler; add subscription example to demo app.

## [0.4.2] — 2025-10-01

### Fixed
- `inspect` now returns canonical connections, not individual pages.

## [0.4.1] — 2025-10-01

### Added
- Allow updating canonical connections optimistically by raw key.

## [0.4.0] — 2025-10-01

### Changed
- Refactor `inspect` tools.

## [0.3.2] — 2025-10-01

### Changed
- Switch build to tsdown; fix import paths in docs.

## [0.3.1] — 2025-10-01

### Fixed
- Fix license file.

## [0.3.0] — 2025-10-01

### Changed
- Stable API refactor.

## [0.2.1] — 2025-10-01

### Fixed
- Fix publish workflow and Kamal config.

## [0.2.0] — 2025-10-01

### Added
- Demo app deployment.

## [0.1.1] — 2025-10-01

Initial release — normalized GraphQL cache with Relay connections, optimistic updates, and SSR support.
