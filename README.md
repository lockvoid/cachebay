# Cachebay

[![CI](https://github.com/lockvoid/cachebay/actions/workflows/test.yml/badge.svg)](https://github.com/lockvoid/cachebay/actions/workflows/test.yml)
[![npm](https://img.shields.io/npm/v/cachebay.svg)](https://www.npmjs.com/package/cachebay)
[![Coverage](https://codecov.io/gh/lockvoid/cachebay/branch/main/graph/badge.svg)](https://codecov.io/gh/lockvoid/cachebay)
[![Bundlephobia](https://img.shields.io/bundlephobia/minzip/cachebay)](https://bundlephobia.com/package/cachebay)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Framework-agnostic GraphQL data layer: normalized caching, Relay-style connections, layered optimistic updates, and SSR that just works.**

- **Adapters:** first-party for **Vue** and **Svelte**; writing your own adapter is straightforward.
- **Fast rendering & performance.** Microtask-batched updates; stable views that don’t churn arrays and minimize re-renders.
- **Small bundle size.** ~16 kB gzipped, tree-shakeable, ESM-friendly.
- **Normalized entities** with interface-aware identities and precise dependency tracking.
- **Relay-style connections** with append/prepend/replace modes, edge de-dup by node key, and zero array churn.
- **Layered optimistic updates** — patch/delete entities and add/remove/patch connections with clean commit/revert.
- **Server-side rendering** — dehydrate/hydrate; first client mount renders from cache without a duplicate request; clean Suspense behavior.

## Keynotes

A quick architectural overview of how Cachebay works — see **[Keynotes](./docs/KEYNOTES.md)**.

For benchmarking — see **[Benchmarks](./docs/BENCHMARKS.md)**.

## Documentation

- **[Installation](./docs/INSTALLATION.md)**
- **[Setup](./docs/SETUP.md)**
- **[Operations](./docs/OPERATIONS.md)**
- **[Queries](./docs/QUERIES.md)**
- **[Mutations](./docs/MUTATIONS.md)**
- **[Subscriptions](./docs/SUBSCRIPTIONS.md)**
- **[Relay Connections](./docs/RELAY_CONNECTIONS.md)**
- **[Optimistic Updates](./docs/OPTIMISTIC_UPDATES.md)**
- **[SSR](./docs/SSR.md)**

## Demo app

**[Nuxt 4 Demo App ϟ](./packages/demo)**

or try live https://harrypotter.exp.lockvoid.com/

---

## License

MIT © LockVoid Labs ~●~
