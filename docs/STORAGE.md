# Storage — Persistent Cache & Cross-Tab Sync

Cachebay can persist its normalized cache to IndexedDB and synchronize changes across browser tabs (or Capacitor WebKit instances) in real-time.

## Quick start

```ts
import { createCachebay } from 'cachebay'
import { createStorage } from 'cachebay/idb'

const cachebay = createCachebay({
  transport: { http },
  storage: createStorage(),
})
```

That's it. Every cache write is persisted automatically, and other tabs see changes within ~100ms.

## How it works

### Journal-based sync

A single IndexedDB database serves both persistence and cross-tab synchronization. No `BroadcastChannel` is used — this design works reliably in Capacitor iOS where separate WebKit instances may not share `BroadcastChannel`.

**IDB schema:**

| Store       | Key                           | Value                                        |
|-------------|-------------------------------|----------------------------------------------|
| `records`   | `recordId` (e.g. `"User:1"`) | Normalized snapshot                          |
| `journal`   | IDB auto-increment integer    | `{ clientId, type, recordId, ts }`           |

The journal key is an IDB auto-increment integer — monotonically increasing across all tabs sharing the same database. Each adapter tracks a `lastSeenEpoch` cursor (the highest journal key it has processed) to know where to resume polling.

**Write flow (Tab A):**

1. `graph.putRecord()` fires `onChange` in the client
2. Client calls `storage.put(records)` with the delta
3. Single IDB transaction: write to `records` + append to `journal`

**Sync flow (Tab B, every 100ms):**

1. Read journal entries where `key > lastSeenEpoch` (auto-increment cursor)
2. Filter out entries where `clientId === own clientId`
3. For remaining: read the record from `records` store, apply to graph
4. Update `lastSeenEpoch` to the max key seen

### SSR + Storage ordering

SSR hydrate runs **synchronously**. IDB load is **asynchronous** and arrives later. To prevent stale IDB data from overwriting fresh SSR data, IDB load only fills **gaps** — records that don't already exist in the graph.

```
Timeline:
  createCachebay()     → storage.load() starts (async)
  cachebay.hydrate()   → SSR data written to graph (sync)
  ...                  → IDB load resolves, fills only missing records
```

This means SSR-hydrated records always win over stale persisted data.

## Options

```ts
createStorage({
  dbName: 'cachebay',           // IDB database name (default: "cachebay")
  pollInterval: 100,            // Cross-tab poll interval in ms (default: 100)
  journalMaxAge: 3_600_000,     // Journal entry lifetime in ms (default: 1 hour)
  evictInterval: 300_000,       // Auto-eviction interval in ms (default: 5 min)
})
```

| Option           | Default       | Description                                                    |
|------------------|---------------|----------------------------------------------------------------|
| `dbName`         | `"cachebay"`  | IndexedDB database name. Use different names for separate caches. |
| `pollInterval`   | `100`         | How often to poll the journal for cross-tab changes (ms).      |
| `journalMaxAge`  | `3_600_000`   | Entries older than this are evicted during cleanup (ms).        |
| `evictInterval`  | `300_000`     | How often auto-eviction runs (ms). Independent of `pollInterval`. |

### Journal eviction

Eviction is fully independent from the poll loop:

1. **On load** — stale entries from previous sessions are evicted immediately.
2. **Every `evictInterval`** — a separate timer cleans entries older than `journalMaxAge`.
3. **Manual** — call `cachebay.storage.evictJournal()` at any time.

## Storage API

When `storage` is provided, the cache instance exposes a `storage` property:

```ts
const cachebay = createCachebay({
  transport: { http },
  storage: createStorage(),
})

// Debug: inspect storage state
const info = await cachebay.storage.inspect()
// { recordCount: 42, journalCount: 5, lastSeenEpoch: 127, instanceId: "a1b2c3d4" }

// Force immediate sync (instead of waiting for next poll)
await cachebay.storage.flushJournal()

// Manually clean old journal entries
await cachebay.storage.evictJournal()
```

| Method           | Returns               | Description                                           |
|------------------|-----------------------|-------------------------------------------------------|
| `inspect()`      | `Promise<StorageInspection>` | Record count, journal count, epoch cursor, instance ID |
| `flushJournal()` | `Promise<void>`       | Force an immediate journal poll                       |
| `evictJournal()` | `Promise<void>`       | Delete journal entries older than `journalMaxAge`     |

When no `storage` option is provided, `cachebay.storage` is `null`.

### Capacitor: force sync before navigation

In Capacitor iOS, separate WebKit instances don't share `BroadcastChannel`, which is why cachebay uses journal-based IDB polling instead. When opening a modal or navigating between views, call `flushJournal()` to ensure the latest state is visible immediately — without waiting for the next poll cycle:

```ts
// Force sync before opening a modal
await cachebay.storage.flushJournal()
await Modal.open(...)
```

## Dispose

Call `dispose()` when the cache is no longer needed. This stops journal polling and closes the IDB connection.

```ts
cachebay.dispose()
```

## Custom storage adapters

The `storage` option accepts any `StorageAdapterFactory`. You can implement your own adapter for different backends (e.g. `localStorage`, SQLite, a remote sync service):

```ts
import type { StorageAdapterFactory } from 'cachebay'

const myStorage: StorageAdapterFactory = (ctx) => {
  // ctx.instanceId  — unique ID for this tab/instance
  // ctx.onUpdate    — call when a remote instance has updated records
  // ctx.onRemove    — call when a remote instance has removed records

  return {
    put(records) { /* persist [id, snapshot] pairs */ },
    remove(recordIds) { /* delete records by id */ },
    load() { /* return all persisted records */ },
    flushJournal() { /* force immediate sync poll */ },
    evictJournal() { /* clean old sync entries */ },
    inspect() { /* return debug info */ },
    dispose() { /* cleanup */ },
  }
}

const cachebay = createCachebay({
  transport: { http },
  storage: myStorage,
})
```

## Edge cases

| Scenario                        | Behavior                                                    |
|---------------------------------|-------------------------------------------------------------|
| SSR hydrate + IDB load overlap  | SSR data wins (IDB only fills gaps)                         |
| Optimistic update + revert      | Both flow through `onChange` → storage always matches graph  |
| Tab close mid-write             | IDB auto-aborts uncommitted tx; next load sees committed data |
| All tabs closed, reopen         | Records store has full state; old journal entries get evicted |
| Multiple `createStorage()` with same `dbName` | Shared IDB — full cross-tab sync  |
| Server-side (no `indexedDB`)    | Adapter should guard with `typeof indexedDB` check          |

## See also

- **Setup** — cache configuration & policies: [SETUP.md](./SETUP.md)
- **SSR** — dehydrate/hydrate, first-mount rules: [SSR.md](./SSR.md)
- **Queries** — cache policies & execution: [QUERIES.md](./QUERIES.md)
- **Fragments** — identify / read / write: [FRAGMENTS.md](./FRAGMENTS.md)
