import { unref, watch, readonly, type Ref, shallowRef, onScopeDispose } from "vue";
import { useCachebay } from "./useCachebay";

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
  const cache = useCachebay();

  if (typeof cache.watchFragment !== "function") {
    throw new Error("[cachebay] useFragment: cache.watchFragment() is required");
  }

  const data = shallowRef<TData | undefined>(undefined);
  let handle: ReturnType<typeof cache.watchFragment> | null = null;

  // Watch for changes to id and variables
  watch(
    () => ({ id: unref(options.id), variables: unref(options.variables) || {} }),
    ({ id, variables }) => {
      if (!id) {
        // Clean up watcher if id becomes empty
        if (handle) {
          handle.unsubscribe();
          handle = null;
        }
        data.value = undefined;
        return;
      }

      // Reuse watcher with update() instead of remounting
      if (handle) {
        handle.update({ id, variables });
      } else {
        // Create new watcher on first run
        handle = cache.watchFragment({
          id,
          fragment: options.fragment,
          fragmentName: options.fragmentName,
          variables,
          onData: (newData: TData) => {
            data.value = newData;
          },
        });
      }
    },
    { immediate: true },
  );

  // Clean up on component unmount
  onScopeDispose(() => {
    if (handle) {
      handle.unsubscribe();
      handle = null;
    }
  });

  return readonly(data);
}
