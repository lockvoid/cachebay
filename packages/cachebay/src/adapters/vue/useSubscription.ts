import { ref, watch, onBeforeUnmount, type Ref, type MaybeRefOrGetter, toValue } from "vue";
import { useCachebay } from "./useCachebay";
import type { Operation, OperationResult } from "../../core/operations";
import type { DocumentNode } from "graphql";

/**
 * useSubscription options
 */
export interface UseSubscriptionOptions<TData = any, TVars = any> {
  /** GraphQL subscription document */
  query: DocumentNode | string;
  /** Subscription variables (can be reactive) */
  variables?: MaybeRefOrGetter<TVars>;
  /** Pause subscription if true (can be reactive) */
  pause?: MaybeRefOrGetter<boolean>;
}

/**
 * useSubscription return value
 */
export interface UseSubscriptionReturn<TData = any> {
  /** Subscription data (reactive) */
  data: Ref<TData | null>;
  /** Error if subscription failed */
  error: Ref<Error | null>;
  /** Fetching state (waiting for first data) */
  isFetching: Ref<boolean>;
}

/**
 * Reactive GraphQL subscription hook
 * @param options - Subscription options
 * @returns Reactive subscription state
 */
export function useSubscription<TData = any, TVars = any>(
  options: UseSubscriptionOptions<TData, TVars>
): UseSubscriptionReturn<TData> {
  const client = useCachebay();

  const data = ref<TData | null>(null) as Ref<TData | null>;
  const error = ref<Error | null>(null);
  const isFetching = ref(true);

  let unsubscribe: (() => void) | null = null;

  /**
   * Setup subscription
   */
  const setupSubscription = async () => {
    const vars = toValue(options.variables) || ({} as TVars);
    const isPaused = toValue(options.pause);

    // Cleanup previous subscription
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }

    if (isPaused) {
      isFetching.value = false;
      return;
    }

    isFetching.value = true;
    error.value = null;

    try {
      const observable = await client.executeSubscription<TData, TVars>({
        query: options.query,
        variables: vars,
      });

      const subscription = observable.subscribe({
        next: (result) => {
          if (result.error) {
            error.value = result.error;
          } else {
            data.value = result.data;
            error.value = null;
          }
          isFetching.value = false;
        },
        error: (err) => {
          error.value = err;
          isFetching.value = false;
        },
        complete: () => {
          isFetching.value = false;
        },
      });

      unsubscribe = () => subscription.unsubscribe();
    } catch (err) {
      error.value = err as Error;
      isFetching.value = false;
    }
  };

  // Watch for variable and pause changes
  watch(
    () => [toValue(options.variables), toValue(options.pause)],
    () => {
      setupSubscription();
    },
    { immediate: true, deep: true }
  );

  // Cleanup on unmount
  onBeforeUnmount(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return {
    data,
    error,
    isFetching,
  };
}
