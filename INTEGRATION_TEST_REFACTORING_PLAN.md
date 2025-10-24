# Integration Test Refactoring Plan

## Executive Summary

Cachebay has evolved from a Vue-specific cache plugin into a **framework-agnostic GraphQL cache library** with adapter bindings for Vue (and future React, Svelte). Current integration tests are tightly coupled to Vue composables (`useQuery`, `useMutation`, etc.) rather than testing the agnostic core APIs (`executeQuery`, `executeMutation`, `watchQuery`, etc.).

**Goal**: Separate concerns by creating comprehensive Vue adapter tests while refactoring existing integration tests to use agnostic core APIs.

---

## Current State Analysis

### Integration Test Inventory

#### **Vue-Coupled Tests** (Need Refactoring)
1. **`cache-policies.test.ts`** (959 lines)
   - Tests: 16 tests covering all 4 cache policies (network-only, cache-first, cache-and-network, cache-only)
   - Uses: `createConnectionComponent`, `createDetailComponent` (Vue wrappers around `useQuery`)
   - Coverage: Cache policy behavior with connections and single entities
   - **Status**: 100% Vue-coupled

2. **`error-handling.test.ts`** (252 lines)
   - Tests: 4 tests for error scenarios
   - Uses: `createConnectionComponent` (Vue wrapper)
   - Coverage: Network errors, stale error handling, error dropping
   - **Status**: 100% Vue-coupled

3. **`fragments-lifecycle.test.ts`** (252 lines)
   - Tests: 9 tests for fragment operations
   - Uses: `useFragment` Vue composable
   - Coverage: Fragment reads, writes, watches, reactivity
   - **Status**: 100% Vue-coupled

4. **`mutations-lifecycle.test.ts`** (87 lines)
   - Tests: 1 test for mutation flow
   - Uses: `useQuery`, `useMutation` Vue composables
   - Coverage: Mutation execution and cache updates
   - **Status**: 100% Vue-coupled

5. **`edge-cases-behaviour.test.ts`** (252 lines)
   - Tests: 3 tests for edge cases
   - Uses: `useQuery` Vue composable
   - Coverage: Entity deduplication, Suspense behavior
   - **Status**: 100% Vue-coupled

6. **`optimistic-updates.test.ts`** (30,776 lines)
   - Tests: 15 tests for optimistic updates
   - Uses: `createConnectionComponent` (Vue wrapper)
   - Coverage: Entity patches, connection modifications, layering, complex flows
   - **Status**: 100% Vue-coupled

7. **`relay-connections.test.ts`** (27,571 lines)
   - Tests: 7 tests for Relay pagination
   - Uses: Mix of `executeQuery` (core) and `createConnectionComponent` (Vue)
   - Coverage: Append/prepend/replace modes, reactivity, complex pagination flows
   - **Status**: 50% agnostic, 50% Vue-coupled

8. **`ssr.test.ts`** (14,293 lines)
   - Tests: 8 tests for SSR hydration
   - Uses: `createConnectionComponent`, `createConnectionComponentSuspense` (Vue wrappers)
   - Coverage: Hydration behavior across all cache policies with/without Suspense
   - **Status**: 100% Vue-coupled

#### **Agnostic Core Tests** (Already Good)
9. **`subscriptions-lifecycle.test.ts`** (218 lines) ✅
   - Tests: 4 tests for subscriptions
   - Uses: `executeSubscription` (core API)
   - Coverage: Subscription updates, errors, unsubscribe, transport validation
   - **Status**: 100% agnostic ✅

#### **Vue Adapter Tests** (Incomplete)
10. **`adapters/vue/useCachebay.ts`** (45 lines)
    - Tests: 2 tests for `useCache` composable
    - Coverage: Cache access, error handling
    - **Status**: Minimal coverage

11. **`adapters/vue/useMutation.ts`** (88 lines)
    - Tests: 1 test for `useMutation`
    - Coverage: Basic mutation execution
    - **Status**: Minimal coverage

12. **`adapters/vue/useQuery.ts`** (0 lines) ❌
    - **Status**: Empty file

13. **`adapters/vue/useFragment.ts`** (0 lines) ❌
    - **Status**: Empty file

14. **`adapters/vue/useSubscription.ts`** (0 lines) ❌
    - **Status**: Empty file

---

## Two-Step Refactoring Strategy

### **STEP 1: Comprehensive Vue Adapter Test Suite**

Create a complete test suite for Vue adapter bindings that covers ALL Vue-specific features and integration scenarios.

#### **1.1 New File: `test/integration/adapters/vue/comprehensive.test.ts`**

**Purpose**: Single comprehensive test file covering all Vue adapter features in realistic scenarios.

**Test Scenarios**:

##### **A. Query Composable (`useQuery`)**
- ✅ All 4 cache policies (network-only, cache-first, cache-and-network, cache-only)
- ✅ Reactive variable updates
- ✅ Pause/resume functionality
- ✅ Loading states (isFetching, isLoading)
- ✅ Error handling and error states
- ✅ Data reactivity and updates
- ✅ Component unmount cleanup
- ✅ Suspense integration
- ✅ SSR hydration behavior

##### **B. Mutation Composable (`useMutation`)**
- ✅ Basic mutation execution
- ✅ Optimistic updates
- ✅ Cache updates after mutation
- ✅ Error handling
- ✅ Loading states (isLoading)
- ✅ Multiple mutations in sequence
- ✅ Mutation with query refetch

##### **C. Subscription Composable (`useSubscription`)**
- ✅ Basic subscription setup
- ✅ Real-time data updates
- ✅ Error handling
- ✅ Unsubscribe on unmount
- ✅ Pause/resume functionality
- ✅ Multiple subscriptions

##### **D. Fragment Composable (`useFragment`)**
- ✅ Fragment reads with reactivity
- ✅ Fragment writes
- ✅ Fragment watches
- ✅ Variable updates
- ✅ Missing fragment handling
- ✅ Component unmount cleanup

##### **E. Cache Access (`useCachebay`)**
- ✅ Cache method access
- ✅ Direct cache operations
- ✅ Error when used outside provider

##### **F. Complex Integration Scenarios**
- ✅ Query + Mutation + Fragment coordination
- ✅ Optimistic updates with rollback
- ✅ Subscription updating query data
- ✅ SSR hydration with all composables
- ✅ Multiple components sharing cache
- ✅ Suspense with error boundaries

**Estimated Size**: ~2,000-3,000 lines

---

#### **1.2 Expand Existing Vue Adapter Tests**

**File: `test/integration/adapters/vue/useQuery.ts`**
- Detailed tests for each cache policy
- Edge cases (empty results, null data, etc.)
- Performance scenarios (rapid variable changes)

**File: `test/integration/adapters/vue/useMutation.ts`**
- Expand beyond basic test
- Optimistic update scenarios
- Error recovery

**File: `test/integration/adapters/vue/useFragment.ts`**
- Fragment lifecycle tests
- Reactivity tests
- Watch functionality

**File: `test/integration/adapters/vue/useSubscription.ts`**
- Complete subscription lifecycle
- Real-time update scenarios
- Error handling

**Estimated Size**: ~500-800 lines per file

---

### **STEP 2: Refactor Integration Tests to Agnostic Core**

Once Vue adapter coverage is comprehensive, refactor existing integration tests to use agnostic core APIs.

#### **2.1 Refactoring Approach**

**Pattern Transformation**:

**Before (Vue-coupled)**:
```typescript
const Cmp = createConnectionComponent(operations.USERS_QUERY, {
  cachePolicy: "cache-first",
  connectionFn: (data) => data.users,
});

const wrapper = mount(Cmp, {
  props: { role: "admin", first: 2 },
  global: { plugins: [client] },
});

await tick();
expect(getEdges(wrapper, "email")).toEqual(["u1@example.com"]);
```

**After (Agnostic core)**:
```typescript
const watcher = cache.watchQuery({
  query: operations.USERS_QUERY,
  variables: { role: "admin", first: 2 },
  cachePolicy: "cache-first",
});

const updates: any[] = [];
watcher.subscribe((result) => {
  updates.push(result.data);
});

await tick();
expect(updates[0]?.users?.edges[0]?.node?.email).toBe("u1@example.com");

watcher.unsubscribe();
```

---

#### **2.2 File-by-File Refactoring Plan**

##### **A. `cache-policies.test.ts` → `core/cache-policies.test.ts`**
- **Current**: 16 tests using Vue components
- **Target**: 16 tests using `watchQuery` + `executeQuery`
- **Changes**:
  - Replace `createConnectionComponent` with `watchQuery`
  - Replace `mount` with direct `subscribe` calls
  - Replace `getEdges(wrapper)` with direct data assertions
  - Keep same test scenarios and assertions
- **Estimated Effort**: 4-6 hours

##### **B. `error-handling.test.ts` → `core/error-handling.test.ts`**
- **Current**: 4 tests using Vue components
- **Target**: 4 tests using `watchQuery` + `executeQuery`
- **Changes**: Similar to cache-policies
- **Estimated Effort**: 2-3 hours

##### **C. `fragments-lifecycle.test.ts` → `core/fragments-lifecycle.test.ts`**
- **Current**: 9 tests using `useFragment`
- **Target**: 9 tests using `readFragment`, `writeFragment`, `watchFragment`
- **Changes**:
  - Replace `useFragment` with `watchFragment`
  - Remove Vue component wrapper
  - Direct cache API calls
- **Estimated Effort**: 3-4 hours

##### **D. `mutations-lifecycle.test.ts` → `core/mutations-lifecycle.test.ts`**
- **Current**: 1 test using `useMutation`
- **Target**: Multiple tests using `executeMutation`
- **Changes**:
  - Replace `useMutation` with `executeMutation`
  - Add more mutation scenarios
  - Test cache updates directly
- **Estimated Effort**: 2-3 hours

##### **E. `edge-cases-behaviour.test.ts` → `core/edge-cases.test.ts`**
- **Current**: 3 tests using `useQuery`
- **Target**: 3 tests using `watchQuery`
- **Changes**: Replace Vue composables with core watchers
- **Estimated Effort**: 2-3 hours

##### **F. `optimistic-updates.test.ts` → `core/optimistic-updates.test.ts`**
- **Current**: 15 tests using Vue components
- **Target**: 15 tests using `modifyOptimistic` + `watchQuery`
- **Changes**:
  - Keep `modifyOptimistic` (already agnostic)
  - Replace Vue wrappers with `watchQuery`
  - Direct cache assertions
- **Estimated Effort**: 6-8 hours

##### **G. `relay-connections.test.ts` → `core/relay-connections.test.ts`**
- **Current**: 7 tests, partially agnostic
- **Target**: 7 tests, fully agnostic
- **Changes**:
  - Already uses `executeQuery` in many places
  - Replace remaining Vue components
  - Clean up to pure core APIs
- **Estimated Effort**: 3-4 hours

##### **H. `ssr.test.ts` → Keep as Vue-specific OR split**
- **Option 1**: Keep in `adapters/vue/ssr.test.ts` (SSR is adapter-specific)
- **Option 2**: Create `core/ssr.test.ts` for core hydration + `adapters/vue/ssr.test.ts` for Vue SSR
- **Recommendation**: Option 2 - split into core hydration tests + Vue SSR tests
- **Estimated Effort**: 4-5 hours

---

## Test Organization Structure (After Refactoring)

```
test/
├── integration/
│   ├── core/                          # Agnostic core tests
│   │   ├── cache-policies.test.ts     # watchQuery + executeQuery
│   │   ├── error-handling.test.ts     # Error scenarios
│   │   ├── fragments-lifecycle.test.ts # Fragment APIs
│   │   ├── mutations-lifecycle.test.ts # executeMutation
│   │   ├── subscriptions-lifecycle.test.ts # executeSubscription ✅
│   │   ├── optimistic-updates.test.ts # modifyOptimistic
│   │   ├── relay-connections.test.ts  # Relay pagination
│   │   ├── edge-cases.test.ts         # Edge cases
│   │   └── ssr-hydration.test.ts      # Core hydration logic
│   │
│   └── adapters/
│       └── vue/
│           ├── comprehensive.test.ts   # NEW: All-in-one Vue test
│           ├── useQuery.test.ts        # Expanded
│           ├── useMutation.test.ts     # Expanded
│           ├── useFragment.test.ts     # NEW
│           ├── useSubscription.test.ts # NEW
│           ├── useCachebay.test.ts     # Existing
│           └── ssr.test.ts             # Vue SSR specifics
│
└── unit/                               # Keep as-is
    ├── core/
    └── adapters/
```

---

## Benefits of This Refactoring

### **1. Clear Separation of Concerns**
- Core library tests are framework-agnostic
- Adapter tests focus on framework-specific behavior
- Easy to add React/Svelte adapters with similar test patterns

### **2. Better Test Coverage**
- Vue adapter gets comprehensive test coverage
- Core APIs are tested directly (no Vue wrapper indirection)
- Edge cases are easier to test without component overhead

### **3. Improved Maintainability**
- Core tests don't break when Vue adapter changes
- Adapter tests can evolve independently
- Clearer test intent and purpose

### **4. Performance**
- Core tests run faster (no Vue component mounting)
- Easier to benchmark core performance
- Parallel test execution is simpler

### **5. Documentation**
- Core tests serve as API documentation
- Adapter tests show best practices for each framework
- Clear examples for library users

---

## Implementation Timeline

### **Phase 1: Vue Adapter Tests (STEP 1)**
**Duration**: 2-3 weeks

1. **Week 1**: Create `comprehensive.test.ts` with all scenarios
2. **Week 2**: Expand individual adapter test files
3. **Week 3**: Review, refine, ensure 100% coverage

**Success Criteria**:
- ✅ All Vue composables have comprehensive tests
- ✅ All cache policies tested with Vue adapters
- ✅ SSR, Suspense, error handling covered
- ✅ 100+ Vue adapter tests passing

### **Phase 2: Core Refactoring (STEP 2)**
**Duration**: 3-4 weeks

1. **Week 1**: Refactor cache-policies, error-handling, fragments
2. **Week 2**: Refactor mutations, edge-cases, subscriptions
3. **Week 3**: Refactor optimistic-updates, relay-connections
4. **Week 4**: Refactor SSR, final cleanup, documentation

**Success Criteria**:
- ✅ All integration tests use core APIs
- ✅ No Vue dependencies in core tests
- ✅ Test coverage maintained or improved
- ✅ All tests passing

---

## Risk Mitigation

### **Risk 1: Breaking Existing Tests**
- **Mitigation**: Keep old tests until new ones are proven
- **Strategy**: Create new files alongside old ones, delete old after validation

### **Risk 2: Missing Edge Cases**
- **Mitigation**: Comprehensive review of current test coverage
- **Strategy**: Document all scenarios before refactoring

### **Risk 3: Time Overrun**
- **Mitigation**: Prioritize critical paths first
- **Strategy**: Phase 1 is independent, can ship before Phase 2

---

## Open Questions for Review

1. **Should we keep SSR tests in Vue adapters or split them?**
   - Recommendation: Split into core hydration + Vue SSR

2. **Should we create a shared test helper for core watchers?**
   - Recommendation: Yes, create `createCoreWatcher` helper

3. **Should we maintain both old and new tests during transition?**
   - Recommendation: Yes, delete old tests only after new ones pass

4. **Should we add React adapter tests in Phase 1?**
   - Recommendation: No, focus on Vue first, React later

5. **Should we benchmark performance difference between Vue and core tests?**
   - Recommendation: Yes, document speedup from removing Vue overhead

---

## Next Steps

1. **Review this plan** - Discuss and approve approach
2. **Create tracking issues** - Break down into actionable tasks
3. **Start Phase 1** - Begin with `comprehensive.test.ts`
4. **Iterate and refine** - Adjust plan based on learnings

---

## Conclusion

This refactoring will transform Cachebay's test suite from a Vue-specific cache plugin to a **framework-agnostic library with first-class adapter support**. The two-step approach ensures we maintain comprehensive coverage while cleanly separating concerns.

**Total Estimated Effort**: 5-7 weeks
**Total New/Refactored Tests**: ~150-200 tests
**Expected Outcome**: Clear, maintainable, framework-agnostic test suite
