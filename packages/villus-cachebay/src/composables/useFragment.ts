import { unref, watchEffect, readonly, type Ref, shallowRef } from "vue";
import { useCache } from "./useCache";

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
 * @throws Error if cache doesn't expose readFragment method
 */
export function useFragment<TData = unknown>(options: UseFragmentOptions<TData>): Readonly<Ref<TData | undefined>> {
  const cache = useCache();

  if (typeof cache.readFragment !== "function") {
    throw new Error("[useFragment] cache must expose readFragment()");
  }

  const data = shallowRef<TData | undefined>(undefined);

  watchEffect(() => {
    const id = unref(options.id);
    const vars = unref(options.variables) || {};
    if (!id) {
      data.value = undefined;
      return;
    }

    const view = cache.readFragment<TData>({
      id,
      fragment: options.fragment,
      fragmentName: options.fragmentName,
      variables: vars,
    });
    data.value = view;
  });

  return readonly(data);
}
