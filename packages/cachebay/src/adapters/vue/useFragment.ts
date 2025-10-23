import { unref, watch, readonly, type Ref, shallowRef, onScopeDispose } from "vue";
import { useClient } from "./useClient";
import { getQueryCanonicalKeys } from "../../core/utils";

/**
 * Options for useFragment composable
 * @template TData - Expected fragment data type
 */
export type UseFragmentOptions<TData = unknown> = {
  /** Entity ID (typename:id) or reactive ref to ID */
  id: string | Ref<string>;
  /** GraphQL fragment document or compiled plan */
  fragment: unknown;
  /** Fragment name if document contains multiple fragments */
  fragmentName?: string;
  /** GraphQL variables or reactive ref to variables */
  variables?: Record<string, unknown> | Ref<Record<string, unknown> | undefined>;
  /** Use canonical mode for cache reads (default: true) */
  canonical?: boolean;
};

/**
 * Create a reactive fragment view from cache
 * Returns a readonly ref that updates when the fragment data changes
 * @template TData - Expected fragment data type
 * @param options - Fragment configuration
 * @returns Readonly reactive ref to fragment data
 * @throws Error if cache doesn't expose watchFragment method
 */
export function useFragment<TData = unknown>(options: UseFragmentOptions<TData>): Readonly<Ref<TData | undefined>> {
  const cache = useClient();

  if (typeof cache.watchFragment !== "function") {
    throw new Error("[useFragment] cache must expose watchFragment()");
  }

  const data = shallowRef<TData | undefined>(undefined);
  let unsubscribe: (() => void) | null = null;
  let prevCanonicalKeys: string[] = [];

  const canonical = options.canonical ?? true;

  // Watch for changes to id and variables
  watch(
    () => ({ id: unref(options.id), variables: unref(options.variables) || {} }),
    ({ id, variables }) => {
      if (!id) {
        // Clean up watcher if id becomes empty
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        data.value = undefined;
        return;
      }

      // Check if canonical keys changed (for fragments with connections)
      const plan = cache.getPlan(options.fragment, { fragmentName: options.fragmentName });
      const currentCanonicalKeys = getQueryCanonicalKeys(plan, variables);

      const hasConnections = currentCanonicalKeys.length > 0;
      const keysMatch = hasConnections &&
        currentCanonicalKeys.length === prevCanonicalKeys.length &&
        currentCanonicalKeys.every((key, i) => key === prevCanonicalKeys[i]);

      // Only recreate watcher if canonical keys changed (or first setup)
      const shouldRecreateWatcher = !keysMatch || !unsubscribe;

      if (shouldRecreateWatcher) {
        // Clean up previous watcher (different connection or first setup)
        if (unsubscribe) {
          unsubscribe();
          unsubscribe = null;
        }
        prevCanonicalKeys = currentCanonicalKeys;

        // Set up new watcher
        const handle = cache.watchFragment({
          id,
          fragment: options.fragment,
          fragmentName: options.fragmentName,
          variables,
          canonical,
          onData: (newData: TData) => {
            data.value = newData;
          },
          onError: () => {
            data.value = undefined;
          },
        });

        unsubscribe = handle.unsubscribe;
      } else {
        // Canonical keys match - keep existing watcher for recycling
        // Trigger refetch to update with new pagination args
        if (unsubscribe) {
          const handle = cache.watchFragment({
            id,
            fragment: options.fragment,
            fragmentName: options.fragmentName,
            variables,
            canonical,
            onData: (newData: TData) => {
              data.value = newData;
            },
            onError: () => {
              data.value = undefined;
            },
          });
          handle.refetch();
        }
      }
    },
    { immediate: true }
  );

  // Clean up on component unmount
  onScopeDispose(() => {
    if (unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  });

  return readonly(data);
}
