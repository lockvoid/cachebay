import { onDestroy } from "svelte";
import { getCachebay } from "./context";
import type { DocumentNode } from "graphql";

/**
 * Reactive getter type for Svelte 5 runes
 */
type MaybeGetter<T> = T | (() => T);

/**
 * Resolve a MaybeGetter to its current value
 */
const resolve = <T>(value: MaybeGetter<T>): T =>
  typeof value === "function" ? (value as () => T)() : value;

/**
 * createSubscription options
 */
export interface CreateSubscriptionOptions<TData = any, TVars = any> {
  /** GraphQL subscription document */
  query: DocumentNode | string;
  /** Subscription variables (can be a reactive getter) */
  variables?: MaybeGetter<TVars>;
  /** Enable subscription execution (default: true, can be a reactive getter) */
  enabled?: MaybeGetter<boolean>;
  /** Called when new subscription data arrives (for imperative side effects) */
  onData?: (data: TData) => void;
  /** Called when subscription encounters an error (for imperative error handling) */
  onError?: (error: Error) => void;
  /** Called when subscription completes/closes (for cleanup or reconnection logic) */
  onComplete?: () => void;
}

/**
 * createSubscription return value
 */
export interface CreateSubscriptionReturn<TData = any> {
  /** Subscription data (reactive) */
  readonly data: TData | null;
  /** Error if subscription failed */
  readonly error: Error | null;
  /** Fetching state (waiting for first data) */
  readonly isFetching: boolean;
}

/**
 * Reactive GraphQL subscription
 * @param options - Subscription options
 * @returns Reactive subscription state
 */
export function createSubscription<TData = any, TVars = any>(
  options: CreateSubscriptionOptions<TData, TVars>,
): CreateSubscriptionReturn<TData> {
  const client = getCachebay();

  let data = $state<TData | null>(null);
  let error = $state<Error | null>(null);
  let isFetching = $state(true);

  let teardown: (() => void) | null = null;

  /**
   * Setup subscription
   */
  const setupSubscription = () => {
    const vars = resolve(options.variables) || ({} as TVars);
    const isEnabled = resolve(options.enabled) ?? true;

    // Cleanup previous subscription
    if (teardown) {
      teardown();
      teardown = null;
    }

    if (!isEnabled) {
      isFetching = false;
      return;
    }

    isFetching = true;
    error = null;

    try {
      const observable = client.executeSubscription<TData, TVars>({
        query: options.query,
        variables: vars,
        onData: options.onData,
        onError: options.onError,
        onComplete: options.onComplete,
      });

      const subscription = observable.subscribe({
        next: (result) => {
          if (result.error) {
            error = result.error;
          } else {
            data = result.data;
            error = null;
          }
          isFetching = false;
        },
        error: (err) => {
          error = err;
          isFetching = false;
        },
        complete: () => {
          isFetching = false;
        },
      });

      teardown = () => subscription.unsubscribe();
    } catch (err) {
      error = err as Error;
      isFetching = false;
    }
  };

  // Watch for variable and enabled changes
  $effect(() => {
    // Read reactive getters to register as $effect dependencies
    resolve(options.variables);
    resolve(options.enabled);

    setupSubscription();

    // Cleanup when effect re-runs or component unmounts
    return () => {
      if (teardown) {
        teardown();
        teardown = null;
      }
    };
  });

  // Cleanup on unmount (belt-and-suspenders with the $effect return)
  onDestroy(() => {
    if (teardown) {
      teardown();
      teardown = null;
    }
  });

  return {
    get data() { return data; },
    get error() { return error; },
    get isFetching() { return isFetching; },
  };
}
