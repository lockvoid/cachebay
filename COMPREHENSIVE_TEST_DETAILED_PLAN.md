# Comprehensive Vue Adapter Test - Detailed Plan

## Overview

`comprehensive.test.ts` will be a **scenario-based integration test suite** that tests real-world user workflows with Vue composables. Each scenario simulates how developers actually use Cachebay in production applications.

**Philosophy**: Test complete user journeys, not isolated features.

---

## Test Structure

### **Organization Pattern**

```typescript
describe("Vue Adapter - Comprehensive Integration", () => {
  
  describe("Scenario 1: [User Story]", () => {
    it("step 1: [action and expectation]", async () => { ... });
    it("step 2: [action and expectation]", async () => { ... });
    it("step 3: [action and expectation]", async () => { ... });
  });
  
  describe("Scenario 2: [User Story]", () => {
    // ...
  });
});
```

Each scenario is a **complete user journey** with multiple test steps that build on each other.

---

## Detailed Scenarios

### **Scenario 1: Blog Post List with Pagination**
**User Story**: User views a paginated list of blog posts, loads more pages, and sees real-time updates

#### **Test Steps**:

```typescript
describe("Scenario 1: Blog Post List with Pagination", () => {
  
  it("step 1: loads initial page of posts with cache-first policy", async () => {
    // Component uses useQuery with cache-first
    // Verify: loading state → data loaded → no network call (cache empty, so network called)
    // Assert: 10 posts displayed, pageInfo.hasNextPage = true
  });

  it("step 2: loads next page and appends to list", async () => {
    // User clicks "Load More"
    // Component updates variables: { after: "cursor10" }
    // Verify: new posts appended, total 20 posts
    // Assert: pageInfo updated, hasNextPage still true
  });

  it("step 3: receives subscription update for new post", async () => {
    // Subscription emits new post data
    // Component uses useSubscription
    // Verify: new post prepended to list
    // Assert: total 21 posts, new post at index 0
  });

  it("step 4: updates post via mutation with optimistic response", async () => {
    // User edits post title
    // Component uses useMutation with optimistic update
    // Verify: UI updates immediately (optimistic)
    // Verify: Network response confirms update
    // Assert: post title changed in list
  });

  it("step 5: navigates away and back, sees cached data instantly", async () => {
    // Component unmounts
    // Component remounts with same variables
    // Verify: data appears instantly from cache
    // Assert: no loading state, 21 posts still visible
  });
});
```

**Coverage**: `useQuery`, `useSubscription`, `useMutation`, cache-first policy, pagination, optimistic updates, cache persistence

---

### **Scenario 2: User Profile with Fragments**
**User Story**: User views their profile, edits fields, and sees updates reflected across multiple components

#### **Test Steps**:

```typescript
describe("Scenario 2: User Profile with Fragments", () => {
  
  it("step 1: loads user profile with useQuery", async () => {
    // Component A: Full profile query
    // Verify: user data loaded
    // Assert: name, email, avatar displayed
  });

  it("step 2: displays same user data in sidebar with useFragment", async () => {
    // Component B: Uses useFragment to read user from cache
    // Fragment: { id: "User:1", fragment: USER_SIDEBAR_FRAGMENT }
    // Verify: fragment data matches query data
    // Assert: same name and avatar in sidebar
  });

  it("step 3: updates user email via mutation", async () => {
    // User edits email in profile form
    // useMutation executes updateUser mutation
    // Verify: mutation response updates cache
    // Assert: Component A shows new email
    // Assert: Component B (fragment) also shows new email (reactivity)
  });

  it("step 4: writes fragment directly to update avatar", async () => {
    // User uploads new avatar (client-side update)
    // Component uses cache.writeFragment
    // Verify: cache updated without network call
    // Assert: Both components show new avatar immediately
  });

  it("step 5: watches fragment for external changes", async () => {
    // Component C: Uses watchFragment
    // External mutation updates user (from another tab/user)
    // Verify: watchFragment callback fires
    // Assert: Component C receives updated data
  });
});
```

**Coverage**: `useQuery`, `useFragment`, `useMutation`, `readFragment`, `writeFragment`, `watchFragment`, reactivity across components

---

### **Scenario 3: Real-time Chat with Subscriptions**
**User Story**: User joins a chat room, sends messages, and receives real-time updates

#### **Test Steps**:

```typescript
describe("Scenario 3: Real-time Chat with Subscriptions", () => {
  
  it("step 1: loads initial chat messages with cache-and-network", async () => {
    // Component uses useQuery with cache-and-network
    // Verify: shows cached messages immediately
    // Verify: then updates with fresh network data
    // Assert: messages displayed in correct order
  });

  it("step 2: subscribes to new messages", async () => {
    // Component uses useSubscription
    // Verify: subscription established
    // Assert: isFetching = true initially
  });

  it("step 3: receives new message via subscription", async () => {
    // WebSocket emits new message
    // Verify: useSubscription data updates
    // Verify: message written to cache
    // Assert: new message appears in list (from cache reactivity)
  });

  it("step 4: sends message via mutation with optimistic update", async () => {
    // User types and sends message
    // useMutation with optimistic response
    // Verify: message appears immediately (optimistic)
    // Verify: network confirms and updates
    // Assert: message has correct timestamp and ID
  });

  it("step 5: pauses subscription when user goes offline", async () => {
    // User loses connection
    // Component sets pause: true on useSubscription
    // Verify: subscription paused
    // Assert: no new messages received
  });

  it("step 6: resumes subscription when user comes online", async () => {
    // User reconnects
    // Component sets pause: false
    // Verify: subscription resumed
    // Assert: receives queued messages
  });

  it("step 7: unsubscribes on component unmount", async () => {
    // Component unmounts
    // Verify: subscription cleanup called
    // Assert: no memory leaks
  });
});
```

**Coverage**: `useQuery`, `useSubscription`, `useMutation`, cache-and-network policy, pause/resume, optimistic updates, cleanup

---

### **Scenario 4: E-commerce Product Search**
**User Story**: User searches for products, filters results, and adds items to cart

#### **Test Steps**:

```typescript
describe("Scenario 4: E-commerce Product Search", () => {
  
  it("step 1: searches for products with network-only policy", async () => {
    // Component uses useQuery with network-only
    // User types search query: "laptop"
    // Verify: always fetches from network (no cache)
    // Assert: search results displayed
  });

  it("step 2: updates search query reactively", async () => {
    // User types more: "laptop gaming"
    // Variables update reactively
    // Verify: new network request triggered
    // Assert: refined results displayed
  });

  it("step 3: applies filters and sees updated results", async () => {
    // User selects price range filter
    // Variables: { query: "laptop gaming", maxPrice: 1500 }
    // Verify: new query executed
    // Assert: filtered results shown
  });

  it("step 4: adds product to cart via mutation", async () => {
    // User clicks "Add to Cart"
    // useMutation: addToCart
    // Verify: mutation executes
    // Assert: cart count updates (from mutation response)
  });

  it("step 5: views cart with cache-only policy", async () => {
    // User navigates to cart page
    // Component uses useQuery with cache-only
    // Verify: no network request
    // Assert: cart items from cache
  });

  it("step 6: handles cache miss error gracefully", async () => {
    // User navigates to cart with empty cache
    // cache-only policy throws CacheMissError
    // Verify: error caught
    // Assert: fallback UI shown
  });
});
```

**Coverage**: `useQuery`, `useMutation`, network-only policy, cache-only policy, reactive variables, error handling, CacheMissError

---

### **Scenario 5: SSR Blog with Hydration**
**User Story**: Server renders blog post, client hydrates without flash, then navigates

#### **Test Steps**:

```typescript
describe("Scenario 5: SSR Blog with Hydration", () => {
  
  it("step 1: server renders blog post list", async () => {
    // Server: executeQuery and writeQuery
    // Server: dehydrate cache state
    // Verify: cache snapshot created
    // Assert: snapshot contains post data
  });

  it("step 2: client hydrates cache from SSR snapshot", async () => {
    // Client: createCachebay with hydrationTimeout
    // Client: cache.hydrate(snapshot)
    // Verify: cache populated
    // Assert: no network request during hydration window
  });

  it("step 3: component renders with cache-and-network during hydration", async () => {
    // Component uses useQuery with cache-and-network
    // Within hydration window
    // Verify: shows cached data immediately
    // Verify: no network request (hydration window active)
    // Assert: no loading state, no flash
  });

  it("step 4: hydration window expires, network request allowed", async () => {
    // Wait for hydrationTimeout to expire
    // Component still mounted
    // Verify: network request now allowed
    // Assert: data revalidated from network
  });

  it("step 5: navigates to new post, fetches from network", async () => {
    // User clicks different post
    // Variables change: { id: "post-2" }
    // Verify: network request (not in cache)
    // Assert: new post data loaded
  });

  it("step 6: navigates back, sees cached data", async () => {
    // User goes back to first post
    // Variables: { id: "post-1" }
    // Verify: instant load from cache
    // Assert: no loading state
  });
});
```

**Coverage**: SSR, `dehydrate`, `hydrate`, `hydrationTimeout`, cache-and-network during hydration, navigation

---

### **Scenario 6: Suspense with Error Boundaries**
**User Story**: User navigates app with Suspense, handles loading and errors gracefully

#### **Test Steps**:

```typescript
describe("Scenario 6: Suspense with Error Boundaries", () => {
  
  it("step 1: shows suspense fallback while loading", async () => {
    // Component wrapped in <Suspense>
    // Uses await useQuery (async setup)
    // Verify: fallback UI shown
    // Assert: "Loading..." displayed
  });

  it("step 2: resolves and shows data", async () => {
    // Network responds with data
    // Verify: suspense resolves
    // Assert: data displayed, no fallback
  });

  it("step 3: throws error and shows error boundary", async () => {
    // Network returns error
    // useQuery throws in async setup
    // Verify: error boundary catches
    // Assert: error UI shown
  });

  it("step 4: retries and recovers from error", async () => {
    // User clicks "Retry"
    // Component re-executes query
    // Verify: suspense fallback shown again
    // Verify: successful response
    // Assert: data displayed
  });

  it("step 5: navigates with cached data, no suspense", async () => {
    // User navigates to cached route
    // Data already in cache
    // Verify: no suspense fallback
    // Assert: instant render
  });
});
```

**Coverage**: Suspense, async setup, error boundaries, error recovery, cache-first with Suspense

---

### **Scenario 7: Optimistic UI with Rollback**
**User Story**: User performs actions with optimistic updates, handles failures

#### **Test Steps**:

```typescript
describe("Scenario 7: Optimistic UI with Rollback", () => {
  
  it("step 1: displays todo list", async () => {
    // Component uses useQuery
    // Verify: todo list loaded
    // Assert: 5 todos displayed
  });

  it("step 2: adds todo optimistically", async () => {
    // User adds new todo
    // useMutation with optimistic response
    // Verify: todo appears immediately
    // Assert: 6 todos displayed (before network)
  });

  it("step 3: mutation succeeds, optimistic update confirmed", async () => {
    // Network responds successfully
    // Verify: optimistic layer removed
    // Verify: real data matches optimistic
    // Assert: still 6 todos, same data
  });

  it("step 4: deletes todo optimistically", async () => {
    // User deletes a todo
    // useMutation with optimistic response
    // Verify: todo removed immediately
    // Assert: 5 todos displayed
  });

  it("step 5: mutation fails, optimistic update rolled back", async () => {
    // Network returns error
    // Verify: optimistic layer discarded
    // Verify: original data restored
    // Assert: 6 todos again (rollback)
    // Assert: error shown to user
  });

  it("step 6: retries mutation successfully", async () => {
    // User retries delete
    // useMutation executes again
    // Verify: optimistic update applied
    // Verify: network succeeds
    // Assert: 5 todos, deletion confirmed
  });
});
```

**Coverage**: `useMutation`, optimistic updates, error handling, rollback, retry logic

---

### **Scenario 8: Multi-Component Coordination**
**User Story**: Multiple components share cache state and coordinate updates

#### **Test Steps**:

```typescript
describe("Scenario 8: Multi-Component Coordination", () => {
  
  it("step 1: mounts three components sharing same query", async () => {
    // Component A: User profile header
    // Component B: User settings panel
    // Component C: User activity feed
    // All use useQuery with same user ID
    // Verify: only 1 network request
    // Assert: all components show same data
  });

  it("step 2: one component updates data via mutation", async () => {
    // Component B: User updates profile name
    // useMutation executes
    // Verify: cache updated
    // Assert: Component A header shows new name
    // Assert: Component C feed shows new name
    // Assert: all components reactive to same cache change
  });

  it("step 3: one component uses fragment, sees same updates", async () => {
    // Component D: Uses useFragment for user
    // Verify: fragment reads from same cache entity
    // Assert: shows updated name from mutation
  });

  it("step 4: subscription updates cache, all components react", async () => {
    // Component E: useSubscription for user updates
    // Subscription emits avatar change
    // Verify: cache updated
    // Assert: all 4 components show new avatar
  });

  it("step 5: unmounts components, cache persists", async () => {
    // Unmount all components
    // Verify: no memory leaks
    // Assert: cache still contains data
  });

  it("step 6: remounts components, instant load from cache", async () => {
    // Mount components again
    // Verify: no network requests
    // Assert: data appears instantly
  });
});
```

**Coverage**: Multi-component reactivity, cache sharing, deduplication, memory management

---

### **Scenario 9: Error Recovery Patterns**
**User Story**: User encounters various errors and recovers gracefully

#### **Test Steps**:

```typescript
describe("Scenario 9: Error Recovery Patterns", () => {
  
  it("step 1: handles network timeout error", async () => {
    // useQuery with slow network
    // Network times out
    // Verify: error state set
    // Assert: error.message contains "timeout"
  });

  it("step 2: retries query after error", async () => {
    // User clicks "Retry"
    // Component re-executes query
    // Verify: new network request
    // Assert: succeeds and shows data
  });

  it("step 3: handles GraphQL errors", async () => {
    // Mutation returns GraphQL errors
    // useMutation receives error response
    // Verify: error state set
    // Assert: error.graphQLErrors populated
  });

  it("step 4: handles partial data with errors", async () => {
    // Query returns data + errors
    // Verify: both data and error set
    // Assert: partial data displayed
    // Assert: error banner shown
  });

  it("step 5: handles subscription connection error", async () => {
    // useSubscription fails to connect
    // Verify: error state set
    // Assert: isFetching = false
    // Assert: error message shown
  });

  it("step 6: recovers subscription after reconnect", async () => {
    // WebSocket reconnects
    // useSubscription re-establishes
    // Verify: subscription active
    // Assert: receives new messages
  });
});
```

**Coverage**: Error handling, retry logic, GraphQL errors, partial data, subscription errors

---

### **Scenario 10: Performance and Edge Cases**
**User Story**: Tests performance patterns and edge cases

#### **Test Steps**:

```typescript
describe("Scenario 10: Performance and Edge Cases", () => {
  
  it("step 1: handles rapid variable changes without race conditions", async () => {
    // User types quickly in search box
    // Variables update 10 times rapidly
    // Verify: only last query result shown
    // Assert: no stale data from earlier queries
  });

  it("step 2: deduplicates identical concurrent queries", async () => {
    // 5 components mount simultaneously
    // All request same query + variables
    // Verify: only 1 network request
    // Assert: all components receive same data
  });

  it("step 3: handles empty results gracefully", async () => {
    // Query returns empty array
    // Verify: no errors
    // Assert: empty state UI shown
  });

  it("step 4: handles null data gracefully", async () => {
    // Query returns null for optional field
    // Verify: no errors
    // Assert: null handled in UI
  });

  it("step 5: handles very large result sets", async () => {
    // Query returns 1000 items
    // Verify: cache stores all items
    // Assert: pagination works correctly
  });

  it("step 6: cleans up watchers on unmount", async () => {
    // Mount 10 components with watchers
    // Unmount all
    // Verify: all watchers unsubscribed
    // Assert: no memory leaks
  });
});
```

**Coverage**: Race conditions, deduplication, edge cases, performance, memory management

---

## Implementation Details

### **Test Helpers**

```typescript
// Helper to create a test component with composable
function createTestComponent(setup: () => any) {
  return defineComponent({
    setup,
    render() {
      return h('div', this.$data);
    }
  });
}

// Helper to wait for reactive updates
async function waitForReactivity(times = 1) {
  for (let i = 0; i < times; i++) {
    await tick();
  }
}

// Helper to simulate subscription events
function createMockSubscription() {
  let observer: any;
  return {
    emit: (data: any) => observer?.next({ data, error: null }),
    error: (err: Error) => observer?.error(err),
    complete: () => observer?.complete(),
    subscribe: (obs: any) => {
      observer = obs;
      return { unsubscribe: () => { observer = null; } };
    }
  };
}
```

### **Test Structure Template**

```typescript
describe("Scenario X: [User Story]", () => {
  let cache: CachebayInstance;
  let client: any;
  let mockTransport: any;
  
  beforeEach(() => {
    // Setup cache and transport
    mockTransport = createMockTransport();
    cache = createCachebay({ transport: mockTransport });
    client = { install: (app) => provideCachebay(app, cache) };
  });
  
  afterEach(() => {
    // Cleanup
  });
  
  it("step 1: [action]", async () => {
    // Arrange
    const Component = createTestComponent(() => {
      const { data, error } = useQuery({ ... });
      return { data, error };
    });
    
    // Act
    const wrapper = mount(Component, { global: { plugins: [client] } });
    await waitForReactivity();
    
    // Assert
    expect(wrapper.vm.data).toBeDefined();
  });
});
```

---

## Test Metrics

### **Expected Coverage**

- **Total Scenarios**: 10
- **Total Test Steps**: ~60-70 tests
- **Lines of Code**: ~2,500-3,000
- **Execution Time**: ~30-60 seconds

### **Composables Covered**

- ✅ `useQuery` - All cache policies, reactive variables, pause
- ✅ `useMutation` - Optimistic updates, error handling
- ✅ `useSubscription` - Real-time updates, pause/resume
- ✅ `useFragment` - Read, write, watch
- ✅ `useCachebay` - Direct cache access

### **Features Covered**

- ✅ All 4 cache policies
- ✅ Reactive variables
- ✅ Optimistic updates
- ✅ Subscriptions
- ✅ Fragments
- ✅ SSR hydration
- ✅ Suspense
- ✅ Error handling
- ✅ Multi-component coordination
- ✅ Memory management

---

## Implementation Timeline

### **Phase 1: Core Scenarios (Week 1)**
- Scenario 1: Blog Post List
- Scenario 2: User Profile
- Scenario 3: Real-time Chat
- **Deliverable**: 20-25 tests, basic coverage

### **Phase 2: Advanced Scenarios (Week 2)**
- Scenario 4: E-commerce Search
- Scenario 5: SSR Blog
- Scenario 6: Suspense
- **Deliverable**: 40-45 tests, comprehensive coverage

### **Phase 3: Edge Cases (Week 3)**
- Scenario 7: Optimistic Rollback
- Scenario 8: Multi-Component
- Scenario 9: Error Recovery
- Scenario 10: Performance
- **Deliverable**: 60-70 tests, complete coverage

---

## Success Criteria

✅ All scenarios pass  
✅ Every Vue composable tested in realistic context  
✅ All cache policies covered  
✅ Error cases handled  
✅ Memory leaks prevented  
✅ Tests serve as documentation for users  

---

## Next Steps

1. **Review scenarios** - Confirm these match real-world usage
2. **Prioritize scenarios** - Which are most critical?
3. **Start implementation** - Begin with Scenario 1
4. **Iterate** - Adjust based on findings

Ready to start implementation! 🚀
