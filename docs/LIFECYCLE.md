# Internal Lifecycle: Dependency System & Data Updates

This document explains how the internal dependency tracking and data update system works in villus-cachebay.

## Overview

The cache uses a reactive dependency system to notify watchers when data changes. The system has three main components:

1. **Dependency Tracking** - Track which cache entities a query depends on
2. **Change Propagation** - Notify watchers when dependencies change
3. **Coalescing** - Prevent redundant materializations when multiple sources trigger updates

## Architecture

```
┌─────────────┐
│  useQuery   │ (Vue composable)
└──────┬──────┘
       │ 1. watchQuery(immediate: true)
       │ 2. executeQuery()
       ▼
┌─────────────┐
│   queries   │ (Watcher management)
└──────┬──────┘
       │
       ├─► watchQuery: Creates watcher, tracks dependencies
       ├─► handleQueryExecuted: Receives data from executeQuery
       └─► propagateData: Notifies watchers when cache changes

┌─────────────┐
│ operations  │ (Query execution)
└──────┬──────┘
       │
       ├─► executeQuery: Fetches data, normalizes, materializes
       └─► onQueryData callback: Sends data + deps to queries

┌─────────────┐
│    graph    │ (Normalized cache)
└──────┬──────┘
       │
       └─► onChange: Fires when entities are written
```

## Data Flow

### 1. Initial Query Setup (watchQuery)

```typescript
// useQuery.ts
watchQuery({
  query,
  variables,
  immediate: true,  // Materialize immediately from cache
  onData: (data) => { /* Update Vue ref */ }
})
```

**What happens:**
1. Creates watcher with unique ID
2. If `immediate: true`, calls `documents.materialize`
3. Tracks dependencies (entity IDs the query reads)
4. Registers watcher in `depIndex` (dependency → watcher mapping)
5. If cache hit, emits data via `onData` callback

### 2. Query Execution (executeQuery)

```typescript
// useQuery.ts
executeQuery({ query, variables, cachePolicy })
```

**What happens:**

#### A. Cache Check
```typescript
const cached = documents.materialize({
  document: query,
  variables,
  canonical: true,
  fingerprint: true  // Get dependencies
})
```

#### B. Network Fetch (if needed)
```typescript
const response = await transport.http(query, variables)
```

#### C. Normalize Response
```typescript
documents.normalize({
  document: query,
  variables,
  data: response.data
})
```

**This triggers:**
```typescript
graph.onChange(touchedIds)  // Synchronously!
  ↓
queueMicrotask(() => {
  queries.propagateData(touchedIds)  // Deferred to microtask
  fragments.propagateData(touchedIds)
})
```

#### D. Materialize & Callback
```typescript
const result = documents.materialize({
  document: query,
  variables,
  canonical: true,
  fingerprint: true
})

// Immediately call onQueryData (synchronous!)
onQueryData({
  signature,
  data: result.data,
  dependencies: result.dependencies,
  cachePolicy
})
```

### 3. Watcher Notification (handleQueryExecuted)

```typescript
// queries.ts
handleQueryExecuted({ signature, data, dependencies }) {
  const watcherId = signatureToWatcher.get(signature)
  const watcher = watchers.get(watcherId)

  // Update dependencies
  updateWatcherDependencies(watcherId, dependencies)

  // Direct emit with data (no re-materialize!)
  const recycled = recycleSnapshots(watcher.lastData, data)
  if (recycled !== watcher.lastData) {
    watcher.lastData = recycled

    // Set coalescing flag
    watcher.skipNextPropagate = true

    watcher.onData(recycled)  // Emit to useQuery
  }
}
```

### 4. Change Propagation (propagateData)

```typescript
// queries.ts - Called from graph.onChange (in microtask)
propagateData(touchedIds) {
  // Batch updates
  scheduleFlush()  // Queues another microtask!
}

scheduleFlush() {
  queueMicrotask(() => {
    // Find affected watchers
    for (const watcherId of affected) {
      const watcher = watchers.get(watcherId)

      // Check coalescing flag
      if (watcher.skipNextPropagate) {
        watcher.skipNextPropagate = false
        continue  // Skip! Already emitted by handleQueryExecuted
      }

      // Re-materialize and emit
      const result = documents.materialize({
        document: watcher.query,
        variables: watcher.variables,
        canonical: true,
        fingerprint: true
      })

      const recycled = recycleSnapshots(watcher.lastData, result.data)
      if (recycled !== watcher.lastData) {
        watcher.lastData = recycled
        watcher.onData(recycled)
      }
    }
  })
}
```

## Coalescing Logic

The coalescing system prevents double emissions when both `onQueryData` and `propagateData` would notify the same watcher.

### Problem Without Coalescing

```
executeQuery
  ↓
normalize → graph.onChange → propagateData (emit 1) ❌
  ↓
materialize → onQueryData → direct emit (emit 2) ❌
```

Result: **2 emissions, 2 materializations** (redundant!)

### Solution With Coalescing

```
executeQuery
  ↓
normalize → graph.onChange → queueMicrotask(propagateData)
  ↓
materialize → onQueryData → direct emit + set skipNextPropagate
  ↓
[microtask] propagateData → check skipNextPropagate → SKIP ✅
```

Result: **1 emission, 1 materialization** (optimized!)

### Timing

1. **Synchronous**: `normalize` → `graph.onChange` → `queueMicrotask`
2. **Synchronous**: `materialize` → `onQueryData` → emit + set flag
3. **Microtask 1**: `propagateData` called
4. **Microtask 2**: `scheduleFlush` → check flag → skip

## Key Optimizations

### 1. Direct Data Emission
- `onQueryData` receives already-materialized data
- No need to re-materialize in watcher
- **Savings**: 1 materialize per query

### 2. Microtask Deferral
- `graph.onChange` defers `propagateData` to microtask
- Allows `onQueryData` to set `skipNextPropagate` flag first
- **Savings**: Prevents redundant materialize from propagateData

### 3. Coalescing Flag
- `skipNextPropagate` prevents double emission
- Flag is set by `onQueryData`, checked by `propagateData`
- **Savings**: 1 materialize per query execution

### 4. Object Identity Preservation
- `recycleSnapshots` preserves unchanged object references
- Prevents unnecessary re-renders in Vue
- Only emits if data actually changed

## Cache Policies & Behavior

### cache-first
1. `watchQuery(immediate: true)` → materialize (cache hit)
2. `executeQuery` → check cache → `onQueryData` → emit
3. **Total**: 2 materializations (both needed)

### cache-only
1. `watchQuery(immediate: true)` → materialize (cache hit)
2. `executeQuery` → check cache → `onQueryData` → emit
3. **Total**: 2 materializations (no network)

### network-only
1. `watchQuery(immediate: true)` → materialize (cache miss, no emit)
2. `executeQuery` → network → normalize → materialize → `onQueryData` → emit
3. `propagateData` → SKIPPED (coalescing)
4. **Total**: 2 materializations (1 wasted on cache miss, 1 after network)

### cache-and-network
1. `watchQuery(immediate: true)` → materialize (cache hit) → emit
2. `executeQuery` → return cached → background network → normalize → materialize → `onQueryData` → emit
3. `propagateData` → SKIPPED (coalescing)
4. **Total**: 3 materializations (initial + cache check + network)

## Refetch & Variable Changes

### Refetch
```typescript
refetch() {
  // Update watcher with immediate: false (no materialize)
  watchHandle.update({ variables, immediate: false })

  // Execute query
  await executeQuery({ query, variables, cachePolicy: 'network-only' })
  // → normalize → materialize → onQueryData → emit
  // → propagateData → SKIPPED (coalescing)
}
```

**Expected**: 1 materialize (from executeQuery)
**Current**: 2 materializations (coalescing not working yet)

### Variable Change
```typescript
watch(variables, (newVars) => {
  // Update watcher with immediate: false (no materialize)
  watchHandle.update({ variables: newVars, immediate: false })

  // Execute query
  executeQuery({ query, variables: newVars })
  // → normalize → materialize → onQueryData → emit
  // → propagateData → SKIPPED (coalescing)
})
```

**Expected**: 1 materialize (from executeQuery)
**Current**: 2 materializations (coalescing not working yet)

## Current Issues

### Issue: Coalescing Not Working for Refetch/Variable Changes

**Symptom**: Performance tests show 2 materializations instead of 1

**Root Cause**: The `skipNextPropagate` flag is being set AFTER `propagateData` has already been queued in the microtask.

**Timeline**:
1. `normalize` → `graph.onChange` → `queueMicrotask(propagateData)` [queued]
2. `onQueryData` → set `skipNextPropagate` → emit
3. [Microtask 1] `propagateData` → `scheduleFlush` → `queueMicrotask` [queued]
4. [Microtask 2] `scheduleFlush` → check `skipNextPropagate` → should skip but doesn't?

**Possible Solutions**:
1. Ensure `skipNextPropagate` is checked correctly in `propagateData`
2. Verify timing of microtasks
3. Add logging to track flag state
4. Consider alternative coalescing mechanism

## Testing

Performance tests track normalize/materialize counts:

```typescript
// Expected behavior
expect(normalizeSpy).toHaveBeenCalledTimes(1)  // Network call
expect(materializeSpy).toHaveBeenCalledTimes(1) // Only executeQuery materialize
```

**Current Results**:
- ✅ cache-first: 2 materializations (correct)
- ❌ network-only: undefined data (broken)
- ❌ refetch: 2 materializations (should be 1)
- ❌ variable change: 2 materializations (should be 1)
