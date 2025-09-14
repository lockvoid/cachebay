// src/composables/useFragment.ts
import { ref, unref, watchEffect, readonly, type Ref } from 'vue';
import { useCache } from './useCache';

export type UseFragmentParams = {
  id: string | Ref<string>;
  fragment: string;            // the actual Document string
  variables?: Record<string, any> | Ref<Record<string, any> | undefined>;
};

/** Live, fragment-shaped data as a Ref. Immediate. */
export function useFragment(params: UseFragmentParams): Readonly<Ref<any>> {
  const cache = useCache() as any; // must expose fragments.watchFragment
  if (typeof cache?.watchFragment !== 'function') {
    throw new Error('[useFragment] cache must expose watchFragment()');
  }

  const data = ref<any>(null);

  watchEffect(() => {
    const id = unref(params.id);
    const vars = unref(params.variables);
    if (!id) { data.value = null; return; }

    // create a live projection Ref from the current (id, fragment, vars)
    const live = cache.watchFragment({ id, fragment: params.fragment, variables: vars });
    data.value = live.value; // identity is stable inside live, so this is fine
  });

  return readonly(data);
}
