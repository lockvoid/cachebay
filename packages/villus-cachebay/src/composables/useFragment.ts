import { unref, watchEffect, readonly, type Ref, shallowRef } from "vue";
import { useCache } from "./useCache";

export type UseFragmentOptions = {
  id: string | Ref<string>;
  fragment: any; // string | DocumentNode | CachePlan
  fragmentName?: string;
  variables?: Record<string, any> | Ref<Record<string, any> | undefined>;
};

/**
 * Live, fragment-shaped data Ref (reactive view).
 * - Uses cache.readFragment (which returns a reactive entity/selection view).
 * - Updates when id/fragment/variables change.
 */
export function useFragment(options: UseFragmentOptions): Readonly<Ref<any>> {
  const cache = useCache() as any; // must expose readFragment()

  if (typeof cache?.readFragment !== "function") {
    throw new Error("[useFragment] cache must expose readFragment()");
  }

  const data = shallowRef<any>(undefined);

  watchEffect(() => {
    const id = unref(options.id);
    const vars = unref(options.variables) || {};
    if (!id) {
      data.value = undefined;
      return;
    }
    // readFragment returns a reactive view; we keep it as-is
    const view = cache.readFragment({
      id,
      fragment: options.fragment,
      fragmentName: options.fragmentName,
      variables: vars,
    });
    data.value = view;
  });

  return readonly(data);
}
