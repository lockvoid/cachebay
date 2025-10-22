import { unref, watch, readonly, type Ref, shallowRef, onScopeDispose } from "vue";
import { useClient } from "./useClient";

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

  // Watch for changes to id and variables
  watch(
    () => ({ id: unref(options.id), variables: unref(options.variables) || {} }),
    ({ id, variables }) => {
      // Clean up previous watcher
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }

      if (!id) {
        data.value = undefined;
        return;
      }

      // Set up new watcher
      const handle = cache.watchFragment({
        id,
        fragment: options.fragment,
        fragmentName: options.fragmentName,
        variables,
        onData: (newData: TData) => {
          data.value = newData;
        },
        onError: () => {
          data.value = undefined;
        },
      });

      unsubscribe = handle.unsubscribe;
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
