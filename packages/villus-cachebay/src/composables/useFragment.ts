// useFragment.ts (core bits)
import { ref, shallowRef, isRef, unref } from 'vue';
import { useCache } from './useCache';

type Params = {
  id: string | Ref<string>;
  fragment: string;
  variables?: Record<string, any> | Ref<Record<string, any> | undefined>;
  materialized?: boolean;     // default true
  immediate?: boolean;        // default true
};

export function useFragment(params: Params) {
  const cache = useCache();

  const materialized = params.materialized !== false;  // default true
  const immediate = params.immediate !== false;        // default true

  const idRef = isRef(params.id) ? params.id : ref(params.id);
  const varsRef = isRef(params.variables) ? params.variables : ref(params.variables);

  // Keep the container as a Ref so callers can re-read (you’re already returning refs in tests)
  const data = materialized ? ref<any>(undefined) : shallowRef<any>(undefined);

  const read = () => {
    const id = unref(idRef);
    if (!id) { data.value = undefined; return; }

    const result = cache.readFragment({
      id,
      fragment: params.fragment,
      variables: unref(varsRef),
      materialized,               // ← IMPORTANT: forward the flag
    });

    data.value = result;
  };

  if (immediate) read();

  return {
    data, read, write: (payload: any) => cache.writeFragment({
      id: unref(idRef),
      fragment: params.fragment,
      data: payload,
      variables: unref(varsRef),
    })
  };
}
